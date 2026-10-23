package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/ai"
	"product/api/internal/apikey"
	"product/api/internal/audit"
	"product/api/internal/auth"
	"product/api/internal/brief"
	"product/api/internal/digest"
	"product/api/internal/directory"
	"product/api/internal/email"
	"product/api/internal/httpx"
	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/media"
	"product/api/internal/ops"
	"product/api/internal/outreach"
	"product/api/internal/portability"
	"product/api/internal/publicsite"
	"product/api/internal/quality"
	"product/api/internal/ratelimit"
	"product/api/internal/release"
	"product/api/internal/research"
	"product/api/internal/review"
	"product/api/internal/storage"
	"product/api/internal/testdb"
	"product/api/internal/transcribe"
	"product/api/internal/views"
	"product/api/internal/webhook"
	"product/api/internal/workflow"
	"product/api/internal/workspaces"
)

// stubVerifier accepts tokens of the form "t:<user uuid>".
type stubVerifier struct{}

func (stubVerifier) Verify(raw string) (auth.Identity, error) {
	id, ok := strings.CutPrefix(raw, "t:")
	if !ok {
		return auth.Identity{}, auth.ErrUnauthorized
	}
	// "t:<uuid>" or "t:<uuid>|<email>|v" (v: the identity service confirmed the address) or "|u" (unconfirmed)
	parts := strings.Split(id, "|")
	u, err := uuid.Parse(parts[0])
	if err != nil {
		return auth.Identity{}, auth.ErrUnauthorized
	}
	out := auth.Identity{UserID: u}
	if len(parts) == 3 {
		out.Email, out.EmailVerified = parts[1], parts[2] == "v"
	}
	return out, nil
}

// model finds the real quotes in a conversation, like a good model would.
type model struct{}

func (model) Name() string { return "fake" }
func (model) Complete(_ context.Context, r ai.Request) (ai.Response, error) {
	user := r.Messages[0].Text
	if r.Task == "outreach_draft" {
		raw, _ := json.Marshal(map[string]any{"subject": "It has shipped", "message": "It is live now. Thank you for telling us what you needed."})
		return ai.Response{JSON: raw}, nil
	}
	if r.Task == "qa" {
		raw, _ := json.Marshal(map[string]any{"answerable": true, "answer": "Customers say they need single sign-on [1].", "reason": ""})
		return ai.Response{JSON: raw, Provider: "fake", Model: "m"}, nil
	}
	if r.Task == "brief" {
		var ids []string
		for _, line := range strings.Split(user, "\n") {
			if strings.HasPrefix(line, "[") && len(ids) < 2 {
				ids = append(ids, line[1:strings.Index(line, "]")])
			}
		}
		claim, disproof := "Customers want single sign-on.", "If one team drove all of it."
		if strings.Contains(user, "showing 1)") { // a compliant model does not generalise from one quote
			claim, disproof = "One customer said they need single sign-on.", "If this was a one-off request it matters less."
		}
		raw, _ := json.Marshal(map[string]any{"claim": claim, "quote_ids": ids, "disproof": disproof})
		return ai.Response{JSON: raw}, nil
	}
	var out []map[string]any
	for _, q := range []string{"We really need SSO for our team.", "exports keep dropping rows"} {
		if strings.Contains(user, q) {
			out = append(out, map[string]any{"quote": q, "kind": "need", "title": "T: " + q[:8], "confidence": 0.9})
		}
	}
	raw, _ := json.Marshal(map[string]any{"statements": out})
	return ai.Response{JSON: raw, Usage: ai.Usage{InputTokens: 10, OutputTokens: 5}}, nil
}

type harness struct {
	logs    *safeBuffer
	srv     *Server
	transW  *media.TranscribeWorker
	prov    *stubTranscriber
	disk    storage.Store
	t       *testing.T
	h       http.Handler
	db      *testdb.DB
	worker  *intake.ExtractWorker
	briefW  *brief.Worker
	draftW  *outreach.DraftWorker
	sendW   *outreach.SendWorker
	mail    *recordingMail
	unsub   outreach.Unsubscriber
	alice   string // token
	bob     string
	aliceID uuid.UUID
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	return newHarnessStore(t, &storage.Local{Dir: t.TempDir()})
}

