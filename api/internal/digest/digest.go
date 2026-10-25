// Package digest sends the team a weekly summary by email. It is off until an admin turns it on,
// names the recipients and confirms they agreed to receive it. Every email carries a link that
// stops it for that person, and each (week, person) is claimed in the database before sending, so
// nobody gets two.
package digest

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/email"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("digest: not found")
	ErrBadToken = errors.New("digest: invalid unsubscribe link")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

const MaxRecipients = 10

// Service builds and sends digests. With no Sender nothing is ever sent (settings and previews still work).
type Service struct {
	Pool    *pgxpool.Pool
	Sender  email.Sender
	From    string // verified sending address
	ReplyTo string
	Unsub   Unsubscriber
	Now     func() time.Time
	Log     *slog.Logger
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// ---- unsubscribe links ----

// Unsubscriber signs the link at the bottom of each digest. It names the workspace and the
// recipient row, never an address, so it is safe in logs and browser history.
type Unsubscriber struct {
	BaseURL string
	Secret  []byte
}

func (u Unsubscriber) mac(p []byte) []byte {
	h := hmac.New(sha256.New, u.Secret)
	h.Write([]byte("digest-unsubscribe-v1"))
	h.Write(p)
	return h.Sum(nil)[:16]
}

func (u Unsubscriber) Token(ws, recipient uuid.UUID) string {
	p := append(append([]byte{}, ws[:]...), recipient[:]...)
	return base64.RawURLEncoding.EncodeToString(append(p, u.mac(p)...))
}

func (u Unsubscriber) URL(ws, recipient uuid.UUID) string {
	return u.BaseURL + "/digest/unsubscribe/" + u.Token(ws, recipient)
}

func (u Unsubscriber) Verify(token string) (ws, recipient uuid.UUID, err error) {
	raw, derr := base64.RawURLEncoding.DecodeString(token)
	if derr != nil || len(raw) != 48 || len(u.Secret) == 0 {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	if !hmac.Equal(raw[32:], u.mac(raw[:32])) {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	copy(ws[:], raw[:16])
	copy(recipient[:], raw[16:32])
	return ws, recipient, nil
}

func systemTenant(ws uuid.UUID) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
}

// Info and Unsubscribe serve the public unsubscribe page.
func (s *Service) Info(ctx context.Context, token string) (maskedEmail string, err error) {
	ws, rid, err := s.Unsub.Verify(token)
	if err != nil {
		return "", err
	}
	err = store.WithTenant(ctx, s.Pool, systemTenant(ws), func(q *dbgen.Queries) error {
		r, gerr := q.GetDigestRecipient(ctx, dbgen.GetDigestRecipientParams{WorkspaceID: ws, ID: rid})
		if gerr != nil {
			return ErrBadToken
		}
		maskedEmail = mask(r.Email)
		return nil
	})
	return maskedEmail, err
}

func (s *Service) Unsubscribe(ctx context.Context, token string) error {
	ws, rid, err := s.Unsub.Verify(token)
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, s.Pool, systemTenant(ws), func(q *dbgen.Queries) error {
		n, err := q.UnsubscribeDigestRecipient(ctx, dbgen.UnsubscribeDigestRecipientParams{WorkspaceID: ws, ID: rid})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrBadToken
		}
		return nil
	})
}

func mask(e string) string {
	at := strings.LastIndex(e, "@")
	if at < 1 {
		return "***"
	}
	return e[:1] + "***" + e[at:]
}

// ---- settings ----

type Recipient struct {
	Email        string
	Unsubscribed bool
}

type Settings struct {
	Enabled    bool
	Weekday    int // 0 = Sunday
	HourUTC    int
	Recipients []Recipient
}

func (s *Service) GetSettings(ctx context.Context, t store.Tenant) (Settings, error) {
	out := Settings{Weekday: 1, HourUTC: 9, Recipients: []Recipient{}}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		st, err := q.GetDigestSetting(ctx, t.WorkspaceID)
		if err == nil {
			out.Enabled, out.Weekday, out.HourUTC = st.Enabled, int(st.Weekday), int(st.HourUtc)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		rs, err := q.ListDigestRecipients(ctx, t.WorkspaceID)
		for _, r := range rs {
			out.Recipients = append(out.Recipients, Recipient{Email: r.Email, Unsubscribed: r.UnsubscribedAt.Valid})
		}
		return err
	})
	return out, err
}

