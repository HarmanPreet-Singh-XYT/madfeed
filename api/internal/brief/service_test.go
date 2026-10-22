package brief_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/ai"
	"product/api/internal/aievent"
	"product/api/internal/brief"
	"product/api/internal/jobs"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

// provider answers like a good model: cites the first two quotes it sees.
type provider struct {
	calls   atomic.Int32
	mode    string // "", "bad-id", "outage"
	lastTxt string
}

func (p *provider) Name() string { return "fake" }
func (p *provider) Complete(_ context.Context, r ai.Request) (ai.Response, error) {
	p.calls.Add(1)
	user := r.Messages[0].Text
	p.lastTxt = user
	if p.mode == "outage" {
		return ai.Response{}, ai.ErrUnavailable
	}
	var ids []string
	for _, line := range strings.Split(user, "\n") {
		if strings.HasPrefix(line, "[") && len(ids) < 2 {
			ids = append(ids, line[1:strings.Index(line, "]")])
		}
	}
	if p.mode == "bad-id" {
		ids = []string{uuid.NewString()}
	}
	claim := "Customers want single sign-on before rolling out."
	if strings.Contains(user, "showing 1)") {
		claim = "One customer said they need single sign-on."
	}
	raw, _ := json.Marshal(map[string]any{"claim": claim, "quote_ids": ids, "disproof": "If this came from a single team it matters less."})
	return ai.Response{JSON: raw, Usage: ai.Usage{InputTokens: 500, OutputTokens: 80}}, nil
}

type env struct {
	db     *testdb.DB
	svc    *brief.Service
	worker *brief.Worker
	model  *provider
	ten    store.Tenant
	seq    int
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	model := &provider{}
	router, err := ai.NewRouter([]ai.Provider{model}, map[ai.Tier][]ai.Route{ai.TierLarge: {{Provider: "fake", Model: "m", AllowCustomerData: true, Price: ai.Price{InputPerM: 15, OutputPerM: 75}}}}, &aievent.Recorder{Pool: db.Backend})
	if err != nil {
		t.Fatal(err)
	}
	worker := &brief.Worker{Pool: db.Backend, Completer: router}
	workers := river.NewWorkers()
	river.AddWorker(workers, worker)
	jc, err := jobs.NewClient(db.Backend, workers, nil)
	if err != nil {
		t.Fatal(err)
	}
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: "w"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	return &env{db: db, svc: &brief.Service{Pool: db.Backend, Jobs: jc}, worker: worker, model: model, ten: ten}
}

