package digest_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/digest"
	"product/api/internal/email"
	"product/api/internal/store"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type sentMail struct {
	m email.Message
}

type fakeSender struct {
	mu   sync.Mutex
	sent []email.Message
	fail error // returned for every send while set
}

func (f *fakeSender) Send(_ context.Context, m email.Message) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return "", f.fail
	}
	f.sent = append(f.sent, m)
	return "prov-" + uuid.NewString(), nil
}

func (f *fakeSender) count() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.sent) }

type env struct {
	db     *testdb.DB
	svc    *digest.Service
	mail   *fakeSender
	now    time.Time
	ws     uuid.UUID
	admin  store.Tenant
	member store.Tenant
}

// monday is a Monday at 09:30 UTC, half an hour after the default slot.
var monday = time.Date(2026, 10, 19, 9, 30, 0, 0, time.UTC)

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	// the database is shared by the tests in this package; each starts with no digests set up anywhere
	if _, err := db.Super.Exec(ctx, `TRUNCATE digest_send, digest_recipient, digest_setting`); err != nil {
		t.Fatal(err)
	}
	e := &env{db: db, mail: &fakeSender{}, now: monday, ws: uuid.New()}
	e.svc = &digest.Service{
		Pool: db.Backend, Sender: e.mail, From: "updates@mail.example.com",
		Unsub: digest.Unsubscriber{BaseURL: "https://app.example", Secret: []byte("digest-test-secret-with-enough-length")},
		Now:   func() time.Time { return e.now },
	}
	adminID, memberID := uuid.New(), uuid.New()
	for _, q := range []string{
		fmt.Sprintf(`INSERT INTO workspace (id, name) VALUES ('%s', 'Acme Inc')`, e.ws),
		fmt.Sprintf(`INSERT INTO member (workspace_id, user_id, role) VALUES ('%s','%s','admin'), ('%s','%s','member')`, e.ws, adminID, e.ws, memberID),
	} {
		if _, err := db.Super.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	e.admin = store.Tenant{WorkspaceID: e.ws, UserID: adminID, Role: store.RoleAdmin}
	e.member = store.Tenant{WorkspaceID: e.ws, UserID: memberID, Role: store.RoleMember}
	return e
}

func (e *env) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.db.Super.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

