package intake_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/ai"
	"product/api/internal/aievent"
	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/review"
	"product/api/internal/spans"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

// scripted is an ai.Provider that answers by looking for known phrases in the
// conversation, like a model that finds real quotes (and one paraphrase).
type scripted struct {
	calls   atomic.Int32
	failFor string // if the conversation contains this, return an outage once
	failed  atomic.Bool
	shout   bool // return quotes in the wrong case, like a sloppy model
}

func (s *scripted) Name() string { return "fake" }
func (s *scripted) Complete(_ context.Context, r ai.Request) (ai.Response, error) {
	s.calls.Add(1)
	user := r.Messages[0].Text
	if s.failFor != "" && strings.Contains(user, s.failFor) && !s.failed.Swap(true) {
		return ai.Response{}, ai.ErrUnavailable
	}
	var out []map[string]any
	add := func(q, kind, title string, c float64) {
		if strings.Contains(user, q) {
			if s.shout {
				q = strings.ToUpper(q)
			}
			out = append(out, map[string]any{"quote": q, "kind": kind, "title": title, "confidence": c})
		}
	}
	add("We really need SSO for our team.", "need", "Single sign-on", 0.95)
	add("exports keep dropping Café ☕ rows", "bug", "Export drops rows", 0.82)
	add("it would be nice to have dark mode", "need", "Dark mode", 0.55)
	if strings.Contains(user, "SSO") {
		out = append(out, map[string]any{"quote": "They want single sign-on", "kind": "need", "title": "paraphrase", "confidence": 0.9})
	}
	raw, _ := json.Marshal(map[string]any{"statements": out})
	return ai.Response{JSON: raw, Usage: ai.Usage{InputTokens: 1000, OutputTokens: 100}}, nil
}

type env struct {
	db     *testdb.DB
	svc    *intake.Service
	worker *intake.ExtractWorker
	review *review.Service
	model  *scripted
	tenant store.Tenant
	viewer store.Tenant
	other  store.Tenant
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	model := &scripted{}
	router, err := ai.NewRouter([]ai.Provider{model}, map[ai.Tier][]ai.Route{
		ai.TierMid: {{Provider: "fake", Model: "m", AllowCustomerData: true, Price: ai.Price{InputPerM: 3, OutputPerM: 15}}},
	}, &aievent.Recorder{Pool: db.Backend})
	if err != nil {
		t.Fatal(err)
	}
	worker := &intake.ExtractWorker{Pool: db.Backend, Completer: router}
	workers := river.NewWorkers()
	river.AddWorker(workers, worker)
	jc, err := jobs.NewClient(db.Backend, workers, nil)
	if err != nil {
		t.Fatal(err)
	}
	mk := func(name string) store.Tenant {
		ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
		if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
			if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: name}); err != nil {
				return err
			}
			return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
		}); err != nil {
			t.Fatal(err)
		}
		return ten
	}
	ten := mk("A")
	viewer := ten
	viewer.UserID, viewer.Role = uuid.New(), store.RoleViewer
	return &env{db: db, svc: &intake.Service{Pool: db.Backend, Jobs: jc, ChunkBytes: 100}, worker: worker,
		review: &review.Service{Pool: db.Backend}, model: model, tenant: ten, viewer: viewer, other: mk("B")}
}

const convo = "Dana: Hi, thanks for the call.\n\nDana: We really need SSO for our team.\n\nDana: Also our exports keep dropping Café ☕ rows, and it would be nice to have dark mode."

func (e *env) run(t *testing.T, id uuid.UUID, attempt int) error {
	t.Helper()
	return e.worker.Work(ctx, &river.Job[intake.ExtractArgs]{
		JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: 3},
		Args:   intake.ExtractArgs{WorkspaceID: e.tenant.WorkspaceID, SourceItemID: id, UserID: e.tenant.UserID},
	})
}

func (e *env) proposals(t *testing.T, state string) []dbgen.Proposal {
	t.Helper()
	ps, err := e.review.List(ctx, e.tenant, state, 100)
	if err != nil {
		t.Fatal(err)
	}
	return ps
}