// newHarnessStore is newHarness with recordings kept in the given store.
func newHarnessStore(t *testing.T, disk storage.Store) *harness {
	t.Helper()
	logs := &safeBuffer{}
	db := testdb.New(t)
	db.EnableRiver(t)
	prov := &stubTranscriber{}
	route := []ai.Route{{Provider: "fake", Model: "m", AllowCustomerData: true}}
	router, err := ai.NewRouter([]ai.Provider{model{}}, map[ai.Tier][]ai.Route{ai.TierMid: route, ai.TierLarge: route}, nil)
	if err != nil {
		t.Fatal(err)
	}
	worker := &intake.ExtractWorker{Pool: db.Backend, Completer: router}
	briefWorker := &brief.Worker{Pool: db.Backend, Completer: router}
	mail := &recordingMail{}
	unsub := outreach.Unsubscriber{BaseURL: "https://app.example", Secret: []byte("http-test-secret-with-enough-length")}
	draftW := &outreach.DraftWorker{Pool: db.Backend, Completer: router}
	sendW := &outreach.SendWorker{Pool: db.Backend, Sender: mail, FromAddress: "updates@mail.example.com", Unsub: unsub}
	workers := river.NewWorkers()
	tw := &media.TranscribeWorker{Pool: db.Backend, Store: disk, Provider: prov}
	river.AddWorker(workers, tw)
	river.AddWorker(workers, &research.SuggestWorker{Pool: db.Backend, Completer: router})
	river.AddWorker(workers, worker)
	river.AddWorker(workers, briefWorker)
	river.AddWorker(workers, draftW)
	river.AddWorker(workers, sendW)
	jc, err := jobs.NewClientWith(db.Backend, workers, nil, jobs.AllQueues, jobs.Extras{Plugins: []rivertype.Plugin{&ops.StampJobs{}}})
	if err != nil {
		t.Fatal(err)
	}
	tw.Jobs = jc
	outSvc := &outreach.Service{Pool: db.Backend, Jobs: jc, HashKey: unsub.Secret}
	resSvc := &research.Service{Pool: db.Backend, Jobs: jc}
	intakeSvc := &intake.Service{Pool: db.Backend, Jobs: jc, ChunkBytes: 100}
	srv := &Server{
		Version: "t", Auth: stubVerifier{}, Pool: db.Backend,
		Workspaces:  &workspaces.Service{Pool: db.Backend},
		Intake:      intakeSvc,
		Site:        &publicsite.Service{Pool: db.Backend, Intake: intakeSvc},
		APIKeys:     &apikey.Service{Pool: db.Backend},
		Digest:      &digest.Service{Pool: db.Backend, Unsub: digest.Unsubscriber{BaseURL: "https://app.example", Secret: []byte("http-test-secret-with-enough-length")}},
		Review:      &review.Service{Pool: db.Backend},
		Directory:   &directory.Service{Pool: db.Backend},
		Brief:       &brief.Service{Pool: db.Backend, Jobs: jc},
		Quality:     &quality.Service{Pool: db.Backend},
		Portability: &portability.Service{Pool: db.Backend},
		Outreach:    outSvc,
		Workflow:    &workflow.Service{Pool: db.Backend, Outreach: outSvc},
		Release:     &release.Service{Pool: db.Backend},
		Research:    resSvc,
		Views:       &views.Service{Pool: db.Backend},
		Audit:       &audit.Service{Pool: db.Backend, QA: &research.QA{Pool: resSvc}, Brief: &brief.Service{Pool: db.Backend}},
		Limiter:     &ratelimit.Limiter{Pool: db.Backend, Secret: []byte("http-test")},
		Limits:      Limits{ReadPerMinute: 100000, WritePerMinute: 100000, PublicPerMinute: 100000, WebhookPerMinute: 100000},
		Webhook:     &webhook.Resend{Pool: db.Backend, Suppress: outSvc, Secret: testWebhookSecret},
		Media:       &media.Service{Pool: db.Backend, Jobs: jc, Store: disk, HashKey: unsub.Secret},
		QA:          &research.QA{Pool: resSvc, Completer: router},
		Unsub:       unsub,
	}
	srv.Site.Throttle = publicsite.Throttle(srv.Limiter, 20, 1000)
	srv.Site.VoteThrottle = publicsite.VoteThrottle(srv.Limiter, 1000)
	h, err := NewHandler(srv)
	if err != nil {
		t.Fatal(err)
	}
	h = httpx.Chain(h, slog.New(slog.NewTextHandler(logs, nil)), []string{"https://app.example"}, 10*time.Second, 1<<20)
	a, b := uuid.New(), uuid.New()
	return &harness{logs: logs, srv: srv, t: t, h: h, db: db, transW: tw, prov: prov, disk: disk, worker: worker, briefW: briefWorker, draftW: draftW, sendW: sendW, mail: mail, unsub: unsub, alice: "t:" + a.String(), bob: "t:" + b.String(), aliceID: a}
}