// activity adds a week's worth of things to talk about, dated inside the digest window.
func (e *env) activity(t *testing.T, ws uuid.UUID, title string) {
	t.Helper()
	e.exec(t, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by, created_at) VALUES ($1,'paste','They said hello',$2,$3,$4)`, ws, uuid.NewString(), uuid.New(), e.now.Add(-2*24*time.Hour))
	e.exec(t, `INSERT INTO request (workspace_id, title, created_at) VALUES ($1,$2,$3)`, ws, title, e.now.Add(-24*time.Hour))
}

func (e *env) enable(t *testing.T, emails ...string) {
	t.Helper()
	if err := e.svc.UpdateSettings(ctx, e.admin, true, 1, 9, emails, true); err != nil {
		t.Fatal(err)
	}
}

func TestSlotIsTheLatestScheduledMomentNotInTheFuture(t *testing.T) {
	// the function is internal; check it through behaviour: see TestOnlyDueDigestsAreSent. Here, schedule validation.
	e := setup(t)
	for _, c := range []struct{ day, hour int }{{-1, 9}, {7, 9}, {1, -1}, {1, 24}} {
		if err := e.svc.UpdateSettings(ctx, e.admin, false, c.day, c.hour, nil, false); err == nil {
			t.Errorf("schedule %+v accepted", c)
		}
	}
}

func TestSettingsRules(t *testing.T) {
	e := setup(t)
	// only admins
	if err := e.svc.UpdateSettings(ctx, e.member, false, 1, 9, nil, false); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member changed the digest: %v", err)
	}
	// turning on needs a recipient and the confirmation
	if err := e.svc.UpdateSettings(ctx, e.admin, true, 1, 9, nil, true); err == nil {
		t.Error("enabled with nobody to send to")
	}
	if err := e.svc.UpdateSettings(ctx, e.admin, true, 1, 9, []string{"a@example.com"}, false); err == nil {
		t.Error("enabled without confirming the recipients agreed")
	}
	// bad addresses and too many
	for _, bad := range []string{"nonsense", "Name <a@example.com>", "a@example.com\r\nBcc: x@y.z", ""} {
		if err := e.svc.UpdateSettings(ctx, e.admin, false, 1, 9, []string{bad}, false); err == nil {
			t.Errorf("address %q accepted", bad)
		}
	}
	many := []string{}
	for i := 0; i < digest.MaxRecipients+1; i++ {
		many = append(many, fmt.Sprintf("p%d@example.com", i))
	}
	if err := e.svc.UpdateSettings(ctx, e.admin, false, 1, 9, many, false); err == nil {
		t.Error("too many recipients accepted")
	}
	// a good one: lower-cased, de-duplicated, replaced on the next save
	e.enable(t, "Ana@Example.com", "ana@example.com", "bo@example.com")
	st, _ := e.svc.GetSettings(ctx, e.admin)
	if !st.Enabled || len(st.Recipients) != 2 || st.Recipients[0].Email != "ana@example.com" {
		t.Fatalf("%+v", st)
	}
	e.enable(t, "bo@example.com")
	if st, _ = e.svc.GetSettings(ctx, e.member); len(st.Recipients) != 1 { // members can see it
		t.Errorf("%+v", st)
	}
	// defaults for a workspace that never set it up
	fresh := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	e.exec(t, `INSERT INTO workspace (id, name) VALUES ($1, 'Other')`, fresh.WorkspaceID)
	if st, _ := e.svc.GetSettings(ctx, fresh); st.Enabled || st.Weekday != 1 || st.HourUTC != 9 || len(st.Recipients) != 0 {
		t.Errorf("defaults: %+v", st)
	}
}

func TestEachPersonGetsOneEmailPerWeekEvenWhenRunConcurrently(t *testing.T) {
	e := setup(t)
	e.activity(t, e.ws, "Single sign-on")
	e.enable(t, "ana@example.com", "bo@example.com")

	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = e.svc.RunDue(ctx) }()
	}
	wg.Wait()
	for i := 0; i < 3; i++ {
		_, _ = e.svc.RunDue(ctx)
	}
	if e.mail.count() != 2 {
		t.Fatalf("sent %d emails, want 2 (one each)", e.mail.count())
	}
	got := map[string]email.Message{}
	for _, m := range e.mail.sent {
		got[m.To[0]] = m
	}
	for _, to := range []string{"ana@example.com", "bo@example.com"} {
		m, ok := got[to]
		if !ok {
			t.Fatalf("nothing sent to %s", to)
		}
		if len(m.To) != 1 {
			t.Errorf("one message must go to one person: %v", m.To)
		}
		if !strings.Contains(m.Subject, "Acme Inc") || !strings.Contains(m.Text, "1 new conversation") || !strings.Contains(m.Text, "Single sign-on") {
			t.Errorf("content:\n%s\n%s", m.Subject, m.Text)
		}
		if m.Headers["List-Unsubscribe"] == "" || m.Headers["List-Unsubscribe-Post"] == "" || !strings.Contains(m.Text, "/digest/unsubscribe/") {
			t.Errorf("no unsubscribe: %v", m.Headers)
		}
		if strings.Contains(m.Text, to) {
			t.Errorf("the recipient's address is in the body")
		}
		if !strings.HasPrefix(m.IdempotencyKey, "digest-") {
			t.Errorf("key %q", m.IdempotencyKey)
		}
	}
	if got["ana@example.com"].IdempotencyKey == got["bo@example.com"].IdempotencyKey {
		t.Error("two people share one idempotency key")
	}
	// next week it goes again
	e.now = monday.Add(7 * 24 * time.Hour)
	e.activity(t, e.ws, "Dark mode")
	_, _ = e.svc.RunDue(ctx)
	if e.mail.count() != 4 {
		t.Errorf("the following week: %d emails in all, want 4", e.mail.count())
	}
}

func TestOnlyDueDigestsAreSent(t *testing.T) {
	e := setup(t)
	e.activity(t, e.ws, "R")
	e.enable(t, "ana@example.com")
	cases := map[string]time.Time{
		"before the slot on the right day (the last slot was six days ago, too old)": time.Date(2026, 10, 19, 8, 59, 0, 0, time.UTC).Add(0),
		"three days after the slot": time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC),
		"a week after":              time.Date(2026, 10, 26, 8, 0, 0, 0, time.UTC),
	}
	for name, at := range cases {
		e.now = at
		_, _ = e.svc.RunDue(ctx)
		if e.mail.count() != 0 {
			t.Errorf("%s: sent", name)
		}
	}
	// one day late (the process was down) still goes out, once
	e.now = time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	_, _ = e.svc.RunDue(ctx)
	_, _ = e.svc.RunDue(ctx)
	if e.mail.count() != 1 {
		t.Errorf("a day late: %d", e.mail.count())
	}
	// switched off: nothing
	e2 := setup(t)
	e2.activity(t, e2.ws, "R")
	e2.enable(t, "ana@example.com")
	if err := e2.svc.UpdateSettings(ctx, e2.admin, false, 1, 9, []string{"ana@example.com"}, false); err != nil {
		t.Fatal(err)
	}
	_, _ = e2.svc.RunDue(ctx)
	if e2.mail.count() != 0 {
		t.Error("a switched-off digest was sent")
	}
}

func TestUnsubscribeStopsItForThatPersonOnly(t *testing.T) {
	e := setup(t)
	e.activity(t, e.ws, "R")
	e.enable(t, "ana@example.com", "bo@example.com")
	var anaID uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `SELECT id FROM digest_recipient WHERE email='ana@example.com'`).Scan(&anaID); err != nil {
		t.Fatal(err)
	}
	tok := e.svc.Unsub.Token(e.ws, anaID)
	masked, err := e.svc.Info(ctx, tok)
	if err != nil || masked != "a***@example.com" {
		t.Fatalf("info: %q %v", masked, err)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM digest_recipient WHERE unsubscribed_at IS NOT NULL`).Scan(&n)
	if n != 0 {
		t.Fatal("looking at the page unsubscribed someone")
	}
	for i := 0; i < 2; i++ { // twice is harmless
		if err := e.svc.Unsubscribe(ctx, tok); err != nil {
			t.Fatal(err)
		}
	}
	_, _ = e.svc.RunDue(ctx)
	if e.mail.count() != 1 || e.mail.sent[0].To[0] != "bo@example.com" {
		t.Fatalf("sent: %v", e.mail.sent)
	}
	// an admin saving the list again does not bring her back
	e.enable(t, "ana@example.com", "bo@example.com")
	e.now = monday.Add(7 * 24 * time.Hour)
	_, _ = e.svc.RunDue(ctx)
	for _, m := range e.mail.sent {
		if m.To[0] == "ana@example.com" {
			t.Fatal("an unsubscribed person was emailed")
		}
	}
	// links that are not ours
	for _, bad := range []string{"", "abc", tok[:len(tok)-2] + "AA", e.svc.Unsub.Token(uuid.New(), anaID), e.svc.Unsub.Token(e.ws, uuid.New())} {
		if _, err := e.svc.Info(ctx, bad); err == nil {
			t.Errorf("link %q accepted", bad)
		}
		if err := e.svc.Unsubscribe(ctx, bad); err == nil {
			t.Errorf("link %q accepted for unsubscribing", bad)
		}
	}
	// a link signed with another secret
	other := digest.Unsubscriber{BaseURL: "x", Secret: []byte("another-secret-another-secret-0000")}
	if err := e.svc.Unsubscribe(ctx, other.Token(e.ws, anaID)); err == nil {
		t.Error("a link signed with another key was accepted")
	}
}

