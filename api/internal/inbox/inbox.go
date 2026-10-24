// Package inbox is the support desk: conversations that arrive from the website chat widget or by email, a
// shared list the team works through, replies, and sending a customer's message on to the review queue as
// feedback. A conversation shows live where that feedback stands (in the review queue, or which request it
// became and that request's current status).
package inbox

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/intake"
	"product/api/internal/redact"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("inbox: not found")
	// ErrStale means the conversation changed since the person looked: someone else replied, or took it.
	ErrStale = errors.New("inbox: the conversation changed")
	// ErrOrigin means the page showing the chat is not on the workspace's list.
	ErrOrigin  = errors.New("inbox: origin not allowed")
	ErrOff     = errors.New("inbox: this channel is switched off")
	ErrBadSign = errors.New("inbox: bad signature")
)

// ErrInvalid is input the caller must fix; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ErrLimited is a limit that protects the inbox from floods; the message is safe to show.
type ErrLimited string

func (e ErrLimited) Error() string { return string(e) }

const (
	MaxChatText      = 2000 // one chat message
	MaxReplyText     = 5000
	MaxVisitorPerHr  = 30 // messages one visitor may send in an hour
	MaxNewChatsPerHr = 60 // new chat conversations a workspace takes in an hour
	MaxOrigins       = 10
	signatureWindow  = 5 * time.Minute
)

type Service struct {
	Pool   *pgxpool.Pool
	Jobs   *river.Client[pgx.Tx]
	Intake *intake.Service
	Secret []byte // derives the widget address and the inbound signing key; never shown
	// Throttle, when set, is asked per chat message for the workspace's widget and the caller's address.
	Throttle func(ctx context.Context, key, addr string) bool
	Now      func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// ---- derived secrets ----

func (s *Service) mac(parts ...string) []byte {
	h := hmac.New(sha256.New, s.Secret)
	h.Write([]byte("inbox\x00" + strings.Join(parts, "\x00")))
	return h.Sum(nil)
}

func hexID(id uuid.UUID) string { return hex.EncodeToString(id[:]) }

func unhex(s string) (uuid.UUID, error) {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 16 {
		return uuid.Nil, ErrNotFound
	}
	var id uuid.UUID
	copy(id[:], b)
	return id, nil
}

// WidgetToken is the chat widget's public address for a workspace. It is not a secret; it cannot be forged.
func (s *Service) WidgetToken(ws uuid.UUID, epoch int) string {
	return "c." + hexID(ws) + "." + strconv.Itoa(epoch) + "." + base64.RawURLEncoding.EncodeToString(s.mac("widget", ws.String(), strconv.Itoa(epoch))[:16])
}

func (s *Service) verifyWidget(token string) (ws uuid.UUID, epoch int, err error) {
	if len(s.Secret) == 0 || len(token) > 120 {
		return uuid.Nil, 0, ErrNotFound
	}
	p := strings.Split(token, ".")
	if len(p) != 4 || p[0] != "c" {
		return uuid.Nil, 0, ErrNotFound
	}
	ws, err1 := unhex(p[1])
	epoch, err2 := strconv.Atoi(p[2])
	if err1 != nil || err2 != nil || epoch < 0 || strconv.Itoa(epoch) != p[2] ||
		subtle.ConstantTimeCompare([]byte(p[3]), []byte(base64.RawURLEncoding.EncodeToString(s.mac("widget", ws.String(), p[2])[:16]))) != 1 {
		return uuid.Nil, 0, ErrNotFound
	}
	return ws, epoch, nil
}

// InboundKey is what the mail service signs incoming messages with. Shown to admins once in a while; rotating
// it makes the old key useless at once.
func (s *Service) InboundKey(ws uuid.UUID, epoch int) string {
	return base64.RawURLEncoding.EncodeToString(s.mac("inbound", ws.String(), strconv.Itoa(epoch))[:24])
}

// ---- settings ----

type Settings struct {
	ChatEnabled  bool
	EmailEnabled bool
	Origins      []string
	Greeting     string
	WidgetToken  string // empty when chat is off
	InboundKey   string // empty when email is off
}

func (s *Service) settingsFrom(ws uuid.UUID, r dbgen.InboxSetting) Settings {
	out := Settings{ChatEnabled: r.ChatEnabled, EmailEnabled: r.EmailEnabled, Origins: r.Origins, Greeting: r.Greeting}
	if out.Origins == nil {
		out.Origins = []string{}
	}
	if r.ChatEnabled {
		out.WidgetToken = s.WidgetToken(ws, int(r.WidgetEpoch))
	}
	if r.EmailEnabled {
		out.InboundKey = s.InboundKey(ws, int(r.InboundEpoch))
	}
	return out
}

func (s *Service) GetSettings(ctx context.Context, t store.Tenant) (Settings, error) {
	var out Settings
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetInboxSetting(ctx, t.WorkspaceID)
		if errors.Is(err, pgx.ErrNoRows) {
			out = Settings{Origins: []string{}}
			return nil
		}
		if err != nil {
			return err
		}
		out = s.settingsFrom(t.WorkspaceID, r)
		return nil
	})
	return out, err
}