func (hn *harness) do(token, method, path string, body any) (int, map[string]any, http.Header) {
	hn.t.Helper()
	var rdr io.Reader
	if body != nil {
		var b []byte
		if s, ok := body.(string); ok {
			b = []byte(s)
		} else {
			b, _ = json.Marshal(body)
		}
		rdr = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	hn.h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Header()
}

func (hn *harness) workspace(token, name string) string {
	hn.t.Helper()
	code, body, _ := hn.do(token, "POST", "/v1/workspaces", map[string]any{"name": name})
	if code != 201 {
		hn.t.Fatalf("create workspace: %d %v", code, body)
	}
	return body["id"].(string)
}

const convo = "Dana: Hi.\n\nDana: We really need SSO for our team.\n\nDana: Also our exports keep dropping rows today."

func (hn *harness) processed(token, ws string, text string) string {
	hn.t.Helper()
	code, body, _ := hn.do(token, "POST", "/v1/workspaces/"+ws+"/sources/paste", map[string]any{"text": text, "title": "call"})
	if code != 202 {
		hn.t.Fatalf("paste: %d %v", code, body)
	}
	sid := uuid.MustParse(body["sourceItemId"].(string))
	err := hn.worker.Work(context.Background(), &river.Job[intake.ExtractArgs]{
		JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
		Args:   intake.ExtractArgs{WorkspaceID: uuid.MustParse(ws), SourceItemID: sid, UserID: hn.aliceID},
	})
	if err != nil {
		hn.t.Fatal(err)
	}
	return sid.String()
}

func TestHappyPathOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Acme")

	code, body, hdr := h.do(h.alice, "GET", "/v1/workspaces", nil)
	if code != 200 || len(body["workspaces"].([]any)) != 1 || hdr.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("list: %d %v", code, body)
	}

	sid := h.processed(h.alice, ws, convo+"\n\n"+uuid.NewString())
	code, src, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/sources/"+sid, nil)
	if code != 200 || src["state"] != "done" || !strings.Contains(src["text"].(string), "We really need SSO") {
		t.Fatalf("source: %d %v", code, src)
	}

	code, q, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/proposals", nil)
	props := q["proposals"].([]any)
	if code != 200 || len(props) != 2 {
		t.Fatalf("queue: %d %v", code, q)
	}
	first := props[0].(map[string]any)
	text := src["text"].(string)
	s, e := int(first["spanStart"].(float64)), int(first["spanEnd"].(float64))
	if text[s:e] != first["quote"] {
		t.Fatalf("API returned a quote that is not the source at its span")
	}

	pid := first["id"].(string)
	code, acc, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/proposals/"+pid+"/accept", map[string]any{"title": "SSO please"})
	if code != 200 {
		t.Fatalf("accept: %d %v", code, acc)
	}
	code, req, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/requests/"+acc["requestId"].(string), nil)
	ev := req["evidence"].([]any)
	if code != 200 || req["title"] != "SSO please" || len(ev) != 1 || ev[0].(map[string]any)["quote"] != first["quote"] {
		t.Fatalf("request: %d %v", code, req)
	}
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/proposals/"+pid+"/accept", nil); code != 409 {
		t.Errorf("second accept: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/proposals/"+pid+"/undo", nil); code != 204 {
		t.Errorf("undo: %d", code)
	}
	code, list, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/requests", nil)
	if code != 200 || len(list["requests"].([]any)) != 0 {
		t.Errorf("undo should remove the request: %d %v", code, list)
	}
	code, bulk, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/proposals/bulk-accept", map[string]any{"threshold": 0.8})
	if code != 200 || bulk["accepted"].(float64) != 2 {
		t.Errorf("bulk: %d %v", code, bulk)
	}
}

