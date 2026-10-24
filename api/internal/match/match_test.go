package match_test

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/ai"
	"product/api/internal/embed"
	"product/api/internal/match"
	"product/api/internal/store"
	"product/api/internal/testdb"
)

var ctx = context.Background()

// topics stand in for meaning: texts that mention words of the same topic point the same way.
var topics = [][]string{
	{"export", "download", "csv", "spreadsheet"},
	{"dark", "night", "theme", "contrast"},
	{"slow", "speed", "lag", "wait"},
	{"invoice", "billing", "receipt", "payment"},
}

type fakeEmbed struct {
	model string
	calls int
}

func (f *fakeEmbed) Name() string  { return "fake" }
func (f *fakeEmbed) Model() string { return f.model }
func (f *fakeEmbed) Dim() int      { return match.VectorDim }
func (f *fakeEmbed) Embed(_ context.Context, texts []string) ([][]float32, embed.Usage, error) {
	f.calls++
	out := make([][]float32, len(texts))
	for i, t := range texts {
		v := make([]float32, match.VectorDim)
		low := strings.ToLower(t)
		for k, words := range topics {
			for _, w := range words {
				if strings.Contains(low, w) {
					v[k] += 1
				}
			}
		}
		v[100] = 0.05 // never a zero vector
		var n float64
		for _, x := range v {
			n += float64(x * x)
		}
		for j := range v {
			v[j] /= float32(math.Sqrt(n))
		}
		out[i] = v
	}
	return out, embed.Usage{Tokens: len(texts) * 10}, nil
}

type fakeJudge struct {
	answer map[string]any
	err    error
	seen   []ai.Request
}

func (j *fakeJudge) Complete(_ context.Context, _ ai.Tier, req ai.Request) (ai.Response, error) {
	j.seen = append(j.seen, req)
	if j.err != nil {
		return ai.Response{}, j.err
	}
	b, _ := json.Marshal(j.answer)
	return ai.Response{JSON: b}, nil
}

type env struct {
	db    *testdb.DB
	svc   *match.Service
	emb   *fakeEmbed
	ws    uuid.UUID
	ten   store.Tenant
	other store.Tenant
	src   uuid.UUID
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	e := &env{db: db, emb: &fakeEmbed{model: "m1"}, ws: uuid.New()}
	e.ten = store.Tenant{WorkspaceID: e.ws, UserID: uuid.New(), Role: store.RoleMember}
	e.other = store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleMember}
	for _, ten := range []store.Tenant{e.ten, e.other} {
		mustExec(t, db, `INSERT INTO workspace (id, name) VALUES ($1,'W')`, ten.WorkspaceID)
		mustExec(t, db, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ten.WorkspaceID, ten.UserID)
		mustExec(t, db, `INSERT INTO status (workspace_id, name, bucket) VALUES ($1,'Open','open') ON CONFLICT DO NOTHING`, ten.WorkspaceID)
	}
	e.svc = &match.Service{Pool: db.Backend, Embed: e.emb}
	e.src = e.source(t, e.ten, "call")
	return e
}