func TestAQuietWorkspaceGetsNothingAndAnEmptyWeekIsSkippedOnce(t *testing.T) {
	e := setup(t)
	e.enable(t, "ana@example.com")
	_, _ = e.svc.RunDue(ctx)
	_, _ = e.svc.RunDue(ctx)
	if e.mail.count() != 0 {
		t.Fatal("an empty workspace was emailed")
	}
	var skipped int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM digest_send WHERE state='skipped'`).Scan(&skipped)
	if skipped != 1 {
		t.Errorf("skipped rows: %d, want 1 (not recomputed every run)", skipped)
	}
	// the preview still shows what it would say
	d, err := e.svc.Preview(ctx, e.admin)
	if err != nil || !d.Empty || !strings.Contains(d.Text, "A quiet week") {
		t.Errorf("preview: %+v %v", d, err)
	}
}

func TestFailuresAreRetriedAndGivenUp(t *testing.T) {
	e := setup(t)
	e.activity(t, e.ws, "R")
	e.enable(t, "ana@example.com")
	e.mail.fail = email.ErrTransient
	for i := 0; i < 5; i++ {
		_, _ = e.svc.RunDue(ctx)
	}
	var attempts int
	var state string
	e.db.Super.QueryRow(ctx, `SELECT attempts, state FROM digest_send`).Scan(&attempts, &state)
	if attempts != 3 || state != "failed" {
		t.Errorf("after repeated failure: %d attempts, %s; want it to stop at 3", attempts, state)
	}
	// a run that recovers before giving up sends exactly once
	e2 := setup(t)
	e2.activity(t, e2.ws, "R")
	e2.enable(t, "ana@example.com")
	e2.mail.fail = email.ErrTransient
	_, _ = e2.svc.RunDue(ctx)
	e2.mail.fail = nil
	for i := 0; i < 3; i++ {
		_, _ = e2.svc.RunDue(ctx)
	}
	if e2.mail.count() != 1 {
		t.Errorf("after recovery: %d emails", e2.mail.count())
	}
}

func TestNothingIsSentOrClaimedWithoutEmailConfigured(t *testing.T) {
	e := setup(t)
	e.activity(t, e.ws, "R")
	e.enable(t, "ana@example.com")
	e.svc.Sender = nil
	if n, err := e.svc.RunDue(ctx); n != 0 || err != nil {
		t.Errorf("%d %v", n, err)
	}
	var rows int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM digest_send`).Scan(&rows)
	if rows != 0 {
		t.Error("a week was claimed with nothing able to send, so it would never be sent later")
	}
	// once configured, it goes out
	e.svc.Sender = e.mail
	_, _ = e.svc.RunDue(ctx)
	if e.mail.count() != 1 {
		t.Error("not sent after email was configured")
	}
}