func TestRequestsPaginateWithAStableCursor(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Pages")
	h.processed(h.alice, ws, convo+"\n\n"+uuid.NewString())
	h.processed(h.alice, ws, convo+"\n\n"+uuid.NewString())
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/proposals/bulk-accept", map[string]any{"threshold": 0.5}); code != 200 {
		t.Fatal("bulk")
	}
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 10; page++ {
		path := "/v1/workspaces/" + ws + "/requests?limit=3"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		code, body, _ := h.do(h.alice, "GET", path, nil)
		if code != 200 {
			t.Fatalf("page %d: %d %v", page, code, body)
		}
		for _, r := range body["requests"].([]any) {
			id := r.(map[string]any)["id"].(string)
			if seen[id] {
				t.Fatalf("request %s repeated across pages", id)
			}
			seen[id] = true
		}
		next, ok := body["nextCursor"].(string)
		if !ok {
			break
		}
		cursor = next
	}
	if len(seen) != 4 {
		t.Fatalf("saw %d requests, want 4", len(seen))
	}
	if code, _, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/requests?cursor=not-a-cursor", nil); code != 400 {
		t.Errorf("bad cursor: %d", code)
	}
}

func TestAuthenticationIsRequiredEverywhereExceptHealth(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Private")
	routes := []struct{ method, path string }{
		{"GET", "/v1/workspaces"}, {"POST", "/v1/workspaces"},
		{"POST", "/v1/workspaces/" + ws + "/sources/paste"}, {"GET", "/v1/workspaces/" + ws + "/proposals"},
		{"GET", "/v1/workspaces/" + ws + "/requests"}, {"POST", "/v1/workspaces/" + ws + "/proposals/bulk-accept"},
	}
	for _, r := range routes {
		for name, tok := range map[string]string{"none": "", "garbage": "garbage", "wrong scheme": "t:not-a-uuid"} {
			code, body, hdr := h.do(tok, r.method, r.path, "{}")
			if code != 401 {
				t.Errorf("%s %s with %s token: %d", r.method, r.path, name, code)
			}
			if hdr.Get("WWW-Authenticate") == "" {
				t.Errorf("%s %s: missing WWW-Authenticate", r.method, r.path)
			}
			if msg, _ := json.Marshal(body); strings.Contains(string(msg), "uuid") || strings.Contains(string(msg), "token") {
				t.Errorf("unauthorized response explains why: %s", msg)
			}
		}
	}
	if code, _, _ := h.do("", "GET", "/healthz", nil); code != 200 {
		t.Errorf("healthz must be public: %d", code)
	}
}