func mustExec(t *testing.T, db *testdb.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.Super.Exec(ctx, q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func (e *env) source(t *testing.T, ten store.Tenant, title string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	mustExec(t, e.db, `INSERT INTO source_item (id, workspace_id, kind, title, raw_text, content_hash, created_by) VALUES ($1,$2,'paste',$3,$6,$4,$5)`, id, ten.WorkspaceID, title, id.String(), ten.UserID, corpus)
	mustExec(t, e.db, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4)`, ten.WorkspaceID, id, len(corpus), corpus)
	return id
}

func (e *env) chunk(t *testing.T, src uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `SELECT id FROM chunk WHERE source_item_id=$1 LIMIT 1`, src).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func (e *env) request(t *testing.T, ten store.Tenant, title string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	mustExec(t, e.db, `INSERT INTO request (id, workspace_id, title, status_id) SELECT $1,$2,$3,id FROM status WHERE workspace_id=$2 LIMIT 1`, id, ten.WorkspaceID, title)
	return id
}

// corpus is the text of every source in these tests: a stored quote must appear verbatim in its source (and
// the source text can never change), so each quote used below is a sentence of it.
const corpus = "I wish I could export everything to csv. export to csv please. csv export. my invoice is wrong. export csv spreadsheet download. " +
	"export csv spreadsheet. export csv. it is so slow, I wait forever. everything lags and I wait ages. my invoice shows the wrong payment."

func (e *env) span(t *testing.T, _ uuid.UUID, quote string) (int, int) {
	t.Helper()
	at := strings.Index(corpus, quote)
	if at < 0 {
		t.Fatalf("test quote %q is not in the corpus", quote)
	}
	return at, at + len(quote)
}

func (e *env) proposal(t *testing.T, ten store.Tenant, src uuid.UUID, title, quote string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	a, b := e.span(t, src, quote)
	mustExec(t, e.db, `INSERT INTO proposal (id, workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence) VALUES ($1,$2,$3,$4,'new_request','need',$5,$6,$7,$8,0.9)`,
		id, ten.WorkspaceID, src, e.chunk(t, src), title, quote, a, b)
	return id
}

func (e *env) evidence(t *testing.T, ten store.Tenant, src, req uuid.UUID, quote string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	a, b := e.span(t, src, quote)
	mustExec(t, e.db, `INSERT INTO evidence (id, workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, ten.WorkspaceID, req, src, e.chunk(t, src), quote, a, b, ten.UserID)
	return id
}

func (e *env) suggestion(t *testing.T, p uuid.UUID) (suggested *uuid.UUID, matched bool, why string) {
	t.Helper()
	var at *string
	if err := e.db.Super.QueryRow(ctx, `SELECT suggested_request_id, matched_at::text, match_rationale FROM proposal WHERE id=$1`, p).Scan(&suggested, &at, &why); err != nil {
		t.Fatal(err)
	}
	return suggested, at != nil, why
}

func TestSuggestsTheRequestWithTheSameMeaning(t *testing.T) {
	e := setup(t)
	csv := e.request(t, e.ten, "Download my data as a spreadsheet")
	e.request(t, e.ten, "Dark theme")
	p := e.proposal(t, e.ten, e.src, "Export", "I wish I could export everything to csv")
	e.svc.Judge = &fakeJudge{answer: map[string]any{"match": 1, "confidence": 0.93, "reason": "Both ask to get data out as a file."}}
	n, err := e.svc.SuggestForSource(ctx, e.ten, e.src)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	got, matched, why := e.suggestion(t, p)
	if !matched || got == nil || *got != csv || !strings.Contains(why, "file") {
		t.Fatalf("got %v matched=%v why=%q", got, matched, why)
	}
}

func TestAWeakJudgeAnswerIsNotASuggestion(t *testing.T) {
	e := setup(t)
	e.request(t, e.ten, "Download my data as a spreadsheet")
	p := e.proposal(t, e.ten, e.src, "Export", "export to csv please")
	e.svc.Judge = &fakeJudge{answer: map[string]any{"match": 1, "confidence": 0.6, "reason": "maybe"}}
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	got, matched, _ := e.suggestion(t, p)
	if got != nil || !matched {
		t.Fatalf("a 0.6 answer must not be suggested (got=%v matched=%v)", got, matched)
	}
	// "none of them" is also respected even when the texts are close
	e.svc.Judge = &fakeJudge{answer: map[string]any{"match": 0, "confidence": 0.99, "reason": "different"}}
	p2 := e.proposal(t, e.ten, e.src, "Export again", "csv export")
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := e.suggestion(t, p2); got != nil {
		t.Fatal("the judge said none")
	}
}

func TestUnrelatedStatementsGetNoSuggestionAndNoJudgeCall(t *testing.T) {
	e := setup(t)
	e.request(t, e.ten, "Dark theme")
	p := e.proposal(t, e.ten, e.src, "Billing", "my invoice is wrong")
	j := &fakeJudge{answer: map[string]any{"match": 1, "confidence": 1.0, "reason": "x"}}
	e.svc.Judge = j
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	if got, matched, _ := e.suggestion(t, p); got != nil || !matched {
		t.Fatal("unrelated text must not be suggested")
	}
	if len(j.seen) != 0 {
		t.Fatal("below the similarity floor the judge is not even asked")
	}
}

func TestWithoutAJudgeOnlyVeryCloseMatchesAreSuggested(t *testing.T) {
	e := setup(t)
	r := e.request(t, e.ten, "csv export spreadsheet")
	p := e.proposal(t, e.ten, e.src, "csv export spreadsheet", "export csv spreadsheet")
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	if got, _, why := e.suggestion(t, p); got == nil || *got != r || why != "" {
		t.Fatalf("got=%v why=%q", got, why)
	}
}

func TestAJudgeFailureFallsBackToTheStrictRule(t *testing.T) {
	e := setup(t)
	e.request(t, e.ten, "Download spreadsheet, slow speed")
	p := e.proposal(t, e.ten, e.src, "Export", "export csv")
	e.svc.Judge = &fakeJudge{err: errors.New("down")}
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	// similar in meaning but under the strict bar, so nothing is guessed
	if got, matched, _ := e.suggestion(t, p); got != nil || !matched {
		t.Fatalf("got=%v matched=%v", got, matched)
	}
}

func TestOnlyUnexaminedProposalsAreLookedAt(t *testing.T) {
	e := setup(t)
	e.request(t, e.ten, "Download my data as a spreadsheet")
	e.proposal(t, e.ten, e.src, "Export", "export csv")
	e.svc.Judge = &fakeJudge{answer: map[string]any{"match": 0, "confidence": 0.9, "reason": "no"}}
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	calls := e.emb.calls
	if n, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil || n != 0 || e.emb.calls != calls {
		t.Fatalf("a second pass must do nothing (n=%d calls %d→%d err=%v)", n, calls, e.emb.calls, err)
	}
}

func TestOtherWorkspacesRequestsAreNeverCandidates(t *testing.T) {
	e := setup(t)
	e.request(t, e.other, "Download my data as a spreadsheet")
	p := e.proposal(t, e.ten, e.src, "Export", "export csv spreadsheet download")
	j := &fakeJudge{answer: map[string]any{"match": 1, "confidence": 1.0, "reason": "x"}}
	e.svc.Judge = j
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := e.suggestion(t, p); got != nil || len(j.seen) != 0 {
		t.Fatal("another workspace's request leaked into matching")
	}
}

func TestVectorsFromAnotherModelAreNotCompared(t *testing.T) {
	e := setup(t)
	e.request(t, e.ten, "Download my data as a spreadsheet")
	if _, err := e.svc.EnsureRequestVectors(ctx, e.ten, 100); err != nil {
		t.Fatal(err)
	}
	e.emb.model = "m2"
	got, err := e.svc.Related(ctx, e.ten, "export csv", 5)
	if err != nil || len(got) != 1 {
		t.Fatalf("the request is re-embedded with the new model first: %v %v", got, err)
	}
	var models int
	if err := e.db.Super.QueryRow(ctx, `SELECT count(DISTINCT model) FROM request_embedding WHERE workspace_id=$1`, e.ws).Scan(&models); err != nil || models != 1 {
		t.Fatalf("models=%d err=%v", models, err)
	}
}

func TestRequestVectorsRefreshWhenTheirQuotesChange(t *testing.T) {
	e := setup(t)
	r := e.request(t, e.ten, "Something")
	if n, _ := e.svc.EnsureRequestVectors(ctx, e.ten, 100); n != 1 {
		t.Fatal(n)
	}
	if n, _ := e.svc.EnsureRequestVectors(ctx, e.ten, 100); n != 0 {
		t.Fatalf("unchanged text must not be embedded again, got %d", n)
	}
	e.evidence(t, e.ten, e.src, r, "it is so slow, I wait forever")
	if n, _ := e.svc.EnsureRequestVectors(ctx, e.ten, 100); n != 1 {
		t.Fatalf("a new quote changes what the request is about, got %d", n)
	}
}

func TestSearchQuotesByMeaning(t *testing.T) {
	e := setup(t)
	r := e.request(t, e.ten, "Perf")
	e.evidence(t, e.ten, e.src, r, "everything lags and I wait ages")
	e.evidence(t, e.ten, e.src, r, "my invoice shows the wrong payment")
	if left, _ := e.svc.Pending(ctx, e.ten); left != 2 {
		t.Fatalf("pending=%d", left)
	}
	if n, err := e.svc.IndexQuotes(ctx, e.ten, 100); err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if left, _ := e.svc.Pending(ctx, e.ten); left != 0 {
		t.Fatalf("pending=%d", left)
	}
	hits, err := e.svc.SearchQuotes(ctx, e.ten, "slow speed", 10)
	if err != nil || len(hits) != 1 || !strings.Contains(hits[0].Text, "lags") {
		t.Fatalf("hits=%v err=%v", hits, err)
	}
	// the other workspace sees nothing
	if hits, _ := e.svc.SearchQuotes(ctx, e.other, "slow speed", 10); len(hits) != 0 {
		t.Fatal("search leaked across workspaces")
	}
}

func TestOffWhenNoEmbedder(t *testing.T) {
	e := setup(t)
	e.svc.Embed = nil
	if _, err := e.svc.SearchQuotes(ctx, e.ten, "x", 5); !errors.Is(err, match.ErrOff) {
		t.Fatal(err)
	}
	if _, err := e.svc.SuggestForSource(ctx, e.ten, e.src); !errors.Is(err, match.ErrOff) {
		t.Fatal(err)
	}
}

func TestEmbeddingCallsAreLogged(t *testing.T) {
	e := setup(t)
	e.svc.PricePerMTokensUSD = 0.02
	e.request(t, e.ten, "Dark theme")
	if _, err := e.svc.EnsureRequestVectors(ctx, e.ten, 10); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := e.db.Super.QueryRow(ctx, `SELECT count(*) FROM ai_event WHERE workspace_id=$1 AND task='embedding' AND input_tokens=10 AND outcome='ok'`, e.ws).Scan(&n); err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}