func TestADigestNeverMentionsAnotherWorkspace(t *testing.T) {
	e := setup(t)
	e.activity(t, e.ws, "Our own request")
	other := uuid.New()
	e.exec(t, `INSERT INTO workspace (id, name) VALUES ($1, 'Rival Corp')`, other)
	e.activity(t, other, "Rival secret plan")
	e.exec(t, `INSERT INTO digest_setting (workspace_id, enabled) VALUES ($1, true)`, other)
	e.enable(t, "ana@example.com")
	_, _ = e.svc.RunDue(ctx)
	if e.mail.count() != 1 {
		t.Fatalf("sent %d", e.mail.count())
	}
	m := e.mail.sent[0]
	if strings.Contains(m.Text, "Rival") || strings.Contains(m.Subject, "Rival") || !strings.Contains(m.Text, "Our own request") {
		t.Errorf("content crossed workspaces:\n%s", m.Text)
	}
}

func TestALargeWorkspaceStaysShort(t *testing.T) {
	e := setup(t)
	e.exec(t, `INSERT INTO request (workspace_id, title, created_at) SELECT $1, 'Request number ' || g, $2 FROM generate_series(1, 3000) g`, e.ws, e.now.Add(-time.Hour))
	e.exec(t, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by, created_at)
		SELECT $1, 'paste', 'text ' || g, 'h' || g, $3, $2 FROM generate_series(1, 3000) g`, e.ws, e.now.Add(-time.Hour), uuid.New())
	start := time.Now()
	d, err := e.svc.Preview(ctx, e.admin)
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 3*time.Second {
		t.Errorf("took %v", time.Since(start))
	}
	if !strings.Contains(d.Text, "3000 new requests") || !strings.Contains(d.Text, "3000 new conversations") {
		t.Errorf("counts:\n%s", d.Text)
	}
	if lines := strings.Count(d.Text, "\n"); lines > 40 {
		t.Errorf("a big workspace made a %d-line email", lines)
	}
}
