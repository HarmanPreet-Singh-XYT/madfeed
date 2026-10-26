package inbox

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/redact"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ---- website chat (no sign-in) ----

var visitorRe = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

type WidgetConfig struct {
	WorkspaceName string
	Greeting      string
}

// widgetSetting checks the widget address and that the page showing it is on the list.
func (s *Service) widgetSetting(ctx context.Context, q *dbgen.Queries, token, origin string) (uuid.UUID, dbgen.InboxSetting, error) {
	ws, epoch, err := s.verifyWidget(token)
	if err != nil {
		return uuid.Nil, dbgen.InboxSetting{}, ErrNotFound
	}
	st, err := q.GetInboxSetting(ctx, ws)
	if err != nil || !st.ChatEnabled || int(st.WidgetEpoch) != epoch {
		return uuid.Nil, st, ErrNotFound // a wrong, retired or switched-off widget looks like any missing page
	}
	ok := false
	for _, o := range st.Origins {
		ok = ok || o == origin
	}
	if !ok {
		return uuid.Nil, st, ErrOrigin
	}
	return ws, st, nil
}

// Config is what the chat window needs to start, given the site that shows it.
func (s *Service) Config(ctx context.Context, token, origin string) (WidgetConfig, error) {
	ws, _, err := s.verifyWidget(token)
	if err != nil {
		return WidgetConfig{}, ErrNotFound
	}
	var out WidgetConfig
	err = store.WithTenant(ctx, s.Pool, tenantFor(ws), func(q *dbgen.Queries) error {
		st, err := s.widgetSettingRow(ctx, q, token, origin)
		if err != nil {
			return err
		}
		w, err := q.GetWorkspaceSettings(ctx, ws)
		if err != nil {
			return err
		}
		out = WidgetConfig{WorkspaceName: w.Name, Greeting: st.Greeting}
		return nil
	})
	return out, err
}

func (s *Service) widgetSettingRow(ctx context.Context, q *dbgen.Queries, token, origin string) (dbgen.InboxSetting, error) {
	_, st, err := s.widgetSetting(ctx, q, token, origin)
	return st, err
}

type ChatMessage struct {
	Seq       int
	FromTeam  bool
	Text      string
	CreatedAt time.Time
	Files     []Attachment
}

type ChatInput struct {
	Token   string
	Origin  string // the site showing the chat
	Visitor string // an id the browser makes up and keeps
	Name    string
	Email   string
	Text    string
	Addr    string      // for limits only; never stored
	Files   []uuid.UUID // files uploaded earlier with ChatUploadFile
}