// UpdateSettings (admins only) replaces the schedule and the recipient list. Turning the digest on
// needs at least one recipient and the admin's confirmation that they agreed to receive it.
func (s *Service) UpdateSettings(ctx context.Context, t store.Tenant, enabled bool, weekday, hour int, emails []string, confirmed bool) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	if weekday < 0 || weekday > 6 || hour < 0 || hour > 23 {
		return ErrInvalid("choose a day and an hour")
	}
	if len(emails) > MaxRecipients {
		return ErrInvalid(fmt.Sprintf("a digest can go to at most %d people", MaxRecipients))
	}
	seen := map[string]bool{}
	clean := []string{}
	for _, e := range emails {
		a, err := mail.ParseAddress(strings.TrimSpace(e))
		if err != nil || a.Name != "" || len(a.Address) > 320 || strings.ContainsAny(a.Address, "\r\n") {
			return ErrInvalid("one of the email addresses does not look right")
		}
		l := strings.ToLower(a.Address)
		if !seen[l] {
			seen[l] = true
			clean = append(clean, l)
		}
	}
	if enabled && len(clean) == 0 {
		return ErrInvalid("add at least one recipient before turning the digest on")
	}
	if enabled && !confirmed {
		return ErrInvalid("confirm that the people listed have agreed to receive this email")
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		if err := q.UpsertDigestSetting(ctx, dbgen.UpsertDigestSettingParams{WorkspaceID: t.WorkspaceID, Enabled: enabled, Weekday: int16(weekday), HourUtc: int16(hour)}); err != nil {
			return err
		}
		for _, e := range clean {
			if err := q.AddDigestRecipient(ctx, dbgen.AddDigestRecipientParams{WorkspaceID: t.WorkspaceID, Email: e}); err != nil {
				return err
			}
		}
		return q.RemoveDigestRecipientsExcept(ctx, dbgen.RemoveDigestRecipientsExceptParams{WorkspaceID: t.WorkspaceID, Column2: clean})
	})
}

// ---- content ----

type Digest struct {
	Subject string
	Text    string // without the unsubscribe footer, which is per person
	Empty   bool   // nothing happened and nothing is waiting
}