func (e *env) source(t *testing.T, id uuid.UUID) dbgen.SourceItem {
	t.Helper()
	var si dbgen.SourceItem
	if err := store.WithTenant(ctx, e.db.Backend, e.tenant, func(q *dbgen.Queries) (err error) {
		si, err = q.GetSourceItem(ctx, dbgen.GetSourceItemParams{WorkspaceID: e.tenant.WorkspaceID, ID: id})
		return
	}); err != nil {
		t.Fatal(err)
	}
	return si
}

func TestPasteToQueueToRequestAndBack(t *testing.T) {
	e := setup(t)
	res, err := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Title: "Call with Dana", Text: convo})
	if err != nil || res.Duplicate {
		t.Fatalf("%+v %v", res, err)
	}

	// The job was enqueued in the same transaction as the data.
	var jobs int
	if err := e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job WHERE kind='extract_source_item' AND args->>'source_item_id' = $1`, res.SourceItemID.String()).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("jobs=%d err=%v", jobs, err)
	}

	if err := e.run(t, res.SourceItemID, 1); err != nil {
		t.Fatal(err)
	}
	item := e.source(t, res.SourceItemID)
	if item.ProcessingState != "done" {
		t.Fatalf("state %s", item.ProcessingState)
	}

	ps := e.proposals(t, "suggested")
	if len(ps) != 3 { // SSO, export bug, dark mode; the paraphrase was dropped
		t.Fatalf("want 3 proposals, got %d", len(ps))
	}
	for _, p := range ps {
		if err := spans.Validate(item.RawText, int(p.SpanStart), int(p.SpanEnd), p.QuoteText); err != nil {
			t.Errorf("proposal quote is not in the source: %v", err)
		}
	}
	if ps[0].Confidence < ps[1].Confidence {
		t.Error("queue must be ordered by confidence")
	}

	// AI call was recorded against the right workspace with cost.
	var n int
	var cost float64
	if err := e.db.Super.QueryRow(ctx, `SELECT count(*), coalesce(sum(cost_usd),0) FROM ai_event WHERE workspace_id=$1 AND task='extraction' AND outcome='ok'`, e.tenant.WorkspaceID).Scan(&n, &cost); err != nil || n == 0 || cost <= 0 {
		t.Fatalf("ai_event rows=%d cost=%v err=%v", n, cost, err)
	}

	// Accept the top proposal with a renamed title.
	title := "  SSO for teams  "
	acc, err := e.review.Accept(ctx, e.tenant, ps[0].ID, review.AcceptOpts{Title: &title})
	if err != nil {
		t.Fatal(err)
	}
	var reqTitle, quote string
	if err := e.db.Super.QueryRow(ctx, `SELECT r.title, e.quote_text FROM request r JOIN evidence e ON e.request_id=r.id WHERE r.id=$1`, acc.RequestID).Scan(&reqTitle, &quote); err != nil {
		t.Fatal(err)
	}
	if reqTitle != "SSO for teams" || quote != ps[0].QuoteText {
		t.Fatalf("title=%q quote=%q", reqTitle, quote)
	}
	if _, err := e.review.Accept(ctx, e.tenant, ps[0].ID, review.AcceptOpts{}); !errors.Is(err, review.ErrConflict) {
		t.Fatalf("double accept: %v", err)
	}

	// Undo restores exactly the earlier state.
	if err := e.review.Undo(ctx, e.tenant, ps[0].ID); err != nil {
		t.Fatal(err)
	}
	var reqs, evs int
	_ = e.db.Super.QueryRow(ctx, `SELECT (SELECT count(*) FROM request WHERE workspace_id=$1), (SELECT count(*) FROM evidence WHERE workspace_id=$1)`, e.tenant.WorkspaceID).Scan(&reqs, &evs)
	if reqs != 0 || evs != 0 || len(e.proposals(t, "suggested")) != 3 {
		t.Fatalf("undo left residue: requests=%d evidence=%d", reqs, evs)
	}
}

func TestMergeIntoExistingRequestKeepsTheRequestOnUndo(t *testing.T) {
	e := setup(t)
	res, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: convo})
	if err := e.run(t, res.SourceItemID, 1); err != nil {
		t.Fatal(err)
	}
	ps := e.proposals(t, "suggested")
	first, _ := e.review.Accept(ctx, e.tenant, ps[0].ID, review.AcceptOpts{})
	second, err := e.review.Accept(ctx, e.tenant, ps[1].ID, review.AcceptOpts{TargetRequestID: &first.RequestID})
	if err != nil || second.RequestID != first.RequestID {
		t.Fatalf("%+v %v", second, err)
	}
	// Undoing the merge removes only its evidence; the request stays with the first quote.
	if err := e.review.Undo(ctx, e.tenant, ps[1].ID); err != nil {
		t.Fatal(err)
	}
	var evs int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM evidence WHERE request_id=$1`, first.RequestID).Scan(&evs)
	if evs != 1 {
		t.Fatalf("evidence on request = %d, want 1", evs)
	}
	// Merging into a request that does not exist (or is another tenant's) is refused.
	ghost := uuid.New()
	if _, err := e.review.Accept(ctx, e.tenant, ps[1].ID, review.AcceptOpts{TargetRequestID: &ghost}); !errors.Is(err, review.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestDuplicatePasteQueuesNothingNew(t *testing.T) {
	e := setup(t)
	text := convo + "\n\nunique-" + uuid.NewString()
	a, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: text})
	b, err := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: strings.ReplaceAll(text, "\n", "\r\n")}) // same text, CRLF
	if err != nil || !b.Duplicate || b.SourceItemID != a.SourceItemID {
		t.Fatalf("%+v %v", b, err)
	}
	var jobs int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job WHERE args->>'source_item_id' = $1`, a.SourceItemID.String()).Scan(&jobs)
	if jobs != 1 {
		t.Fatalf("jobs=%d, want 1", jobs)
	}
}

func TestInputValidationAndRoles(t *testing.T) {
	e := setup(t)
	bad := map[string]intake.PasteInput{
		"empty":       {Text: ""},
		"blank":       {Text: " \n\t "},
		"invalid utf": {Text: "abc\xff\xfe"},
		"nul byte":    {Text: "abc\x00def"},
		"too long":    {Text: strings.Repeat("a", intake.DefaultMaxBytes+1)},
		"long title":  {Text: "x", Title: strings.Repeat("t", 201)},
		"bad url":     {Text: "x", OriginURL: "javascript:alert(1)"},
		"file url":    {Text: "x", OriginURL: "file:///etc/passwd"},
	}
	for name, in := range bad {
		_, err := e.svc.IngestPaste(ctx, e.tenant, in)
		var inv intake.ErrInvalid
		if !errors.As(err, &inv) {
			t.Errorf("%s: want ErrInvalid, got %v", name, err)
		}
	}
	if _, err := e.svc.IngestPaste(ctx, e.viewer, intake.PasteInput{Text: "viewer text " + uuid.NewString()}); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer ingest: %v", err)
	}
	// Nothing partial was written by the failures.
	var n int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM source_item WHERE workspace_id=$1 AND (raw_text='x' OR raw_text LIKE 'viewer text%')`, e.tenant.WorkspaceID).Scan(&n)
	if n != 0 {
		t.Fatalf("%d partial rows", n)
	}
}

