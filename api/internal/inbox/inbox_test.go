package inbox_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/email"
	"product/api/internal/inbox"
	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

const origin = "https://shop.example"

type fakeSender struct {
	mu   sync.Mutex
	sent []email.Message
	fail error
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
	db      *testdb.DB
	svc     *inbox.Service
	worker  *inbox.ReplyWorker
	mail    *fakeSender
	now     time.Time
	ws      uuid.UUID
	admin   store.Tenant
	member  store.Tenant
	member2 store.Tenant
	viewer  store.Tenant
	other   store.Tenant
	widget  string
	key     string
	secret  []byte
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	secret := []byte("inbox-test-secret-with-enough-length-0123456789")
	e := &env{db: db, mail: &fakeSender{}, ws: uuid.New(), secret: secret, now: time.Now()}
	e.worker = &inbox.ReplyWorker{Pool: db.Backend, Sender: e.mail, FromAddress: "support@mail.example.com", ReplyTo: "inbound@mail.example.com", HashKey: secret}
	workers := river.NewWorkers()
	river.AddWorker(workers, e.worker)
	river.AddWorker(workers, &intake.ExtractWorker{Pool: db.Backend})
	jc, err := jobs.NewClient(db.Backend, workers, nil)
	if err != nil {
		t.Fatal(err)
	}
	e.svc = &inbox.Service{Pool: db.Backend, Jobs: jc, Intake: &intake.Service{Pool: db.Backend, Jobs: jc}, Secret: secret, Now: func() time.Time { return e.now }}
	mk := func(ws uuid.UUID, role store.Role) store.Tenant {
		return store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: role}
	}
	e.admin, e.member, e.member2, e.viewer = mk(e.ws, store.RoleAdmin), mk(e.ws, store.RoleMember), mk(e.ws, store.RoleMember), mk(e.ws, store.RoleViewer)
	e.other = mk(uuid.New(), store.RoleAdmin)
	for _, ten := range []store.Tenant{e.admin, e.member, e.member2, e.viewer, e.other} {
		e.q(t, `INSERT INTO workspace (id, name) VALUES ($1, 'Shop Support') ON CONFLICT DO NOTHING`, ten.WorkspaceID)
		e.q(t, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,$3)`, ten.WorkspaceID, ten.UserID, string(ten.Role))
	}
	st, err := e.svc.UpdateSettings(ctx, e.admin, inbox.SettingsInput{ChatEnabled: true, EmailEnabled: true, Origins: []string{origin}, Greeting: "Hi! How can we help?"})
	if err != nil {
		t.Fatal(err)
	}
	e.widget, e.key = st.WidgetToken, st.InboundKey
	return e
}

func (e *env) q(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.db.Super.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func visitor(n int) string { return fmt.Sprintf("visitor-key-%016d", n) }

func (e *env) chat(t *testing.T, v int, text string) error {
	t.Helper()
	return e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(v), Text: text, Addr: "203.0.113." + strconv.Itoa(v%250)})
}

func (e *env) conversations(t *testing.T, tn store.Tenant) []inbox.Summary {
	t.Helper()
	l, _, err := e.svc.List(ctx, tn, inbox.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func (e *env) sendEmail(t *testing.T, in inbox.InboundEmail) error {
	t.Helper()
	body, _ := json.Marshal(in)
	return e.svc.ReceiveEmail(ctx, e.ws, body, strconv.FormatInt(e.now.Unix(), 10), sign(e.key, strconv.FormatInt(e.now.Unix(), 10), body))
}

func sign(key, ts string, body []byte) string {
	h := hmac.New(sha256.New, []byte(key))
	h.Write([]byte(ts + "."))
	h.Write(body)
	return "sha256=" + hex.EncodeToString(h.Sum(nil))
}

func (e *env) runReply(t *testing.T, id uuid.UUID) error {
	t.Helper()
	return e.worker.Work(ctx, &river.Job[inbox.ReplyArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: inbox.ReplyArgs{WorkspaceID: e.ws, MessageID: id, UserID: e.member.UserID}})
}

// ---------------- settings ----------------

func TestOnlyAdminsChangeTheChannelsAndKeysCanBeRetired(t *testing.T) {
	e := setup(t)
	if _, err := e.svc.UpdateSettings(ctx, e.member, inbox.SettingsInput{ChatEnabled: false}); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member changed the settings: %v", err)
	}
	for name, in := range map[string]inbox.SettingsInput{
		"chat with no sites": {ChatEnabled: true},
		"a path":             {ChatEnabled: true, Origins: []string{"https://a.example/chat"}},
		"a wildcard":         {ChatEnabled: true, Origins: []string{"https://*.example.com"}},
		"plain http":         {ChatEnabled: true, Origins: []string{"http://shop.example"}},
		"credentials":        {ChatEnabled: true, Origins: []string{"https://u:p@a.example"}},
		"too many":           {ChatEnabled: true, Origins: []string{"https://1.example", "https://2.example", "https://3.example", "https://4.example", "https://5.example", "https://6.example", "https://7.example", "https://8.example", "https://9.example", "https://10.example", "https://11.example"}},
		"a long greeting":    {ChatEnabled: true, Origins: []string{origin}, Greeting: strings.Repeat("x", 301)},
	} {
		if _, err := e.svc.UpdateSettings(ctx, e.admin, in); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// a fresh widget address ends the old one at once; so does a fresh inbound key
	old, oldKey := e.widget, e.key
	st, err := e.svc.UpdateSettings(ctx, e.admin, inbox.SettingsInput{ChatEnabled: true, EmailEnabled: true, Origins: []string{origin}, RotateWidget: true, RotateInbound: true})
	if err != nil || st.WidgetToken == old || st.InboundKey == oldKey {
		t.Fatalf("rotate: %+v %v", st, err)
	}
	if _, err := e.svc.Config(ctx, old, origin); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("the retired widget address still works: %v", err)
	}
	if _, err := e.svc.Config(ctx, st.WidgetToken, origin); err != nil {
		t.Errorf("the new widget address: %v", err)
	}
	e.key = oldKey
	if err := e.sendEmail(t, inbox.InboundEmail{From: "a@b.co", Text: "hi", MessageID: "m-retired"}); !errors.Is(err, inbox.ErrBadSign) {
		t.Errorf("the retired inbound key still signs: %v", err)
	}
	// switching a channel off makes it look like any other missing page
	e.svc.UpdateSettings(ctx, e.admin, inbox.SettingsInput{ChatEnabled: false, EmailEnabled: false})
	if _, err := e.svc.Config(ctx, st.WidgetToken, origin); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("a switched-off widget: %v", err)
	}
}

// ---------------- website chat ----------------

func TestChatOnlyWorksFromListedSitesWithAGenuineWidgetAddress(t *testing.T) {
	e := setup(t)
	cfg, err := e.svc.Config(ctx, e.widget, origin)
	if err != nil || cfg.Greeting != "Hi! How can we help?" || cfg.WorkspaceName != "Shop Support" {
		t.Fatalf("config %+v %v", cfg, err)
	}
	for name, o := range map[string]string{"another site": "https://evil.example", "a look-alike": "https://shop.example.evil.com", "wrong scheme": "http://shop.example", "empty": ""} {
		if _, err := e.svc.Config(ctx, e.widget, o); !errors.Is(err, inbox.ErrOrigin) {
			t.Errorf("%s: %v", name, err)
		}
		if err := e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: o, Visitor: visitor(1), Text: "hello"}); !errors.Is(err, inbox.ErrOrigin) {
			t.Errorf("send from %s: %v", name, err)
		}
	}
	parts := strings.Split(e.widget, ".")
	for name, tok := range map[string]string{
		"empty":               "",
		"garbage":             "hello",
		"a made-up signature": strings.Join([]string{parts[0], parts[1], parts[2], "AAAAAAAAAAAAAAAAAAAAAA"}, "."),
		"another workspace":   strings.Join([]string{parts[0], strings.Repeat("0", 32), parts[2], parts[3]}, "."),
		"too long":            e.widget + strings.Repeat("a", 200),
	} {
		if _, err := e.svc.Config(ctx, tok, origin); !errors.Is(err, inbox.ErrNotFound) {
			t.Errorf("%s: %v", name, err)
		}
		if err := e.svc.ChatSend(ctx, inbox.ChatInput{Token: tok, Origin: origin, Visitor: visitor(1), Text: "hello"}); !errors.Is(err, inbox.ErrNotFound) {
			t.Errorf("send with %s: %v", name, err)
		}
	}
	if n := len(e.conversations(t, e.admin)); n != 0 {
		t.Errorf("%d conversations from refused attempts", n)
	}
}

func TestAVisitorsMessagesAreCheckedStoredAsTextAndPrivate(t *testing.T) {
	e := setup(t)
	for name, in := range map[string]inbox.ChatInput{
		"no browser id":    {Visitor: "", Text: "hi"},
		"a short id":       {Visitor: "short", Text: "hi"},
		"nothing written":  {Visitor: visitor(2), Text: "   "},
		"a very long text": {Visitor: visitor(2), Text: strings.Repeat("x", 2001)},
		"a bad address":    {Visitor: visitor(2), Text: "hi", Email: "not an email"},
		"a long name":      {Visitor: visitor(2), Text: "hi", Name: strings.Repeat("n", 101)},
	} {
		in.Token, in.Origin = e.widget, origin
		if err := e.svc.ChatSend(ctx, in); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// markup is kept as the words that were typed (and shown as text by the pages); a card number is hidden
	xss := `<script>alert(1)</script> <img src=x onerror=alert(2)> my card is 4242 4242 4242 4242`
	if err := e.chat(t, 3, xss); err != nil {
		t.Fatal(err)
	}
	c := e.conversations(t, e.admin)
	if len(c) != 1 {
		t.Fatalf("%d conversations", len(c))
	}
	got, _ := e.svc.Get(ctx, e.admin, c[0].ID)
	body := got.Thread[0].Body
	if !strings.Contains(body, "<script>alert(1)</script>") || strings.Contains(body, "4242") {
		t.Errorf("stored text %q", body)
	}
	// the same browser continues the same conversation; another browser starts its own
	e.chat(t, 3, "second message")
	e.chat(t, 4, "another person")
	if len(e.conversations(t, e.admin)) != 2 {
		t.Errorf("%d conversations", len(e.conversations(t, e.admin)))
	}
	// the visitor sees their own words and sent replies, and nothing internal
	conv := c[0].ID
	if _, err := e.svc.Note(ctx, e.member, conv, "internal: this customer is rude"); err != nil {
		t.Fatal(err)
	}
	g, _ := e.svc.Get(ctx, e.member, conv)
	if _, err := e.svc.Reply(ctx, e.member, conv, g.LastID, "Thanks, looking into it."); err != nil {
		t.Fatal(err)
	}
	seen, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(3), 0)
	if err != nil || len(seen) != 3 {
		t.Fatalf("poll: %d %v", len(seen), err)
	}
	for _, m := range seen {
		if strings.Contains(m.Text, "internal") {
			t.Error("an internal note reached the visitor")
		}
	}
	if !seen[2].FromTeam || seen[2].Text != "Thanks, looking into it." || seen[0].FromTeam {
		t.Errorf("messages %+v", seen)
	}
	later, _ := e.svc.ChatPoll(ctx, e.widget, origin, visitor(3), seen[1].Seq)
	if len(later) != 1 || !later[0].FromTeam {
		t.Errorf("after: %+v", later)
	}
	// one browser cannot read another's conversation
	other, _ := e.svc.ChatPoll(ctx, e.widget, origin, visitor(4), 0)
	if len(other) != 1 || other[0].Text != "another person" {
		t.Errorf("another visitor sees %+v", other)
	}
	if none, _ := e.svc.ChatPoll(ctx, e.widget, origin, visitor(99), 0); len(none) != 0 {
		t.Errorf("an unknown visitor sees %+v", none)
	}
	if _, err := e.svc.ChatPoll(ctx, e.widget, "https://evil.example", visitor(3), 0); !errors.Is(err, inbox.ErrOrigin) {
		t.Errorf("poll from another site: %v", err)
	}
}

func TestChatIsLimitedPerVisitorPerWorkspaceAndPerAddress(t *testing.T) {
	e := setup(t)
	var lim inbox.ErrLimited
	for i := 0; i < inbox.MaxVisitorPerHr; i++ {
		if err := e.chat(t, 7, fmt.Sprintf("message %d", i)); err != nil {
			t.Fatalf("message %d: %v", i, err)
		}
	}
	if err := e.chat(t, 7, "one too many"); !errors.As(err, &lim) {
		t.Errorf("a visitor flooding: %v", err)
	}
	e.now = e.now.Add(61 * time.Minute) // an hour later they may write again
	if err := e.chat(t, 7, "later"); err != nil {
		t.Errorf("after an hour: %v", err)
	}
	// the workspace takes a bounded number of new conversations an hour
	e2 := setup(t)
	refused := 0
	for i := 0; i < inbox.MaxNewChatsPerHr+10; i++ {
		if err := e2.chat(t, 1000+i, "hi"); errors.As(err, &lim) {
			refused++
		}
	}
	if refused != 10 {
		t.Errorf("%d refused, want 10", refused)
	}
	// the request limiter (by address) is asked on every message
	e3 := setup(t)
	asked := 0
	e3.svc.Throttle = func(_ context.Context, key, addr string) bool { asked++; return addr != "198.51.100.1" }
	if err := e3.svc.ChatSend(ctx, inbox.ChatInput{Token: e3.widget, Origin: origin, Visitor: visitor(5), Text: "hi", Addr: "198.51.100.1"}); !errors.As(err, &lim) {
		t.Errorf("a throttled address: %v", err)
	}
	if err := e3.svc.ChatSend(ctx, inbox.ChatInput{Token: e3.widget, Origin: origin, Visitor: visitor(5), Text: "hi", Addr: "198.51.100.2"}); err != nil || asked != 2 {
		t.Errorf("an unthrottled address: %v (asked %d)", err, asked)
	}
}

// ---------------- email ----------------

func TestEmailArrivesOnlyWithTheRightSignatureAndOnce(t *testing.T) {
	e := setup(t)
	in := inbox.InboundEmail{From: "Dana <dana@acme.com>", Subject: "Export is broken", Text: "Our export keeps dropping rows.", MessageID: "<m1@mail>"}
	in.From = "dana@acme.com"
	body, _ := json.Marshal(in)
	ts := strconv.FormatInt(e.now.Unix(), 10)
	for name, c := range map[string]struct {
		ts, sig string
		body    []byte
	}{
		"a wrong key":        {ts, sign("not-the-key", ts, body), body},
		"no signature":       {ts, "", body},
		"a changed body":     {ts, sign(e.key, ts, body), append(append([]byte{}, body...), ' ')},
		"an old stamp":       {strconv.FormatInt(e.now.Add(-10*time.Minute).Unix(), 10), sign(e.key, strconv.FormatInt(e.now.Add(-10*time.Minute).Unix(), 10), body), body},
		"a stamp from ahead": {strconv.FormatInt(e.now.Add(10*time.Minute).Unix(), 10), sign(e.key, strconv.FormatInt(e.now.Add(10*time.Minute).Unix(), 10), body), body},
		"a bad stamp":        {"yesterday", sign(e.key, "yesterday", body), body},
	} {
		if err := e.svc.ReceiveEmail(ctx, e.ws, c.body, c.ts, c.sig); !errors.Is(err, inbox.ErrBadSign) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := e.svc.ReceiveEmail(ctx, uuid.New(), body, ts, sign(e.key, ts, body)); !errors.Is(err, inbox.ErrBadSign) {
		t.Errorf("an unknown workspace: %v", err)
	}
	if n := len(e.conversations(t, e.admin)); n != 0 {
		t.Fatalf("%d conversations from refused mail", n)
	}
	if err := e.svc.ReceiveEmail(ctx, e.ws, body, ts, sign(e.key, ts, body)); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.ReceiveEmail(ctx, e.ws, body, ts, sign(e.key, ts, body)); err != nil { // the same email again
		t.Fatal(err)
	}
	c := e.conversations(t, e.admin)
	if len(c) != 1 || c[0].Channel != "email" || c[0].CustomerEmail != "dana@acme.com" || c[0].Messages != 1 {
		t.Fatalf("conversations %+v", c)
	}
	for name, bad := range map[string]inbox.InboundEmail{
		"no sender":    {Text: "x", MessageID: "a"},
		"a bad sender": {From: "nope", Text: "x", MessageID: "b"},
		"no text":      {From: "a@b.co", Text: " ", MessageID: "c"},
		"no id":        {From: "a@b.co", Text: "x"},
	} {
		if err := e.sendEmail(t, bad); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// automatic replies are dropped
	if err := e.sendEmail(t, inbox.InboundEmail{From: "a@b.co", Text: "I am away", MessageID: "auto-1", AutoSubmitted: true}); err != nil {
		t.Fatal(err)
	}
	if len(e.conversations(t, e.admin)) != 1 {
		t.Error("an automatic reply made a conversation")
	}
	// secrets are hidden before storing
	e.sendEmail(t, inbox.InboundEmail{From: "kim@acme.com", Subject: "Card", Text: "my card 4242 4242 4242 4242", MessageID: "card-1"})
	for _, s := range e.conversations(t, e.admin) {
		g, _ := e.svc.Get(ctx, e.admin, s.ID)
		for _, m := range g.Thread {
			if strings.Contains(m.Body, "4242") {
				t.Error("a card number reached the inbox")
			}
		}
	}
}

func TestAnAnswerFromTheCustomerJoinsItsConversationOnlyFromTheSamePerson(t *testing.T) {
	e := setup(t)
	pid := uuid.New()
	e.q(t, `INSERT INTO person (id, workspace_id, name, email) VALUES ($1,$2,'Dana Lee','dana@acme.com')`, pid, e.ws)
	e.sendEmail(t, inbox.InboundEmail{From: "dana@acme.com", Subject: "Export broken", Text: "First message", MessageID: "m1"})
	c := e.conversations(t, e.admin)[0]
	if c.PersonID == nil || *c.PersonID != pid {
		t.Errorf("the sender was not matched to the person: %+v", c.PersonID)
	}
	g, _ := e.svc.Get(ctx, e.member, c.ID)
	if _, err := e.svc.Reply(ctx, e.member, c.ID, g.LastID, "We are on it."); err != nil {
		t.Fatal(err)
	}
	var queued uuid.UUID
	g, _ = e.svc.Get(ctx, e.member, c.ID)
	queued = g.Thread[len(g.Thread)-1].ID
	if err := e.runReply(t, queued); err != nil {
		t.Fatal(err)
	}
	if e.mail.count() != 1 {
		t.Fatalf("%d emails", e.mail.count())
	}
	sent := e.mail.sent[0]
	if sent.To[0] != "dana@acme.com" || sent.ReplyTo != "inbound@mail.example.com" || !strings.HasPrefix(sent.Subject, "Re: Export broken [#") || sent.Text != "We are on it." {
		t.Errorf("reply %+v", sent)
	}
	subject := sent.Subject
	// her answer carries the reference in the subject and lands in the same conversation
	e.sendEmail(t, inbox.InboundEmail{From: "dana@acme.com", Subject: subject, Text: "Thanks, still failing", MessageID: "m2"})
	if got := e.conversations(t, e.admin); len(got) != 1 || got[0].Messages != 3 {
		t.Errorf("conversations %+v", got)
	}
	// the same reference from someone else is a new conversation (a forwarded or guessed subject)
	e.sendEmail(t, inbox.InboundEmail{From: "stranger@evil.example", Subject: subject, Text: "hello", MessageID: "m3"})
	if len(e.conversations(t, e.admin)) != 2 {
		t.Error("someone else's mail joined the conversation")
	}
}

// ---------------- the desk ----------------

func TestTwoPeopleCannotAnswerTheSameMessage(t *testing.T) {
	e := setup(t)
	e.chat(t, 1, "Where is my order?")
	c := e.conversations(t, e.admin)[0]
	a, _ := e.svc.Get(ctx, e.member, c.ID)
	b, _ := e.svc.Get(ctx, e.member2, c.ID)
	if a.LastID != b.LastID {
		t.Fatal("both people should see the same last message")
	}
	if _, err := e.svc.Reply(ctx, e.viewer, c.ID, a.LastID, "hi"); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer replied: %v", err)
	}
	// 8 people press Send at the same moment: exactly one reply goes out
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := 0; i < 8; i++ {
		who := e.member
		if i%2 == 1 {
			who = e.member2
		}
		wg.Add(1)
		go func(who store.Tenant) {
			defer wg.Done()
			_, err := e.svc.Reply(ctx, who, c.ID, a.LastID, "On its way.")
			results <- err
		}(who)
	}
	wg.Wait()
	close(results)
	ok, stale := 0, 0
	for err := range results {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, inbox.ErrStale):
			stale++
		default:
			t.Errorf("unexpected: %v", err)
		}
	}
	if ok != 1 || stale != 7 {
		t.Errorf("%d replies went out, %d were told the conversation changed (want 1 and 7)", ok, stale)
	}
	g, _ := e.svc.Get(ctx, e.member, c.ID)
	replies := 0
	for _, m := range g.Thread {
		if m.Direction == "out" {
			replies++
		}
	}
	if replies != 1 || g.Assignee == nil {
		t.Errorf("%d replies stored, assignee %v", replies, g.Assignee)
	}
	// a new customer message makes the old view stale for a reply written against it
	e.chat(t, 1, "Thank you!")
	if _, err := e.svc.Reply(ctx, e.member2, c.ID, g.LastID, "late"); !errors.Is(err, inbox.ErrStale) {
		t.Errorf("replying to an out-of-date view: %v", err)
	}
	// so does a teammate's note
	g, _ = e.svc.Get(ctx, e.member, c.ID)
	e.svc.Note(ctx, e.member2, c.ID, "checking the courier")
	if _, err := e.svc.Reply(ctx, e.member, c.ID, g.LastID, "late"); !errors.Is(err, inbox.ErrStale) {
		t.Errorf("replying after a note: %v", err)
	}
}

func TestTakingAConversationIsFirstComeAndLettingGoNeedsTheRightPerson(t *testing.T) {
	e := setup(t)
	e.chat(t, 1, "help")
	c := e.conversations(t, e.admin)[0]
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, who := range []store.Tenant{e.member, e.member2} {
		wg.Add(1)
		go func(who store.Tenant) {
			defer wg.Done()
			results <- e.svc.Assign(ctx, who, c.ID, true, nil)
		}(who)
	}
	wg.Wait()
	close(results)
	ok, stale := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if errors.Is(err, inbox.ErrStale) {
			stale++
		}
	}
	if ok != 1 || stale != 1 {
		t.Errorf("%d took it, %d were told it was taken", ok, stale)
	}
	g, _ := e.svc.Get(ctx, e.admin, c.ID)
	owner, other := e.member, e.member2
	if *g.Assignee == e.member2.UserID {
		owner, other = e.member2, e.member
	}
	if err := e.svc.Assign(ctx, other, c.ID, false, g.Assignee); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a teammate let go of someone else's conversation: %v", err)
	}
	if err := e.svc.Assign(ctx, e.viewer, c.ID, true, g.Assignee); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer took it: %v", err)
	}
	// an admin can free it, but only if they saw who had it
	if err := e.svc.Assign(ctx, e.admin, c.ID, false, nil); !errors.Is(err, inbox.ErrStale) {
		t.Errorf("letting go of what they did not see: %v", err)
	}
	if err := e.svc.Assign(ctx, e.admin, c.ID, false, g.Assignee); err != nil {
		t.Errorf("an admin freeing it: %v", err)
	}
	if err := e.svc.Assign(ctx, owner, c.ID, true, nil); err != nil {
		t.Errorf("taking a free conversation: %v", err)
	}
	// the list can show mine, unassigned, open and closed
	mine, _, _ := e.svc.List(ctx, owner, inbox.Filter{Mine: true})
	none, _, _ := e.svc.List(ctx, other, inbox.Filter{Mine: true})
	if len(mine) != 1 || len(none) != 0 {
		t.Errorf("mine %d / %d", len(mine), len(none))
	}
	if free, _, _ := e.svc.List(ctx, owner, inbox.Filter{Unassigned: true}); len(free) != 0 {
		t.Errorf("unassigned %d", len(free))
	}
	if err := e.svc.SetState(ctx, owner, c.ID, "closed"); err != nil {
		t.Fatal(err)
	}
	if open, _, _ := e.svc.List(ctx, owner, inbox.Filter{State: "open"}); len(open) != 0 {
		t.Errorf("a closed conversation is listed as open")
	}
	if err := e.svc.SetState(ctx, e.viewer, c.ID, "open"); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer reopened: %v", err)
	}
	e.chat(t, 1, "are you there?") // a new customer message reopens it
	if open, _, _ := e.svc.List(ctx, owner, inbox.Filter{State: "open"}); len(open) != 1 {
		t.Errorf("a customer's new message did not reopen the conversation")
	}
	// paging
	for i := 2; i < 8; i++ {
		e.chat(t, i, "hi")
	}
	page, next, _ := e.svc.List(ctx, owner, inbox.Filter{Limit: 3})
	if len(page) != 3 || next == nil {
		t.Fatalf("page %d next %v", len(page), next)
	}
	seen := map[uuid.UUID]bool{}
	for {
		for _, s := range page {
			if seen[s.ID] {
				t.Fatal("a conversation on two pages")
			}
			seen[s.ID] = true
		}
		if next == nil {
			break
		}
		page, next, _ = e.svc.List(ctx, owner, inbox.Filter{Limit: 3, AfterAt: &next.LastMessageAt, AfterID: &next.ID})
	}
	if len(seen) != 7 {
		t.Errorf("%d conversations over all pages, want 7", len(seen))
	}
}

func TestEmailRepliesAreSentOnceAndNeverToAnOptedOutAddress(t *testing.T) {
	e := setup(t)
	reply := func(from string) uuid.UUID {
		e.sendEmail(t, inbox.InboundEmail{From: from, Subject: "Hello", Text: "Question", MessageID: "id-" + from})
		var conv inbox.Summary
		for _, c := range e.conversations(t, e.admin) {
			if c.CustomerEmail == from {
				conv = c
			}
		}
		g, _ := e.svc.Get(ctx, e.member, conv.ID)
		if _, err := e.svc.Reply(ctx, e.member, conv.ID, g.LastID, "Answer for "+from); err != nil {
			t.Fatal(err)
		}
		g, _ = e.svc.Get(ctx, e.member, conv.ID)
		return g.Thread[len(g.Thread)-1].ID
	}
	a := reply("ann@acme.com")
	// nothing is sent until the worker runs; a job that runs twice sends once
	if e.mail.count() != 0 {
		t.Fatal("sent before the worker ran")
	}
	e.runReply(t, a)
	e.runReply(t, a)
	if e.mail.count() != 1 {
		t.Errorf("%d emails for one reply", e.mail.count())
	}
	// an unknown message id, or one in another workspace, sends nothing
	if err := e.worker.Work(ctx, &river.Job[inbox.ReplyArgs]{JobRow: &rivertype.JobRow{}, Args: inbox.ReplyArgs{WorkspaceID: e.other.WorkspaceID, MessageID: a}}); err != nil || e.mail.count() != 1 {
		t.Errorf("another workspace's job: %v %d", err, e.mail.count())
	}
	// an address that asked not to be written to is never written to; the team sees why, and a retry stays refused
	b := reply("bob@acme.com")
	e.q(t, `INSERT INTO suppression (workspace_id, email, reason) VALUES ($1,'bob@acme.com','bounced')`, e.ws)
	e.runReply(t, b)
	if e.mail.count() != 1 {
		t.Errorf("wrote to an opted-out address (%d emails)", e.mail.count())
	}
	var state, why string
	e.db.Super.QueryRow(ctx, `SELECT state, coalesce(last_error,'') FROM conversation_message WHERE id=$1`, b).Scan(&state, &why)
	if state != "failed" || !strings.Contains(why, "asked not to be emailed") {
		t.Errorf("state %q reason %q", state, why)
	}
	if err := e.svc.Retry(ctx, e.viewer, b); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer retried: %v", err)
	}
	e.svc.Retry(ctx, e.member, b)
	e.runReply(t, b)
	if e.mail.count() != 1 {
		t.Error("a retry reached an opted-out address")
	}
	// transient failures retry and then succeed; permanent ones stop
	c := reply("cy@acme.com")
	e.mail.fail = email.ErrTransient
	if err := e.runReply(t, c); err == nil {
		t.Error("a transient failure was swallowed")
	}
	e.mail.fail = nil
	if err := e.runReply(t, c); err != nil || e.mail.count() != 2 {
		t.Errorf("the retry: %v (%d emails)", err, e.mail.count())
	}
	d := reply("di@acme.com")
	e.mail.fail = email.ErrPermanent
	e.runReply(t, d)
	e.db.Super.QueryRow(ctx, `SELECT state FROM conversation_message WHERE id=$1`, d).Scan(&state)
	if state != "failed" {
		t.Errorf("a refused message is %q", state)
	}
	e.mail.fail = nil
	// no email configured: nothing is claimed
	f := reply("ed@acme.com")
	saved := e.worker.Sender
	e.worker.Sender = nil
	if err := e.runReply(t, f); err == nil {
		t.Error("a worker without email claimed a reply")
	}
	e.worker.Sender = saved
	e.db.Super.QueryRow(ctx, `SELECT state FROM conversation_message WHERE id=$1`, f).Scan(&state)
	if state != "queued" {
		t.Errorf("the reply is %q, want queued", state)
	}
	// a worker that died mid-send leaves it 'sending'; after ten minutes the retry sends it, exactly once
	e.q(t, `UPDATE conversation_message SET state='sending', updated_at = now() - interval '11 minutes' WHERE id=$1`, f)
	before := e.mail.count()
	e.runReply(t, f)
	e.runReply(t, f)
	if e.mail.count() != before+1 {
		t.Errorf("recovered reply sent %d times", e.mail.count()-before)
	}
	// a recent claim is left alone (another worker may be sending it)
	g := reply("flo@acme.com")
	e.q(t, `UPDATE conversation_message SET state='sending', updated_at = now() WHERE id=$1`, g)
	before = e.mail.count()
	e.runReply(t, g)
	if e.mail.count() != before {
		t.Error("took a claim that is still fresh")
	}
	// chat conversations never queue anything
	e.chat(t, 1, "hi")
}

// ---------------- from a conversation to the review queue ----------------

func TestACustomersMessageBecomesFeedbackAndTheConversationShowsWhereItStands(t *testing.T) {
	e := setup(t)
	pid := uuid.New()
	e.q(t, `INSERT INTO person (id, workspace_id, name, email) VALUES ($1,$2,'Dana Lee','dana@acme.com')`, pid, e.ws)
	e.sendEmail(t, inbox.InboundEmail{From: "dana@acme.com", Subject: "SSO", Text: "We really need single sign-on today.", MessageID: "sso-1"})
	c := e.conversations(t, e.admin)[0]
	g, _ := e.svc.Get(ctx, e.member, c.ID)
	inbound := g.Thread[0].ID
	e.svc.Note(ctx, e.member, c.ID, "note")
	g, _ = e.svc.Get(ctx, e.member, c.ID)
	if _, err := e.svc.Convert(ctx, e.viewer, c.ID, inbound); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer converted: %v", err)
	}
	if _, err := e.svc.Convert(ctx, e.member, c.ID, g.Thread[1].ID); err == nil {
		t.Error("an internal note was sent on as customer feedback")
	}
	if _, err := e.svc.Convert(ctx, e.member, c.ID, uuid.New()); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("a message that is not there: %v", err)
	}
	src, err := e.svc.Convert(ctx, e.member, c.ID, inbound)
	if err != nil {
		t.Fatal(err)
	}
	again, err := e.svc.Convert(ctx, e.member, c.ID, inbound) // twice stores once
	if err != nil || again != src {
		t.Errorf("second conversion: %v %v", again, err)
	}
	var n int
	var kind string
	var person uuid.NullUUID
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM source_item WHERE workspace_id=$1 AND kind='support'`, e.ws).Scan(&n)
	e.db.Super.QueryRow(ctx, `SELECT kind, person_id FROM source_item WHERE id=$1`, src).Scan(&kind, &person)
	if n != 1 || kind != "support" || !person.Valid || person.UUID != pid {
		t.Errorf("sources %d kind %q person %v", n, kind, person)
	}
	// the card follows the feedback: queued for reading, then waiting for a person, then a request with a status
	stage := func() inbox.Card {
		g, _ := e.svc.Get(ctx, e.member, c.ID)
		if len(g.Cards) != 1 {
			t.Fatalf("%d cards", len(g.Cards))
		}
		return g.Cards[0]
	}
	if got := stage(); got.Stage != "processing" || got.SourceItemID != src {
		t.Errorf("first: %+v", got)
	}
	e.q(t, `UPDATE source_item SET processing_state='done' WHERE id=$1`, src)
	if got := stage(); got.Stage != "nothing" {
		t.Errorf("read, nothing found: %+v", got)
	}
	var chunk uuid.UUID
	e.db.Super.QueryRow(ctx, `SELECT id FROM chunk WHERE source_item_id=$1 LIMIT 1`, src).Scan(&chunk)
	e.q(t, `INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence, state) VALUES ($1,$2,$3,'new_request','need','Single sign-on','single sign-on',15,29,0.9,'suggested')`, e.ws, src, chunk)
	if got := stage(); got.Stage != "waiting" || got.Waiting != 1 {
		t.Errorf("suggestion waiting: %+v", got)
	}
	var req, statusID uuid.UUID
	e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'Single sign-on') RETURNING id`, e.ws).Scan(&req)
	e.q(t, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,'single sign-on',15,29,$6)`, e.ws, req, src, chunk, pid, e.admin.UserID)
	got := stage()
	if got.Stage != "linked" || len(got.Requests) != 1 || got.Requests[0].Title != "Single sign-on" {
		t.Errorf("linked: %+v", got)
	}
	// and the status shown is the request's status right now
	e.db.Super.QueryRow(ctx, `SELECT status_id FROM request WHERE id=$1`, req).Scan(&statusID)
	var before, after string
	before = stage().Requests[0].Status
	e.q(t, `INSERT INTO status (workspace_id, name, bucket, position) VALUES ($1,'Shipped to everyone','done',99)`, e.ws)
	e.q(t, `UPDATE request SET status_id = (SELECT id FROM status WHERE workspace_id=$1 AND name='Shipped to everyone') WHERE id=$2`, e.ws, req)
	after = stage().Requests[0].Status
	if after != "Shipped to everyone" || before == after || stage().Requests[0].Bucket != "done" {
		t.Errorf("status before %q after %q", before, after)
	}
	// deleting the conversation removes the feedback made from it
	if err := e.svc.Delete(ctx, e.member, c.ID); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member deleted: %v", err)
	}
	if err := e.svc.Delete(ctx, e.admin, c.ID); err != nil {
		t.Fatal(err)
	}
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM source_item WHERE id=$1`, src).Scan(&n)
	if n != 0 {
		t.Error("the feedback made from a deleted conversation remains")
	}
}

// ---------------- privacy and isolation ----------------

func TestDeletingAPersonRemovesTheirConversations(t *testing.T) {
	e := setup(t)
	pid := uuid.New()
	e.q(t, `INSERT INTO person (id, workspace_id, name, email) VALUES ($1,$2,'Dana','dana@acme.com')`, pid, e.ws)
	e.sendEmail(t, inbox.InboundEmail{From: "dana@acme.com", Subject: "A", Text: "one", MessageID: "a1"})
	e.sendEmail(t, inbox.InboundEmail{From: "other@acme.com", Subject: "B", Text: "two", MessageID: "b1"})
	// a chat where she gave her address but was not yet a known person
	e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(1), Text: "chat", Email: "DANA@acme.com", Name: "Dana"})
	if len(e.conversations(t, e.admin)) != 3 {
		t.Fatalf("%d conversations", len(e.conversations(t, e.admin)))
	}
	src := func() uuid.UUID {
		for _, c := range e.conversations(t, e.admin) {
			if c.CustomerEmail == "dana@acme.com" && c.Channel == "email" {
				g, _ := e.svc.Get(ctx, e.member, c.ID)
				id, err := e.svc.Convert(ctx, e.member, c.ID, g.Thread[0].ID)
				if err != nil {
					t.Fatal(err)
				}
				return id
			}
		}
		return uuid.Nil
	}()
	err := store.WithTenant(ctx, e.db.Backend, e.admin, func(q *dbgen.Queries) error {
		return inbox.ErasePerson(ctx, q, e.ws, pid, "dana@acme.com")
	})
	if err != nil {
		t.Fatal(err)
	}
	left := e.conversations(t, e.admin)
	if len(left) != 1 || left[0].CustomerEmail != "other@acme.com" {
		t.Errorf("left %+v", left)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM conversation_message WHERE workspace_id=$1`, e.ws).Scan(&n)
	var s int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM source_item WHERE id=$1`, src).Scan(&s)
	if n != 1 || s != 0 {
		t.Errorf("%d messages remain, %d feedback items remain", n, s)
	}
}

func TestOneWorkspacesInboxIsInvisibleToAnother(t *testing.T) {
	e := setup(t)
	e.chat(t, 1, "private")
	c := e.conversations(t, e.admin)[0]
	if list := e.conversations(t, e.other); len(list) != 0 {
		t.Errorf("another workspace lists %d", len(list))
	}
	if _, err := e.svc.Get(ctx, e.other, c.ID); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("read: %v", err)
	}
	if _, err := e.svc.Reply(ctx, e.other, c.ID, uuid.New(), "x"); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("reply: %v", err)
	}
	if err := e.svc.Assign(ctx, e.other, c.ID, true, nil); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("assign: %v", err)
	}
	if err := e.svc.Delete(ctx, e.other, c.ID); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("delete: %v", err)
	}
	if _, err := e.svc.Convert(ctx, e.other, c.ID, uuid.New()); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("convert: %v", err)
	}
}