// seed creates a request with n quotes from people at two accounts (one with a value).
func (e *env) seed(t *testing.T, n int) (requestID uuid.UUID, words int) {
	t.Helper()
	ws := e.ten.WorkspaceID
	text := ""
	for k := 0; k < 100; k++ {
		text += fmt.Sprintf("w%04d ", k)
	}
	suffix := ""
	if e.seq > 0 {
		suffix = fmt.Sprint(e.seq) // later seeds in one workspace need their own account names
	}
	e.seq++
	var src, chunk, acme, globex, p1, p2 uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, text, uuid.NewString(), e.ten.UserID).Scan(&src))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(text), text).Scan(&chunk))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name, revenue) VALUES ($1,'Acme'||$2::text,100000) RETURNING id`, ws, suffix).Scan(&acme))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name) VALUES ($1,'Globex'||$2::text) RETURNING id`, ws, suffix).Scan(&globex))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, account_id) VALUES ($1,'Dana',$2) RETURNING id`, ws, acme).Scan(&p1))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, account_id) VALUES ($1,'Sam',$2) RETURNING id`, ws, globex).Scan(&p2))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'Single sign-on') RETURNING id`, ws).Scan(&requestID))
	for i := 0; i < n; i++ {
		e.addEvidence(t, requestID, src, chunk, []uuid.UUID{p1, p2, uuid.Nil}[i%3], i)
	}
	return requestID, n
}

func (e *env) addEvidence(t *testing.T, req, src, chunk, person uuid.UUID, k int) {
	t.Helper()
	var p any
	if person != uuid.Nil {
		p = person
	}
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, e.ten.WorkspaceID, req, src, chunk, p, fmt.Sprintf("w%04d", k), k*6, k*6+5, e.ten.UserID); err != nil {
		t.Fatal(err)
	}
}

func (e *env) run(t *testing.T, req uuid.UUID, attempt int) error {
	t.Helper()
	return e.worker.Work(ctx, &river.Job[brief.GenerateArgs]{
		JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: 3},
		Args:   brief.GenerateArgs{WorkspaceID: e.ten.WorkspaceID, RequestID: req, UserID: e.ten.UserID},
	})
}

func TestBriefLifecycleWithFactsComputedFromTheDatabase(t *testing.T) {
	e := setup(t)
	req, _ := e.seed(t, 6)

	v, started, err := e.svc.Request(ctx, e.ten, req)
	if err != nil || !started || v.State != "pending" {
		t.Fatalf("%+v started=%v err=%v", v, started, err)
	}
	var queued int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job WHERE kind='generate_brief' AND args->>'request_id'=$1`, req.String()).Scan(&queued)
	if queued != 1 {
		t.Fatalf("jobs queued = %d", queued)
	}
	// Asking again while it is being written does not queue a second one.
	if _, started, _ := e.svc.Request(ctx, e.ten, req); started {
		t.Fatal("a second generation was queued while one is pending")
	}

	if err := e.run(t, req, 1); err != nil {
		t.Fatal(err)
	}
	v, err = e.svc.Get(ctx, e.ten, req)
	if err != nil {
		t.Fatal(err)
	}
	if v.State != "ready" || v.Stale || v.LowEvidence || v.Claim == "" || v.Disproof == "" || len(v.Quotes) != 2 {
		t.Fatalf("%+v", v)
	}
	// The cited quotes are the evidence rows' own text.
	for _, q := range v.Quotes {
		var stored string
		if err := e.db.Super.QueryRow(ctx, `SELECT quote_text FROM evidence WHERE id=$1`, q.ID).Scan(&stored); err != nil || stored != q.Text {
			t.Fatalf("quote %s: %q vs stored %q (%v)", q.ID, q.Text, stored, err)
		}
	}
	// Facts come from the database: 6 quotes, 2 people (Dana, Sam), 2 accounts, 100,000 (Globex has no value), 2 quotes without a person.
	f := v.Facts
	if f.EvidenceCount != 6 || f.PeopleCount != 2 || f.AccountCount != 2 || f.AccountsWithValue != 1 || f.TotalValue != "100000.00" || f.Unidentified != 2 || f.NewLast30Days != 6 {
		t.Fatalf("%+v", f)
	}
	if len(f.Accounts) != 2 || f.Accounts[0].Name != "Acme" || f.Accounts[0].Revenue != "100000.00" || f.Accounts[1].Name != "Globex" || f.Accounts[1].Revenue != "" {
		t.Fatalf("%+v", f.Accounts)
	}
	if f.FirstEvidenceAt == nil || f.NewestEvidenceAt == nil {
		t.Fatal("missing dates")
	}
	// The model never saw names, accounts or money.
	for _, leak := range []string{"Dana", "Sam", "Acme", "Globex", "100000"} {
		if strings.Contains(e.model.lastTxt, leak) {
			t.Errorf("prompt leaked %q", leak)
		}
	}
	// The call was recorded with its cost.
	var n int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM ai_event WHERE workspace_id=$1 AND task='brief' AND outcome='ok' AND cost_usd > 0`, e.ten.WorkspaceID).Scan(&n)
	if n != 1 {
		t.Fatalf("ai_event rows = %d", n)
	}

	// Fresh brief: asking again is free.
	calls := e.model.calls.Load()
	if _, started, _ := e.svc.Request(ctx, e.ten, req); started || e.model.calls.Load() != calls {
		t.Fatal("an up-to-date brief must not be regenerated")
	}

	// New evidence makes it stale (the old text is still shown, flagged), and asking again regenerates.
	var src, chunk uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `SELECT source_item_id, chunk_id FROM evidence WHERE request_id=$1 LIMIT 1`, req).Scan(&src, &chunk)
	e.addEvidence(t, req, src, chunk, uuid.Nil, 50)
	if v, _ := e.svc.Get(ctx, e.ten, req); !v.Stale || v.State != "ready" {
		t.Fatalf("expected a stale ready brief: %+v", v)
	}
	if _, started, _ := e.svc.Request(ctx, e.ten, req); !started {
		t.Fatal("a stale brief must regenerate")
	}
	if err := e.run(t, req, 1); err != nil {
		t.Fatal(err)
	}
	if v, _ := e.svc.Get(ctx, e.ten, req); v.Stale || v.Facts.EvidenceCount != 7 {
		t.Fatalf("%+v", v)
	}

	// Removing a cited quote makes the brief stale and drops the missing quote instead of showing it.
	if _, err := e.db.Super.Exec(ctx, `DELETE FROM evidence WHERE id=$1`, v.Quotes[0].ID); err != nil {
		t.Fatal(err)
	}
	after, _ := e.svc.Get(ctx, e.ten, req)
	if !after.Stale || len(after.Quotes) != 1 {
		t.Fatalf("%+v", after)
	}
}

func TestOneQuoteBriefSaysSoAndIsMarkedLowEvidence(t *testing.T) {
	e := setup(t)
	req, _ := e.seed(t, 1)
	if _, _, err := e.svc.Request(ctx, e.ten, req); err != nil {
		t.Fatal(err)
	}
	if err := e.run(t, req, 1); err != nil {
		t.Fatal(err)
	}
	v, _ := e.svc.Get(ctx, e.ten, req)
	if !v.LowEvidence || !strings.HasPrefix(v.Claim, "One customer") || v.Facts.EvidenceCount != 1 || v.Facts.NewLast30Days != 1 {
		t.Fatalf("%+v", v)
	}
}

func TestRefusalsAndPermissions(t *testing.T) {
	e := setup(t)
	// A request with no evidence cannot have a brief (and the model is never called).
	var empty uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'empty') RETURNING id`, e.ten.WorkspaceID).Scan(&empty)
	if _, _, err := e.svc.Request(ctx, e.ten, empty); !errors.Is(err, brief.ErrNoEvidence) || e.model.calls.Load() != 0 {
		t.Fatalf("%v calls=%d", err, e.model.calls.Load())
	}
	if _, err := e.svc.Get(ctx, e.ten, empty); !errors.Is(err, brief.ErrNotFound) {
		t.Fatalf("get before request: %v", err)
	}

	req, _ := e.seed(t, 3)
	viewer := e.ten
	viewer.Role = store.RoleViewer
	if _, _, err := e.svc.Request(ctx, viewer, req); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer request: %v", err)
	}
	if _, _, err := e.svc.Request(ctx, e.ten, req); err != nil {
		t.Fatal(err)
	}
	if err := e.run(t, req, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Get(ctx, viewer, req); err != nil {
		t.Fatalf("viewers may read briefs: %v", err)
	}
	// Another workspace sees nothing and cannot request one.
	other := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	_ = store.WithTenant(ctx, e.db.Backend, other, func(q *dbgen.Queries) error {
		_, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: other.WorkspaceID, Name: "o"})
		return err
	})
	if _, err := e.svc.Get(ctx, other, req); !errors.Is(err, brief.ErrNotFound) {
		t.Fatalf("cross-tenant get: %v", err)
	}
	if _, _, err := e.svc.Request(ctx, other, req); !errors.Is(err, brief.ErrNotFound) {
		t.Fatalf("cross-tenant request: %v", err)
	}
}