// ChatSend takes one message from a visitor, starting a conversation if this browser has none.
func (s *Service) ChatSend(ctx context.Context, in ChatInput) error {
	if !visitorRe.MatchString(in.Visitor) {
		return ErrInvalid("this chat could not identify your browser; reload the page and try again")
	}
	ws, _, err := s.verifyWidget(in.Token)
	if err != nil {
		return ErrNotFound
	}
	var text string
	if strings.TrimSpace(in.Text) == "" && len(in.Files) > 0 {
		text = NoText
	} else if text, err = clean(in.Text, MaxChatText); err != nil {
		return err
	}
	email, err := validEmail(in.Email)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(strings.ToValidUTF8(in.Name, ""))
	if utf8.RuneCountInString(name) > 100 {
		return ErrInvalid("that name is too long")
	}
	var origErr error
	err = store.WithTenantTx(ctx, s.Pool, tenantFor(ws), func(tx pgx.Tx, q *dbgen.Queries) error {
		if _, _, e := s.widgetSetting(ctx, q, in.Token, in.Origin); e != nil {
			origErr = e
			return nil
		}
		// An address typed into a chat is a claim, not proof, so it is never matched to a known person here:
		// a stranger could otherwise write as a customer and have the words filed under their name.
		// One visitor's messages go through one at a time, so two first messages cannot both create a conversation.
		if _, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, ws.String()+":"+in.Visitor); e != nil {
			return e
		}
		if s.Throttle != nil && !s.Throttle(ctx, "chat:"+hexID(ws), in.Addr) {
			return ErrLimited("you are sending messages too quickly; wait a moment")
		}
		c, err := q.GetConversationByVisitor(ctx, dbgen.GetConversationByVisitorParams{WorkspaceID: ws, VisitorKey: pgtype.Text{String: in.Visitor, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			n, cerr := q.CountNewConversationsSince(ctx, dbgen.CountNewConversationsSinceParams{WorkspaceID: ws, CreatedAt: s.now().Add(-time.Hour)})
			if cerr != nil {
				return cerr
			}
			if n >= MaxNewChatsPerHr {
				return ErrLimited("the chat is very busy right now; please try again in a little while")
			}
			p := dbgen.InsertConversationParams{WorkspaceID: ws, Channel: "chat", CustomerName: name, Ref: newRef(), VisitorKey: pgtype.Text{String: in.Visitor, Valid: true}}
			if email != "" {
				p.CustomerEmail = pgtype.Text{String: email, Valid: true}
			}
			p.Subject = firstWords(text)
			c, err = q.InsertConversation(ctx, p)
		}
		if err != nil {
			return err
		}
		sent, err := q.CountVisitorMessagesSince(ctx, dbgen.CountVisitorMessagesSinceParams{WorkspaceID: ws, ConversationID: c.ID, CreatedAt: s.now().Add(-time.Hour)})
		if err != nil {
			return err
		}
		if sent >= MaxVisitorPerHr {
			return ErrLimited("you have sent a lot of messages; please wait a little before sending more")
		}
		// the visitor may add their details later in the conversation
		if email != "" && !c.CustomerEmail.Valid {
			if _, err := tx.Exec(ctx, `UPDATE conversation SET customer_email = $3, customer_name = CASE WHEN customer_name = '' THEN $4 ELSE customer_name END WHERE workspace_id = $1 AND id = $2`, ws, c.ID, email, name); err != nil {
				return err
			}
		}
		m, err := q.InsertConversationMessage(ctx, dbgen.InsertConversationMessageParams{WorkspaceID: ws, ConversationID: c.ID, Direction: "in", Body: text, State: "received"})
		if err != nil {
			return err
		}
		if err := attach(ctx, tx, ws, c.ID, m.ID, visitorUploader(in.Visitor), in.Files); err != nil {
			return err
		}
		return q.TouchConversation(ctx, dbgen.TouchConversationParams{WorkspaceID: ws, ID: c.ID, Reopen: true})
	})
	if err != nil {
		return err
	}
	return origErr
}

func firstWords(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > 80 {
		s = string([]rune(s)[:80]) + "…"
	}
	return s
}

// ChatPoll returns what this visitor may see after message number `after`: their own messages and the team's
// sent replies. Internal notes never leave the team.
func (s *Service) ChatPoll(ctx context.Context, token, origin, visitor string, after int) ([]ChatMessage, error) {
	if !visitorRe.MatchString(visitor) || after < 0 {
		return nil, ErrInvalid("this chat could not identify your browser; reload the page and try again")
	}
	ws, _, err := s.verifyWidget(token)
	if err != nil {
		return nil, ErrNotFound
	}
	var out []ChatMessage
	var origErr error
	err = store.WithTenant(ctx, s.Pool, tenantFor(ws), func(q *dbgen.Queries) error {
		if _, _, e := s.widgetSetting(ctx, q, token, origin); e != nil {
			origErr = e
			return nil
		}
		c, err := q.GetConversationByVisitor(ctx, dbgen.GetConversationByVisitorParams{WorkspaceID: ws, VisitorKey: pgtype.Text{String: visitor, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		rows, err := q.ListVisibleChatMessages(ctx, dbgen.ListVisibleChatMessagesParams{WorkspaceID: ws, ConversationID: c.ID, Seq: int32(after)})
		if err != nil {
			return err
		}
		files, err := filesByMessage(ctx, q, ws, c.ID)
		if err != nil {
			return err
		}
		for _, r := range rows {
			out = append(out, ChatMessage{Seq: int(r.Seq), FromTeam: r.Direction == "out", Text: r.Body, CreatedAt: r.CreatedAt, Files: files[r.ID]})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, origErr
}

// ---- email (signed by the mail service) ----

type InboundEmail struct {
	From          string `json:"from"`
	FromName      string `json:"fromName"`
	Subject       string `json:"subject"`
	Text          string `json:"text"`
	MessageID     string `json:"messageId"`
	AutoSubmitted bool   `json:"autoSubmitted"`
}

var refRe = regexp.MustCompile(`\[#([a-z0-9]{6,12})\]`)

// ReceiveEmail takes one incoming email for a workspace. The mail service signs timestamp + "." + body with the
// workspace's inbound key (HMAC-SHA256, hex). Wrong key, old or future timestamp, or a changed body: refused.
// The same email twice is stored once. Automatic replies (out-of-office and the like) are dropped.
func (s *Service) ReceiveEmail(ctx context.Context, ws uuid.UUID, body []byte, timestamp, signature string) error {
	if len(body) == 0 || len(body) > 256<<10 {
		return ErrInvalid("the message is empty or too large")
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return ErrBadSign
	}
	if d := s.now().Sub(time.Unix(ts, 0)); d > signatureWindow || d < -signatureWindow {
		return ErrBadSign
	}
	var st dbgen.InboxSetting
	if err := store.WithTenant(ctx, s.Pool, tenantFor(ws), func(q *dbgen.Queries) (e error) {
		st, e = q.GetInboxSetting(ctx, ws)
		return e
	}); err != nil || !st.EmailEnabled {
		return ErrBadSign // an unknown workspace and a wrong signature look the same
	}
	h := hmac.New(sha256.New, []byte(s.InboundKey(ws, int(st.InboundEpoch))))
	h.Write([]byte(timestamp + "."))
	h.Write(body)
	want := hex.EncodeToString(h.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(signature, "sha256=")), []byte(want)) != 1 {
		return ErrBadSign
	}
	var in InboundEmail
	if err := json.Unmarshal(body, &in); err != nil {
		return ErrInvalid("the message could not be read")
	}
	if in.AutoSubmitted {
		return nil
	}
	from, err := validEmail(in.From)
	if err != nil || from == "" {
		return ErrInvalid("the sender's address is missing or not valid")
	}
	if len(in.MessageID) == 0 || len(in.MessageID) > 300 {
		return ErrInvalid("the message needs an id of up to 300 characters")
	}
	text := strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(in.Text, "\x00", ""), ""))
	if text == "" {
		return ErrInvalid("the message has no text")
	}
	if utf8.RuneCountInString(text) > MaxReplyText {
		text = string([]rune(text)[:MaxReplyText])
	}
	text = redact.Text(text).Text
	subject := firstWords(strings.TrimSpace(in.Subject))
	if len([]rune(subject)) > 200 {
		subject = string([]rune(subject)[:200])
	}
	name := strings.TrimSpace(strings.ToValidUTF8(in.FromName, ""))
	if utf8.RuneCountInString(name) > 100 {
		name = string([]rune(name)[:100])
	}
	return store.WithTenantTx(ctx, s.Pool, tenantFor(ws), func(tx pgx.Tx, q *dbgen.Queries) error {
		if _, err := q.GetMessageByExternalID(ctx, dbgen.GetMessageByExternalIDParams{WorkspaceID: ws, ExternalID: pgtype.Text{String: in.MessageID, Valid: true}}); err == nil {
			return nil // the same email again
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var conv *dbgen.Conversation
		if m := refRe.FindStringSubmatch(in.Subject); m != nil {
			if c, err := q.GetConversationByRef(ctx, dbgen.GetConversationByRefParams{WorkspaceID: ws, Ref: m[1]}); err == nil && c.CustomerEmail.String == from {
				conv = &c // an answer from the same person to one of our replies
			}
		}
		if conv == nil {
			p := dbgen.InsertConversationParams{WorkspaceID: ws, Channel: "email", Subject: subject, CustomerName: name, CustomerEmail: pgtype.Text{String: from, Valid: true}, Ref: newRef()}
			if pid, e := q.FindPersonByEmail(ctx, dbgen.FindPersonByEmailParams{WorkspaceID: ws, Email: pgtype.Text{String: from, Valid: true}}); e == nil {
				p.PersonID = uuid.NullUUID{UUID: pid, Valid: true}
			}
			c, err := q.InsertConversation(ctx, p)
			if err != nil {
				return err
			}
			conv = &c
		}
		if _, err := q.InsertConversationMessage(ctx, dbgen.InsertConversationMessageParams{WorkspaceID: ws, ConversationID: conv.ID, Direction: "in", Body: text, State: "received", ExternalID: pgtype.Text{String: in.MessageID, Valid: true}}); err != nil {
			return err
		}
		return q.TouchConversation(ctx, dbgen.TouchConversationParams{WorkspaceID: ws, ID: conv.ID, Reopen: true})
	})
}