func TestWorkspacesAreInvisibleToNonMembersAndRolesAreEnforced(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Alice's")
	sid := h.processed(h.alice, ws, convo+"\n\n"+uuid.NewString())
	_, q, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/proposals", nil)
	pid := q["proposals"].([]any)[0].(map[string]any)["id"].(string)

	// Bob is signed in but not a member: everything looks like it does not exist.
	for _, r := range []struct{ method, path string }{
		{"GET", "/v1/workspaces/" + ws + "/proposals"}, {"GET", "/v1/workspaces/" + ws + "/sources/" + sid},
		{"POST", "/v1/workspaces/" + ws + "/proposals/" + pid + "/accept"}, {"GET", "/v1/workspaces/" + ws + "/requests"},
		{"GET", "/v1/workspaces/" + uuid.NewString() + "/requests"},
	} {
		if code, _, _ := h.do(h.bob, r.method, r.path, nil); code != 404 {
			t.Errorf("bob %s %s: %d, want 404", r.method, r.path, code)
		}
	}
	if code, body, _ := h.do(h.bob, "GET", "/v1/workspaces", nil); code != 200 || len(body["workspaces"].([]any)) != 0 {
		t.Errorf("bob sees workspaces: %v", body)
	}

	// Bob joins as a viewer: can read, cannot change.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "GET", "/v1/workspaces/"+ws+"/proposals", nil); code != 200 {
		t.Errorf("viewer read: %d", code)
	}
	for _, r := range []struct{ method, path string }{
		{"POST", "/v1/workspaces/" + ws + "/proposals/" + pid + "/accept"}, {"POST", "/v1/workspaces/" + ws + "/proposals/" + pid + "/dismiss"},
		{"POST", "/v1/workspaces/" + ws + "/proposals/" + pid + "/undo"},
	} {
		if code, _, _ := h.do(h.bob, r.method, r.path, nil); code != 403 {
			t.Errorf("viewer %s %s: %d, want 403", r.method, r.path, code)
		}
	}
	if code, _, _ := h.do(h.bob, "POST", "/v1/workspaces/"+ws+"/sources/paste", map[string]any{"text": "viewer text"}); code != 403 {
		t.Errorf("viewer paste: %d", code)
	}
}

func TestBadInputGetsSafeMessagesAndNothingLeaks(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Input")
	base := "/v1/workspaces/" + ws

	cases := map[string]struct {
		method, path string
		body         any
		want         int
	}{
		"empty text":        {"POST", base + "/sources/paste", map[string]any{"text": ""}, 400},
		"blank text":        {"POST", base + "/sources/paste", map[string]any{"text": "   \n "}, 400},
		"unknown field":     {"POST", base + "/sources/paste", map[string]any{"text": "x", "admin": true}, 400},
		"wrong type":        {"POST", base + "/sources/paste", map[string]any{"text": 5}, 400},
		"broken json":       {"POST", base + "/sources/paste", "{not json", 400},
		"javascript url":    {"POST", base + "/sources/paste", map[string]any{"text": "x", "originUrl": "javascript:alert(1)"}, 400},
		"bad workspace id":  {"GET", "/v1/workspaces/not-a-uuid/requests", nil, 400},
		"limit too high":    {"GET", base + "/requests?limit=5000", nil, 400},
		"bad state":         {"GET", base + "/proposals?state=hacked", nil, 400},
		"threshold too low": {"POST", base + "/proposals/bulk-accept", map[string]any{"threshold": 0.1}, 400},
		"empty ws name":     {"POST", "/v1/workspaces", map[string]any{"name": "  "}, 400},
		"unknown proposal":  {"POST", base + "/proposals/" + uuid.NewString() + "/accept", nil, 404},
		"unknown route":     {"GET", base + "/nope", nil, 404},
	}
	for name, c := range cases {
		code, body, _ := h.do(h.alice, c.method, c.path, c.body)
		if code != c.want {
			t.Errorf("%s: got %d want %d (%v)", name, code, c.want, body)
			continue
		}
		raw, _ := json.Marshal(body)
		for _, leak := range []string{"pq:", "pgx", "SQLSTATE", "goroutine", ".go:", "select ", "panic"} {
			if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(leak)) {
				t.Errorf("%s: response leaks internals (%q): %s", name, leak, raw)
			}
		}
	}
	// Errors carry a request id for support.
	_, body, _ := h.do(h.alice, "GET", base+"/proposals?state=hacked", nil)
	if e, _ := body["error"].(map[string]any); e == nil || e["requestId"] == "" {
		t.Errorf("error lacks requestId: %v", body)
	}
}

