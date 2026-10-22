package workflow_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/ai"
	"product/api/internal/aievent"
	"product/api/internal/email"
	"product/api/internal/jobs"
	"product/api/internal/outreach"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
	"product/api/internal/workflow"
)

var ctx = context.Background()

// fakeMail records every send attempt and de-duplicates on the idempotency key
// the way a real provider does, so "delivered" counts real emails.
type fakeMail struct {
	mu        sync.Mutex
	attempts  []email.Message
	delivered map[string]email.Message // by idempotency key
	errs      []error                  // consumed one per attempt before succeeding
}

func (f *fakeMail) Send(_ context.Context, m email.Message) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.attempts = append(f.attempts, m)
	if len(f.errs) > 0 {
		err := f.errs[0]
		f.errs = f.errs[1:]
		return "", err
	}
	if f.delivered == nil {
		f.delivered = map[string]email.Message{}
	}
	if _, dup := f.delivered[m.IdempotencyKey]; !dup {
		f.delivered[m.IdempotencyKey] = m
	}
	return "prov-" + m.IdempotencyKey, nil
}

func (f *fakeMail) deliveredTo(addr string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, m := range f.delivered {
		if m.To[0] == addr {
			n++
		}
	}
	return n
}

func (f *fakeMail) deliveredCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.delivered)
}

func (f *fakeMail) attemptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.attempts)
}

// fakeModel writes a plain, valid message unless told to misbehave.
type fakeModel struct {
	mu    sync.Mutex
	mode  string // "", "names-others", "unsafe-link", "outage"
	calls int
	other string // a name to leak in "names-others" mode
}

func (m *fakeModel) Name() string { return "fake" }
func (m *fakeModel) Complete(_ context.Context, r ai.Request) (ai.Response, error) {
	m.mu.Lock()
	m.calls++
	mode, other := m.mode, m.other
	m.mu.Unlock()
	msg := "It is live now, and we wanted you to hear it from us. Thank you for telling us what you needed."
	switch mode {
	case "names-others":
		msg = other + " asked for this too, so we built it."
	case "unsafe-link":
		msg = "Read more at https://evil.example/now."
	case "outage":
		return ai.Response{}, ai.ErrUnavailable
	}
	raw, _ := json.Marshal(map[string]any{"subject": "It has shipped", "message": msg})
	return ai.Response{JSON: raw, Usage: ai.Usage{InputTokens: 200, OutputTokens: 60}}, nil
}

type env struct {
	db      *testdb.DB
	wf      *workflow.Service
	out     *outreach.Service
	draft   *outreach.DraftWorker
	send    *outreach.SendWorker
	mail    *fakeMail
	model   *fakeModel
	unsub   outreach.Unsubscriber
	ten     store.Tenant
	shipped uuid.UUID
	planned uuid.UUID
	seq     int
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	model := &fakeModel{}
	router, err := ai.NewRouter([]ai.Provider{model}, map[ai.Tier][]ai.Route{ai.TierMid: {{Provider: "fake", Model: "m", AllowCustomerData: true, Price: ai.Price{InputPerM: 3, OutputPerM: 15}}}}, &aievent.Recorder{Pool: db.Backend})
	if err != nil {
		t.Fatal(err)
	}
	mail := &fakeMail{}
	unsub := outreach.Unsubscriber{BaseURL: "https://app.example", Secret: []byte("test-secret-of-sufficient-length")}
	draft := &outreach.DraftWorker{Pool: db.Backend, Completer: router}
	send := &outreach.SendWorker{Pool: db.Backend, Sender: mail, FromAddress: "updates@mail.example.com", Unsub: unsub}
	workers := river.NewWorkers()
	river.AddWorker(workers, draft)
	river.AddWorker(workers, send)
	jc, err := jobs.NewClient(db.Backend, workers, nil)
	if err != nil {
		t.Fatal(err)
	}
	out := &outreach.Service{Pool: db.Backend, Jobs: jc}
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: "Acme Software"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	e := &env{db: db, wf: &workflow.Service{Pool: db.Backend, Outreach: out}, out: out, draft: draft, send: send, mail: mail, model: model, unsub: unsub, ten: ten}
	for _, c := range []struct {
		name string
		dst  *uuid.UUID
	}{{"Shipped", &e.shipped}, {"Planned", &e.planned}} {
		if err := db.Super.QueryRow(ctx, `SELECT id FROM status WHERE workspace_id=$1 AND name=$2`, ten.WorkspaceID, c.name).Scan(c.dst); err != nil {
			t.Fatalf("default status %s missing: %v", c.name, err)
		}
	}
	return e
}

type who struct {
	Name, Email, Account string
	Revenue              string
	Quotes               int
}

type scenario struct {
	Request uuid.UUID
	People  map[string]uuid.UUID // by name
}