type SettingsInput struct {
	ChatEnabled, EmailEnabled bool
	Origins                   []string
	Greeting                  string
	RotateWidget              bool
	RotateInbound             bool
}

// UpdateSettings (admins only) switches the channels on or off, sets the sites allowed to show the chat, and
// can issue a new widget address or inbound key (the old one stops working at once).
func (s *Service) UpdateSettings(ctx context.Context, t store.Tenant, in SettingsInput) (Settings, error) {
	if t.Role != store.RoleAdmin {
		return Settings{}, store.ErrForbidden
	}
	origins, err := cleanOrigins(in.Origins)
	if err != nil {
		return Settings{}, err
	}
	greeting := strings.TrimSpace(in.Greeting)
	if utf8.RuneCountInString(greeting) > 300 {
		return Settings{}, ErrInvalid("the greeting is too long (300 characters at most)")
	}
	if in.ChatEnabled && len(origins) == 0 {
		return Settings{}, ErrInvalid("list the sites that may show the chat before turning it on")
	}
	var out Settings
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		cur, err := q.GetInboxSetting(ctx, t.WorkspaceID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		we, ie := cur.WidgetEpoch, cur.InboundEpoch
		if in.RotateWidget {
			we++
		}
		if in.RotateInbound {
			ie++
		}
		r, err := q.UpsertInboxSetting(ctx, dbgen.UpsertInboxSettingParams{WorkspaceID: t.WorkspaceID, ChatEnabled: in.ChatEnabled, EmailEnabled: in.EmailEnabled, Origins: origins, Greeting: greeting, WidgetEpoch: we, InboundEpoch: ie})
		out = s.settingsFrom(t.WorkspaceID, r)
		return err
	})
	return out, err
}

func cleanOrigins(in []string) ([]string, error) {
	if len(in) > MaxOrigins {
		return nil, ErrInvalid("too many allowed sites")
	}
	seen := map[string]bool{}
	out := []string{}
	for _, o := range in {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		u, err := url.Parse(o)
		if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || strings.Contains(o, "*") {
			return nil, ErrInvalid("each allowed site must look like https://www.example.com")
		}
		host := u.Hostname()
		local := host == "localhost" || host == "127.0.0.1"
		if u.Scheme != "https" && !(u.Scheme == "http" && local) {
			return nil, ErrInvalid("allowed sites must use https")
		}
		norm := u.Scheme + "://" + strings.ToLower(u.Host)
		if len(norm) > 255 {
			return nil, ErrInvalid("that site address is too long")
		}
		if !seen[norm] {
			seen[norm] = true
			out = append(out, norm)
		}
	}
	return out, nil
}

func newRef() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return strings.ToLower(strings.TrimRight(base32(b), "="))
}

func base32(b []byte) string {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789" // no look-alike letters
	var sb strings.Builder
	for _, x := range b {
		sb.WriteByte(alphabet[int(x)%len(alphabet)])
		sb.WriteByte(alphabet[int(x>>3)%len(alphabet)])
	}
	return sb.String()
}

func tsPtr(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	v := ts.Time
	return &v
}

func tenantFor(ws uuid.UUID) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
}

// clean makes customer text safe to keep: valid UTF-8, no NULs, secrets hidden.
func clean(s string, max int) (string, error) {
	s = strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(s, "\x00", ""), ""))
	if s == "" {
		return "", ErrInvalid("write a message")
	}
	if utf8.RuneCountInString(s) > max {
		return "", ErrInvalid(fmt.Sprintf("a message can be up to %d characters", max))
	}
	return strings.TrimSpace(redact.Text(s).Text), nil
}

func validEmail(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Name != "" || len(a.Address) > 320 || !strings.Contains(a.Address, "@") {
		return "", ErrInvalid("that email address does not look right")
	}
	return strings.ToLower(a.Address), nil
}

var _ = json.Marshal