func TestWorkerRetryIsIdempotentAndRecoversFromPartialFailure(t *testing.T) {
	e := setup(t)
	e.model.failFor = "Café" // outage on the chunk containing this, once
	res, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: convo + "\n\nretry-" + uuid.NewString()})

	if err := e.run(t, res.SourceItemID, 1); err == nil {
		t.Fatal("first attempt should report the failed chunk so the job retries")
	}
	if st := e.source(t, res.SourceItemID).ProcessingState; st != "processing" {
		t.Fatalf("state after partial failure = %s", st)
	}
	partial := len(e.proposals(t, "suggested"))

	if err := e.run(t, res.SourceItemID, 2); err != nil {
		t.Fatal(err)
	}
	if st := e.source(t, res.SourceItemID).ProcessingState; st != "done" {
		t.Fatalf("state after retry = %s", st)
	}
	full := len(e.proposals(t, "suggested"))
	if full < partial || full == 0 {
		t.Fatalf("partial=%d full=%d", partial, full)
	}

	// Running a finished item again changes nothing and calls no model.
	before := e.model.calls.Load()
	if err := e.run(t, res.SourceItemID, 3); err != nil || e.model.calls.Load() != before || len(e.proposals(t, "suggested")) != full {
		t.Fatalf("re-run not idempotent")
	}
}