// Build writes the digest for the week ending at `end`. Plain text, no AI, no customer quotes.
func (s *Service) Build(ctx context.Context, ws uuid.UUID, end time.Time) (Digest, error) {
	since := end.Add(-7 * 24 * time.Hour)
	t := systemTenant(ws)
	var name string
	var c dbgen.DigestCountsRow
	var top []dbgen.DigestTopRequestsRow
	var fresh, shipped []string
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) (err error) {
		if name, err = q.GetWorkspaceName(ctx, ws); err != nil {
			return err
		}
		if c, err = q.DigestCounts(ctx, dbgen.DigestCountsParams{Ws: ws, Since: since}); err != nil {
			return err
		}
		if top, err = q.DigestTopRequests(ctx, ws); err != nil {
			return err
		}
		if fresh, err = q.DigestNewRequests(ctx, dbgen.DigestNewRequestsParams{WorkspaceID: ws, CreatedAt: since}); err != nil {
			return err
		}
		shipped, err = q.DigestShipped(ctx, dbgen.DigestShippedParams{WorkspaceID: ws, CreatedAt: since})
		return err
	})
	if err != nil {
		return Digest{}, err
	}
	d := Digest{Subject: fmt.Sprintf("Weekly digest: %s (%s to %s)", name, since.Format("Jan 2"), end.Format("Jan 2")),
		Empty: c.Conversations == 0 && c.NewRequests == 0 && c.WaitingForReview == 0 && c.NewVotes == 0 && c.MessagesSent == 0 && len(shipped) == 0}
	var b strings.Builder
	app := s.Unsub.BaseURL + "/w/" + ws.String()
	fmt.Fprintf(&b, "Weekly digest for %s\n%s to %s (UTC)\n\n", name, since.Format("Mon Jan 2"), end.Format("Mon Jan 2"))
	b.WriteString("This week\n")
	fmt.Fprintf(&b, "- %s", plural(int(c.Conversations), "new conversation", "new conversations"))
	if c.FormSubmissions > 0 {
		fmt.Fprintf(&b, " (%d from your website form)", c.FormSubmissions)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "- %s\n", plural(int(c.NewRequests), "new request", "new requests"))
	fmt.Fprintf(&b, "- %s sent to customers about things you shipped\n", plural(int(c.MessagesSent), "message", "messages"))
	fmt.Fprintf(&b, "- %s on the public roadmap\n\n", plural(int(c.NewVotes), "new vote", "new votes"))
	if c.WaitingForReview > 0 {
		fmt.Fprintf(&b, "Waiting for you\n- %s waiting for review: %s/review\n\n", plural(int(c.WaitingForReview), "suggestion is", "suggestions are"), app)
	}
	if len(shipped) > 0 {
		b.WriteString("Shipped (customers were offered a message)\n")
		for _, x := range shipped {
			fmt.Fprintf(&b, "- %s\n", oneLine(x))
		}
		b.WriteString("\n")
	}
	if len(fresh) > 0 {
		b.WriteString("New requests\n")
		for _, x := range fresh {
			fmt.Fprintf(&b, "- %s\n", oneLine(x))
		}
		b.WriteString("\n")
	}
	if len(top) > 0 {
		b.WriteString("Most valuable open requests\n")
		for i, r := range top {
			fmt.Fprintf(&b, "%d. %s: %s from %s", i+1, oneLine(r.Title), plural(int(r.EvidenceCount), "quote", "quotes"), plural(int(r.PeopleCount), "person", "people"))
			if r.TotalValue > 0 {
				fmt.Fprintf(&b, ", worth %s", money(r.TotalValue))
			}
			fmt.Fprintf(&b, " (%s)\n", oneLine(r.StatusName))
		}
		b.WriteString("\n")
	}
	if d.Empty {
		b.WriteString("A quiet week: nothing new and nothing waiting.\n\n")
	}
	fmt.Fprintf(&b, "Open the workspace: %s\n", app)
	d.Text = b.String()
	return d, nil
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

func oneLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) > 120 {
		return string([]rune(s)[:119]) + "…"
	}
	return s
}

func money(v float64) string {
	n := int64(v + 0.5)
	s := fmt.Sprint(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return "$" + s
}

// Preview is the digest as it would read if it went out now (admins only; nothing is sent).
func (s *Service) Preview(ctx context.Context, t store.Tenant) (Digest, error) {
	return s.Build(ctx, t.WorkspaceID, s.now())
}

// ---- sending ----

// lastSlot is the most recent scheduled moment at or before now.
func lastSlot(now time.Time, weekday, hour int) time.Time {
	now = now.UTC()
	d := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, time.UTC)
	for int(d.Weekday()) != weekday || d.After(now) {
		d = d.AddDate(0, 0, -1)
	}
	return d
}

// catchUp is how long after its slot a digest may still go out (for example after downtime).
const catchUp = 48 * time.Hour

// RunDue sends every digest whose slot has passed and has not been sent. Safe to call as often as
// you like and from several processes: each (week, person) is claimed before it is sent.
func (s *Service) RunDue(ctx context.Context) (sent int, err error) {
	if s.Sender == nil || s.From == "" || len(s.Unsub.Secret) == 0 {
		return 0, nil // email is not configured: nothing can go out
	}
	rows, err := s.Pool.Query(ctx, `SELECT workspace_id, weekday, hour_utc FROM digest_workspaces()`)
	if err != nil {
		return 0, err
	}
	type due struct {
		ws            uuid.UUID
		weekday, hour int
	}
	var all []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.ws, &d.weekday, &d.hour); err != nil {
			rows.Close()
			return 0, err
		}
		all = append(all, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	now := s.now()
	var firstErr error
	for _, d := range all {
		slot := lastSlot(now, d.weekday, d.hour)
		if now.Sub(slot) > catchUp {
			continue
		}
		n, err := s.sendWorkspace(ctx, d.ws, slot)
		sent += n
		if err != nil && firstErr == nil {
			firstErr = fmt.Errorf("digest for %s: %w", d.ws, err)
		}
	}
	return sent, firstErr
}