func TestBadModelOutputRetriesThenFailsVisiblyAndNeverStoresIt(t *testing.T) {
	e := setup(t)
	req, _ := e.seed(t, 4)
	e.model.mode = "bad-id"
	if _, _, err := e.svc.Request(ctx, e.ten, req); err != nil {
		t.Fatal(err)
	}
	if err := e.run(t, req, 1); err == nil {
		t.Fatal("invalid output must make the job retry")
	}
	if v, _ := e.svc.Get(ctx, e.ten, req); v.State != "pending" || v.Claim != "" {
		t.Fatalf("a retry should leave it pending: %+v", v)
	}
	if err := e.run(t, req, 3); err == nil {
		t.Fatal("still an error on the last attempt")
	}
	v, _ := e.svc.Get(ctx, e.ten, req)
	if v.State != "failed" || v.Claim != "" || v.FailureReason == "" {
		t.Fatalf("%+v", v)
	}
	// After it fails, a person can try again, and a good model then succeeds.
	e.model.mode = ""
	if _, started, err := e.svc.Request(ctx, e.ten, req); err != nil || !started {
		t.Fatalf("retry after failure: %v %v", started, err)
	}
	if err := e.run(t, req, 1); err != nil {
		t.Fatal(err)
	}
	if v, _ := e.svc.Get(ctx, e.ten, req); v.State != "ready" {
		t.Fatalf("%+v", v)
	}
}

func TestWorkerIsIdempotentAndDailyCapApplies(t *testing.T) {
	e := setup(t)
	req, _ := e.seed(t, 3)
	_, _, _ = e.svc.Request(ctx, e.ten, req)
	_ = e.run(t, req, 1)
	calls := e.model.calls.Load()
	if err := e.run(t, req, 2); err != nil || e.model.calls.Load() != calls {
		t.Fatalf("running a finished job again must do nothing: %v", err)
	}

	e.svc.DailyBriefs = 2
	r2, _ := e.seed(t, 2)
	r3, _ := e.seed(t, 2)
	if _, _, err := e.svc.Request(ctx, e.ten, r2); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.svc.Request(ctx, e.ten, r3); !errors.As(err, new(brief.ErrQuota)) {
		t.Fatalf("third brief today must be refused: %v", err)
	}
}