func TestBulkAcceptTouchesOnlyItemsAtOrAboveThreshold(t *testing.T) {
	e := setup(t)
	res, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: convo + "\n\nbulk-" + uuid.NewString()})
	if err := e.run(t, res.SourceItemID, 1); err != nil {
		t.Fatal(err)
	}
	ps := e.proposals(t, "suggested") // confidences .95, .82, .55
	if err := e.review.Dismiss(ctx, e.tenant, ps[1].ID); err != nil {
		t.Fatal(err)
	}
	out, err := e.review.BulkAccept(ctx, e.tenant, 0.8)
	if err != nil || out.Accepted != 1 {
		t.Fatalf("%+v %v", out, err)
	}
	left := e.proposals(t, "suggested")
	if len(left) != 1 || left[0].Confidence >= 0.8 {
		t.Fatalf("below-threshold item must be untouched: %+v", left)
	}
	if len(e.proposals(t, "dismissed")) != 1 {
		t.Fatal("dismissed item must stay dismissed")
	}
	if _, err := e.review.BulkAccept(ctx, e.tenant, 0.1); err == nil {
		t.Fatal("a threshold below 0.5 must be refused")
	}
}

func TestOtherWorkspacesAndViewersCannotTouchTheQueue(t *testing.T) {
	e := setup(t)
	res, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: convo + "\n\niso-" + uuid.NewString()})
	_ = e.run(t, res.SourceItemID, 1)
	p := e.proposals(t, "suggested")[0]

	if _, err := e.review.Accept(ctx, e.other, p.ID, review.AcceptOpts{}); !errors.Is(err, review.ErrNotFound) {
		t.Errorf("other tenant accept: %v", err)
	}
	if err := e.review.Dismiss(ctx, e.other, p.ID); !errors.Is(err, review.ErrNotFound) {
		t.Errorf("other tenant dismiss: %v", err)
	}
	if ps, _ := e.review.List(ctx, e.other, "suggested", 50); len(ps) != 0 {
		t.Errorf("other tenant sees %d proposals", len(ps))
	}
	if _, err := e.review.Accept(ctx, e.viewer, p.ID, review.AcceptOpts{}); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer accept: %v", err)
	}
	if err := e.review.Dismiss(ctx, e.viewer, p.ID); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer dismiss: %v", err)
	}
	if err := e.review.Undo(ctx, e.viewer, p.ID); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer undo: %v", err)
	}
	// A viewer may read the queue.
	if ps, err := e.review.List(ctx, e.viewer, "suggested", 50); err != nil || len(ps) == 0 {
		t.Errorf("viewer list: %v %d", err, len(ps))
	}
	_ = pgx.ErrNoRows
}

func TestSloppyQuotesAreStoredAsTheSourcesOwnWordsAndAccepted(t *testing.T) {
	e := setup(t)
	e.model.shout = true
	res, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: convo + "\n\nshout-" + uuid.NewString()})
	if err := e.run(t, res.SourceItemID, 1); err != nil {
		t.Fatal(err)
	}
	item := e.source(t, res.SourceItemID)
	ps := e.proposals(t, "suggested")
	if len(ps) == 0 {
		t.Fatal("loose matching should have recovered the shouted quotes")
	}
	for _, p := range ps {
		if p.QuoteText != item.RawText[p.SpanStart:p.SpanEnd] || p.QuoteText == strings.ToUpper(p.QuoteText) {
			t.Errorf("stored %q; must be the source's own text", p.QuoteText)
		}
		if _, err := e.review.Accept(ctx, e.tenant, p.ID, review.AcceptOpts{}); err != nil {
			t.Errorf("accept (database quote check) failed: %v", err)
		}
	}
}