func TestDailyIngestQuotaStopsRunawayUsage(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Quota")

	// Same wiring as the harness but with a 3,000-byte daily allowance.
	router, _ := ai.NewRouter([]ai.Provider{model{}}, map[ai.Tier][]ai.Route{ai.TierMid: {{Provider: "fake", Model: "m", AllowCustomerData: true}}}, nil)
	workers := river.NewWorkers()
	river.AddWorker(workers, &intake.ExtractWorker{Pool: h.db.Backend, Completer: router})
	jc, _ := jobs.NewClient(h.db.Backend, workers, nil)
	srv := &Server{Version: "t", Auth: stubVerifier{}, Pool: h.db.Backend, Workspaces: &workspaces.Service{Pool: h.db.Backend},
		Intake: &intake.Service{Pool: h.db.Backend, Jobs: jc, DailyBytes: 3000}, Review: &review.Service{Pool: h.db.Backend}, Directory: &directory.Service{Pool: h.db.Backend}}
	var err error
	if h.h, err = NewHandler(srv); err != nil {
		t.Fatal(err)
	}

	paste := func(text string) int {
		code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/sources/paste", map[string]any{"text": text})
		return code
	}
	if code := paste(strings.Repeat("a ", 1000) + uuid.NewString()); code != 202 {
		t.Fatalf("first paste: %d", code)
	}
	if code := paste(strings.Repeat("b ", 1000) + uuid.NewString()); code != 429 {
		t.Fatalf("second paste must hit the daily limit, got %d", code)
	}
	// Another workspace has its own allowance.
	other := h.workspace(h.alice, "Quota 2")
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+other+"/sources/paste", map[string]any{"text": strings.Repeat("c ", 1000) + uuid.NewString()}); code != 202 {
		t.Fatalf("other workspace blocked: %d", code)
	}
}

func TestCORSAndSecurityHeadersApplyToTheRealAPI(t *testing.T) {
	h := newHarness(t)
	req := httptest.NewRequest("OPTIONS", "/v1/workspaces", nil)
	req.Header.Set("Origin", "https://app.example")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, req)
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != "https://app.example" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}
	req = httptest.NewRequest("OPTIONS", "/v1/workspaces", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec = httptest.NewRecorder()
	h.h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("evil origin allowed")
	}
}

// recordingMail stands in for the email provider and de-duplicates on the idempotency key.
type recordingMail struct {
	mu   sync.Mutex
	sent map[string]email.Message
}

func (m *recordingMail) Send(_ context.Context, msg email.Message) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sent == nil {
		m.sent = map[string]email.Message{}
	}
	m.sent[msg.IdempotencyKey] = msg
	return "p-" + msg.IdempotencyKey, nil
}

func (m *recordingMail) all() []email.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []email.Message
	for _, v := range m.sent {
		out = append(out, v)
	}
	return out
}

// stubTranscriber returns a fixed transcript for any recording.
type stubTranscriber struct{ calls int }

func (*stubTranscriber) Name() string    { return "stub" }
func (*stubTranscriber) MaxBytes() int64 { return 25 << 20 }
func (p *stubTranscriber) Transcribe(_ context.Context, _, _ string, r io.Reader) (transcribe.Result, error) {
	p.calls++
	_, _ = io.Copy(io.Discard, r)
	return transcribe.Result{DurationMS: 30_000, Model: "stub", Segments: []transcribe.Segment{
		{StartMS: 0, EndMS: 6000, Speaker: "Priya", Text: "We really need SSO for our team."},
		{StartMS: 6000, EndMS: 30_000, Speaker: "Sam", Text: "Noted, thanks."},
	}}, nil
}

const testWebhookSecret = "whsec_dGVzdC13ZWJob29rLXNlY3JldC1vZi1sZW5ndGg="

// setLimits changes the throttling for the rest of a test.
func (hn *harness) setLimits(l Limits) { hn.srv.Limits = l }

func (hn *harness) clearCounters() {
	hn.t.Helper()
	if _, err := hn.db.Super.Exec(context.Background(), `DELETE FROM rate_limit`); err != nil {
		hn.t.Fatal(err)
	}
}

// safeBuffer collects the server's log output so tests can read it.
type safeBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *safeBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *safeBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}
