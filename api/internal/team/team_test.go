package team_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"product/api/internal/email"
	"product/api/internal/store"
	"product/api/internal/team"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func TestLinksCannotBeForgedOrReused(t *testing.T) {
	l := team.Links{Secret: []byte("a-long-enough-secret-for-tests-0001"), BaseURL: "https://app.example/"}
	ws, inv := uuid.New(), uuid.New()
	tok := l.Token(ws, inv)
	if gw, gi, err := l.Verify(tok); err != nil || gw != ws || gi != inv {
		t.Fatalf("%v %v %v", gw, gi, err)
	}
	if got := l.URL(tok); got != "https://app.example/invite/"+tok {
		t.Errorf("url %s", got)
	}
	other := team.Links{Secret: []byte("another-secret-entirely-0002-xxxxxxx")}
	if _, _, err := other.Verify(tok); err == nil {
		t.Error("a link verified under another secret")
	}
	// the same pieces under a different invitation or workspace do not verify
	swapped := strings.Replace(tok, strings.Split(tok, ".")[2], strings.Split(l.Token(ws, uuid.New()), ".")[2], 1)
	if _, _, err := l.Verify(swapped); err == nil {
		t.Error("a swapped invitation id verified")
	}
	for _, bad := range []string{"", "m.", "x.a.b.c", tok + "x", strings.Repeat("m.", 200), "m.zz.zz.zz"} {
		if _, _, err := l.Verify(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, _, err := (team.Links{}).Verify(tok); err == nil {
		t.Error("verified with no secret")
	}
}

type sent struct {
	mu   sync.Mutex
	msgs []email.Message
}

func (s *sent) Send(_ context.Context, m email.Message) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgs = append(s.msgs, m)
	return "id", nil
}

func TestTheInvitationEmailSaysWhoWhatAndHowLong(t *testing.T) {
	sub, body := team.Message("Acme", "Priya", "admin", "https://app.example/invite/x")
	if !strings.Contains(sub, "Acme") || !strings.Contains(body, "Priya invited you") || !strings.Contains(body, "as an admin") ||
		!strings.Contains(body, "https://app.example/invite/x") || !strings.Contains(body, "7 days") || !strings.Contains(body, "ignore this email") {
		t.Errorf("%s\n%s", sub, body)
	}
	if _, b := team.Message("Acme", "", "viewer", "l"); !strings.Contains(b, "A teammate invited you") || !strings.Contains(b, "as a viewer") {
		t.Errorf("%s", b)
	}
}

func TestOnlyAnOpenInvitationIsEmailedAndNeverToAnythingElse(t *testing.T) {
	db := testdb.New(t)
	db.EnableRiver(t)
	ws, admin := uuid.New(), uuid.New()
	exec := func(q string, a ...any) {
		t.Helper()
		if _, err := db.Super.Exec(ctx, q, a...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO workspace (id, name, sender_name) VALUES ($1, 'Acme', 'Acme Support')`, ws)
	exec(`INSERT INTO member (workspace_id, user_id, role, display_name) VALUES ($1,$2,'admin','Priya')`, ws, admin)
	links := team.Links{Secret: []byte("a-long-enough-secret-for-tests-0001"), BaseURL: "https://app.example"}
	svc := &team.Service{Pool: db.Backend, Links: links}
	r, err := svc.Invite(ctx, store.Tenant{WorkspaceID: ws, UserID: admin, Role: store.RoleAdmin}, "new@acme.com", "member")
	if err != nil {
		t.Fatal(err)
	}
	mail := &sent{}
	w := &team.MailWorker{Pool: db.Backend, Sender: mail, FromAddress: "team@mail.example", ReplyTo: "help@mail.example", Links: links}
	job := func(seq int) *river.Job[team.MailArgs] {
		return &river.Job[team.MailArgs]{Args: team.MailArgs{WorkspaceID: ws, InvitationID: r.ID, Seq: seq}}
	}
	if err := w.Work(ctx, job(1)); err != nil {
		t.Fatal(err)
	}
	if len(mail.msgs) != 1 {
		t.Fatalf("sent %d", len(mail.msgs))
	}
	m := mail.msgs[0]
	if m.To[0] != "new@acme.com" || !strings.Contains(m.Text, "Priya invited you") || !strings.Contains(m.Text, r.Link) ||
		m.From != "Acme Support <team@mail.example>" || m.IdempotencyKey != "team-invite-"+r.ID.String()+"-1" {
		t.Errorf("%+v", m)
	}
	var at *time.Time
	db.Super.QueryRow(ctx, `SELECT last_sent_at FROM invitation WHERE id = $1`, r.ID).Scan(&at)
	if at == nil {
		t.Error("the send was not recorded")
	}
	// revoked or expired invitations send nothing
	exec(`UPDATE invitation SET revoked_at = now() WHERE id = $1`, r.ID)
	if err := w.Work(ctx, job(2)); err != nil || len(mail.msgs) != 1 {
		t.Errorf("a revoked invitation was emailed: %v %d", err, len(mail.msgs))
	}
	exec(`UPDATE invitation SET revoked_at = NULL, expires_at = now() - interval '1 hour' WHERE id = $1`, r.ID)
	if err := w.Work(ctx, job(3)); err != nil || len(mail.msgs) != 1 {
		t.Errorf("an expired invitation was emailed: %v %d", err, len(mail.msgs))
	}
	// no email provider: it waits to be retried rather than pretending
	if err := (&team.MailWorker{Pool: db.Backend, Links: links}).Work(ctx, job(4)); err == nil {
		t.Error("worked without a provider")
	}
}