func TestEditedFlagFollowsWhatAPersonChanged(t *testing.T) {
	e := setup(t)
	res, _ := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: convo + "\n\nedit-" + uuid.NewString()})
	if err := e.run(t, res.SourceItemID, 1); err != nil {
		t.Fatal(err)
	}
	ps := e.proposals(t, "suggested")
	edited := func(id uuid.UUID) bool {
		var v bool
		if err := e.db.Super.QueryRow(ctx, `SELECT edited FROM proposal WHERE id=$1`, id).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	// Accepted exactly as suggested: not edited.
	if _, err := e.review.Accept(ctx, e.tenant, ps[0].ID, review.AcceptOpts{}); err != nil || edited(ps[0].ID) {
		t.Fatalf("plain accept marked edited: %v", err)
	}
	// Accepted with a different title: edited, and it stays edited after undo (the new title is kept).
	title := "Better name"
	if _, err := e.review.Accept(ctx, e.tenant, ps[1].ID, review.AcceptOpts{Title: &title}); err != nil || !edited(ps[1].ID) {
		t.Fatalf("renamed accept not marked edited: %v", err)
	}
	if err := e.review.Undo(ctx, e.tenant, ps[1].ID); err != nil || !edited(ps[1].ID) {
		t.Fatalf("undo must not forget the edit: %v", err)
	}
	// Renaming before accepting also counts; re-typing the same title does not.
	if err := e.review.EditTitle(ctx, e.tenant, ps[2].ID, "Renamed first"); err != nil || !edited(ps[2].ID) {
		t.Fatalf("rename: %v", err)
	}
	same := ps[0].Title
	_ = e.review.Undo(ctx, e.tenant, ps[0].ID)
	if _, err := e.review.Accept(ctx, e.tenant, ps[0].ID, review.AcceptOpts{Title: &same}); err != nil || edited(ps[0].ID) {
		t.Fatalf("an unchanged title is not an edit: %v", err)
	}
}

func TestAWorkerWithoutAnAIProviderWaitsInsteadOfFailing(t *testing.T) {
	e := setup(t)
	idle := &intake.ExtractWorker{Pool: e.db.Backend} // no Completer
	err := idle.Work(ctx, &river.Job[intake.ExtractArgs]{
		JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
		Args:   intake.ExtractArgs{WorkspaceID: e.tenant.WorkspaceID, SourceItemID: uuid.New(), UserID: e.tenant.UserID},
	})
	var snooze *river.JobSnoozeError
	if !errors.As(err, &snooze) {
		t.Fatalf("want a snooze (wait without using attempts), got %v", err)
	}
}

func TestSecretsAreHiddenBeforeStorageAndBeforeTheModelSeesAnything(t *testing.T) {
	e := setup(t)
	pasted := "Dana: our SSO is blocked. My card 4111 1111 1111 1111 is on file, and here is the key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 and password: hunter2xyz.\nDana: we really need single sign-on."
	res, err := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: pasted})
	if err != nil {
		t.Fatal(err)
	}
	if res.Redactions != 3 {
		t.Fatalf("redactions: %d", res.Redactions)
	}
	var text string
	var count int
	if err := e.db.Super.QueryRow(ctx, `SELECT raw_text, redactions FROM source_item WHERE id=$1`, res.SourceItemID).Scan(&text, &count); err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"4111", "sk-proj", "hunter2", "AbCdEf"} {
		if strings.Contains(text, leak) {
			t.Errorf("%q was stored: %q", leak, text)
		}
	}
	if count != 3 || !strings.Contains(text, "[card number removed]") || !strings.Contains(text, "we really need single sign-on") {
		t.Errorf("%d %q", count, text)
	}
	// The chunks (what a model is shown) are clean too.
	var leaked int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM chunk WHERE source_item_id=$1 AND (text LIKE '%4111%' OR text LIKE '%sk-proj%' OR text LIKE '%hunter2%')`, res.SourceItemID).Scan(&leaked)
	if leaked != 0 {
		t.Errorf("%d chunks hold secrets", leaked)
	}
	// Pasting the same thing again is recognised as the same text (the clean text is what is compared).
	again, err := e.svc.IngestPaste(ctx, e.tenant, intake.PasteInput{Text: pasted})
	if err != nil || !again.Duplicate || again.SourceItemID != res.SourceItemID {
		t.Fatalf("%v %+v", err, again)
	}
}