// seedRequest creates a request with quotes from the given people (and some from nobody).
func (e *env) seedRequest(t *testing.T, title string, people []who, anonymous int) scenario {
	t.Helper()
	e.seq++
	ws := e.ten.WorkspaceID
	text := ""
	for k := 0; k < 400; k++ {
		text += fmt.Sprintf("w%04d ", k)
	}
	var src, chunk, req uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, text, uuid.NewString(), e.ten.UserID).Scan(&src))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(text), text).Scan(&chunk))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,$2) RETURNING id`, ws, title).Scan(&req))
	sc := scenario{Request: req, People: map[string]uuid.UUID{}}
	word := e.seq * 40
	add := func(person any) {
		k := word
		word++
		_, err := e.db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ws, req, src, chunk, person, fmt.Sprintf("w%04d", k), k*6, k*6+5, e.ten.UserID)
		must(err)
	}
	for _, p := range people {
		var pid uuid.UUID
		var acct any
		if p.Account != "" {
			var aid uuid.UUID
			var rev any
			if p.Revenue != "" {
				rev = p.Revenue
			}
			must(e.db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name, revenue) VALUES ($1,$2,$3)
				ON CONFLICT (workspace_id, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`, ws, p.Account, rev).Scan(&aid))
			acct = aid
		}
		var mail any
		if p.Email != "" {
			mail = p.Email
		}
		if p.Email != "" {
			// The same person may ask for several things: reuse them.
			must(e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email, account_id) VALUES ($1,$2,$3,$4)
				ON CONFLICT (workspace_id, lower(email)) WHERE email IS NOT NULL DO UPDATE SET name = EXCLUDED.name RETURNING id`, ws, p.Name, mail, acct).Scan(&pid))
		} else {
			must(e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email, account_id) VALUES ($1,$2,$3,$4) RETURNING id`, ws, p.Name, mail, acct).Scan(&pid))
		}
		sc.People[p.Name] = pid
		for i := 0; i < max(p.Quotes, 1); i++ {
			add(pid)
		}
	}
	for i := 0; i < anonymous; i++ {
		add(nil)
	}
	return sc
}

func (e *env) ship(t *testing.T, req uuid.UUID) workflow.Change {
	t.Helper()
	ch, err := e.wf.SetRequestStatus(ctx, e.ten, req, e.shipped)
	if err != nil {
		t.Fatal(err)
	}
	return ch
}

func (e *env) messageIDs(t *testing.T, req uuid.UUID) map[string]uuid.UUID {
	t.Helper()
	rows, err := e.db.Super.Query(ctx, `SELECT p.name, m.id FROM outreach_message m JOIN person p ON p.id=m.person_id WHERE m.request_id=$1`, req)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]uuid.UUID{}
	for rows.Next() {
		var n string
		var id uuid.UUID
		_ = rows.Scan(&n, &id)
		out[n] = id
	}
	return out
}

func (e *env) state(t *testing.T, msg uuid.UUID) string {
	t.Helper()
	var s string
	if err := e.db.Super.QueryRow(ctx, `SELECT state FROM outreach_message WHERE id=$1`, msg).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func (e *env) batchOf(t *testing.T, req uuid.UUID) (id uuid.UUID, state string) {
	t.Helper()
	if err := e.db.Super.QueryRow(ctx, `SELECT id, state FROM outreach_batch WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1`, req).Scan(&id, &state); err != nil {
		t.Fatal(err)
	}
	return
}

// runDrafts runs the draft job for every message still waiting for one.
func (e *env) runDrafts(t *testing.T, req uuid.UUID) {
	t.Helper()
	for _, id := range e.messageIDs(t, req) {
		if e.state(t, id) != "drafting" {
			continue
		}
		if err := e.draft.Work(ctx, &river.Job[outreach.DraftArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: outreach.DraftArgs{WorkspaceID: e.ten.WorkspaceID, MessageID: id, UserID: e.ten.UserID}}); err != nil {
			t.Fatal(err)
		}
	}
}

func (e *env) runSend(t *testing.T, msg uuid.UUID, attempt int) error {
	t.Helper()
	return e.send.Work(ctx, &river.Job[outreach.SendArgs]{JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: 5}, Args: outreach.SendArgs{WorkspaceID: e.ten.WorkspaceID, MessageID: msg, UserID: e.ten.UserID}})
}

func (e *env) viewer() store.Tenant {
	v := e.ten
	v.UserID, v.Role = uuid.New(), store.RoleViewer
	return v
}

var standard = []who{
	{Name: "Dana Lee", Email: "dana@acme.com", Account: "Acme Inc", Revenue: "120000", Quotes: 2},
	{Name: "Raj Patel", Email: "raj@acme.com", Account: "Acme Inc", Quotes: 1},
	{Name: "Sam Cho", Account: "Globex Corp", Revenue: "5000", Quotes: 1}, // no email: cannot be contacted
}

func contains(haystack string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(strings.ToLower(haystack), strings.ToLower(n)) {
			return true
		}
	}
	return false
}

func workDraft(e *env, args outreach.DraftArgs, attempt int) error {
	return e.draft.Work(ctx, &river.Job[outreach.DraftArgs]{JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: 3}, Args: args})
}