func (s *Service) sendWorkspace(ctx context.Context, ws uuid.UUID, slot time.Time) (int, error) {
	t := systemTenant(ws)
	period := pgtype.Date{Time: time.Date(slot.Year(), slot.Month(), slot.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
	var recipients []dbgen.DigestRecipient
	var senderName string
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rs, err := q.ListDigestRecipients(ctx, ws)
		if err != nil {
			return err
		}
		for _, r := range rs {
			if !r.UnsubscribedAt.Valid {
				recipients = append(recipients, r)
			}
		}
		set, err := q.GetWorkspaceSettings(ctx, ws)
		if err != nil {
			return err
		}
		senderName = set.SenderName
		if senderName == "" {
			senderName = set.Name
		}
		return nil
	})
	if err != nil || len(recipients) == 0 {
		return 0, err
	}
	sort.Slice(recipients, func(i, j int) bool { return recipients[i].Email < recipients[j].Email })
	var d Digest
	built := false
	sent := 0
	for _, r := range recipients {
		var claimed bool
		err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
			_, cerr := q.ClaimDigestSend(ctx, dbgen.ClaimDigestSendParams{WorkspaceID: ws, PeriodStart: period, RecipientID: r.ID})
			if errors.Is(cerr, pgx.ErrNoRows) {
				return nil // already sent, being sent, or given up on
			}
			claimed = cerr == nil
			return cerr
		})
		if err != nil {
			return sent, err
		}
		if !claimed {
			continue
		}
		if !built {
			if d, err = s.Build(ctx, ws, slot); err != nil {
				s.finish(ctx, t, ws, period, r.ID, "failed", "")
				return sent, err
			}
			built = true
		}
		if d.Empty {
			s.finish(ctx, t, ws, period, r.ID, "skipped", "")
			continue
		}
		link := s.Unsub.URL(ws, r.ID)
		id, serr := s.Sender.Send(ctx, email.Message{
			From: fmt.Sprintf("%s <%s>", senderName, s.From), ReplyTo: s.ReplyTo, To: []string{r.Email},
			Subject: d.Subject, Text: d.Text + "\n--\nYou are getting this weekly summary because an admin of this workspace added you. To stop it, unsubscribe: " + link,
			IdempotencyKey: fmt.Sprintf("digest-%s-%s-%s", ws, period.Time.Format("2006-01-02"), r.ID),
			Tags:           map[string]string{"kind": "weekly_digest"},
			Headers:        map[string]string{"List-Unsubscribe": "<" + link + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
		})
		if serr != nil {
			s.finish(ctx, t, ws, period, r.ID, "failed", "")
			s.log().Warn("digest not sent", "workspace_id", ws, "transient", errors.Is(serr, email.ErrTransient))
			continue
		}
		s.finish(ctx, t, ws, period, r.ID, "sent", id)
		sent++
	}
	return sent, nil
}

func (s *Service) finish(ctx context.Context, t store.Tenant, ws uuid.UUID, period pgtype.Date, rid uuid.UUID, state, providerID string) {
	rec := context.WithoutCancel(ctx) // an email already sent must be recorded even if the caller gave up
	var pid pgtype.Text
	if providerID != "" {
		pid = pgtype.Text{String: providerID, Valid: true}
	}
	if err := store.WithTenant(rec, s.Pool, t, func(q *dbgen.Queries) error {
		return q.FinishDigestSend(rec, dbgen.FinishDigestSendParams{WorkspaceID: ws, PeriodStart: period, RecipientID: rid, State: state, ProviderMessageID: pid})
	}); err != nil {
		s.log().Error("could not record a digest send", "workspace_id", ws, "state", state)
	}
}

func (s *Service) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

// Loop checks for due digests every few minutes until ctx ends.
func (s *Service) Loop(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = 10 * time.Minute
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		if _, err := s.RunDue(ctx); err != nil {
			s.log().Error("weekly digest run failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
