package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/intake"
	"product/api/internal/mcpserver"
)

func (hn *harness) apiKey(token, ws, name string) (id, secret string) {
	hn.t.Helper()
	code, b, _ := hn.do(token, "POST", "/v1/workspaces/"+ws+"/api-keys", map[string]any{"name": name})
	if code != 201 {
		hn.t.Fatalf("create key: %d %v", code, b)
	}
	return b["key"].(map[string]any)["id"].(string), b["secret"].(string)
}

func TestAPIKeysAreManagedByAdminsAndOnlyTheirHashIsStored(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Keys Co")
	base := "/v1/workspaces/" + ws + "/api-keys"
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID)

	for name, c := range map[string]struct{ token, method string }{
		"a member lists": {h.bob, "GET"}, "a member creates": {h.bob, "POST"}, "a stranger lists": {"t:" + uuid.NewString(), "GET"},
	} {
		want := 403
		if strings.Contains(name, "stranger") {
			want = 404
		}
		var body any
		if c.method == "POST" {
			body = map[string]any{"name": "x"}
		}
		if code, _, _ := h.do(c.token, c.method, base, body); code != want {
			t.Errorf("%s: %d, want %d", name, code, want)
		}
	}
	for _, bad := range []map[string]any{{"name": ""}, {"name": strings.Repeat("n", 81)}, {"name": "ok", "role": "admin"}, {}} {
		if code, _, _ := h.do(h.alice, "POST", base, bad); code != 400 {
			t.Errorf("bad body %v: %d", bad, code)
		}
	}
	id, secret := h.apiKey(h.alice, ws, "Claude Desktop")
	if !strings.HasPrefix(secret, "fk_") || len(secret) != 46 {
		t.Fatalf("secret shape: %q", secret)
	}
	// listed without the secret; the database holds only a hash
	_, list, _ := h.do(h.alice, "GET", base, nil)
	if strings.Contains(fmt.Sprint(list), secret) || list["keys"].([]any)[0].(map[string]any)["prefix"] != secret[:10] {
		t.Errorf("list: %v", list)
	}
	var found int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM api_key WHERE prefix=$1 AND key_hash <> $1 AND position($2 in key_hash) = 0`, secret[:10], secret[3:]).Scan(&found)
	if found != 1 {
		t.Error("key row not as expected")
	}
	var leaked int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM api_key WHERE to_jsonb(api_key)::text LIKE '%' || $1 || '%'`, secret[3:]).Scan(&leaked)
	if leaked != 0 {
		t.Error("the key is stored in readable form")
	}
	if strings.Contains(h.logs.String(), secret) {
		t.Error("the key reached the logs")
	}
	// at most ten active keys; revoking frees a place
	for i := 0; i < 9; i++ {
		h.apiKey(h.alice, ws, fmt.Sprintf("key %d", i))
	}
	if code, _, _ := h.do(h.alice, "POST", base, map[string]any{"name": "eleventh"}); code != 400 {
		t.Errorf("eleventh key: %d", code)
	}
	if code, _, _ := h.do(h.bob, "DELETE", base+"/"+id, nil); code != 403 {
		t.Errorf("a member revoked: %d", code)
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/"+id, nil); code != 204 {
		t.Errorf("revoke: %d", code)
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/"+id, nil); code != 404 {
		t.Errorf("revoking twice: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base, map[string]any{"name": "after revoke"}); code != 201 {
		t.Errorf("after revoking: %d", code)
	}
}

func TestKeysAndSignInTokensAreNotInterchangeable(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Doors")
	_, key := h.apiKey(h.alice, ws, "k")
	// a signed-in person's token does not open the key API
	for _, tok := range []string{h.alice, "", "fk_nonsense", "fk_" + strings.Repeat("A", 43), "Bearer"} {
		if code, _, _ := h.do(tok, "GET", "/v1/ext/requests", nil); code != 401 {
			t.Errorf("token %q on the key API: %d", tok, code)
		}
	}
	// a key does not open anything else
	for _, p := range []string{"/v1/workspaces", "/v1/workspaces/" + ws + "/requests", "/v1/workspaces/" + ws + "/api-keys", "/v1/votes"} {
		if code, _, _ := h.do(key, "GET", p, nil); code != 401 {
			t.Errorf("a key on %s: %d", p, code)
		}
	}
	if code, _, _ := h.do(key, "POST", "/v1/workspaces/"+ws+"/api-keys", map[string]any{"name": "mine"}); code != 401 {
		t.Errorf("a key made a key: %d", code)
	}
	// a key can read, and can write nothing: there is no write route to try
	if code, _, _ := h.do(key, "GET", "/v1/ext/requests", nil); code != 200 {
		t.Errorf("a good key: %d", code)
	}
	for _, m := range []string{"POST", "PUT", "DELETE", "PATCH"} {
		if code, _, _ := h.do(key, m, "/v1/ext/requests", map[string]any{}); code != 404 && code != 405 && code != 400 {
			t.Errorf("%s /v1/ext/requests: %d", m, code)
		}
	}
}

func TestReadOnlyAPIReturnsOnlyThisWorkspacesCitedQuotes(t *testing.T) {
	h := newHarness(t)
	a := h.workspace(h.alice, "Alpha")
	b := h.workspace(h.bob, "Beta")
	for _, ws := range []string{a} {
		h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/people/import", map[string]any{"csv": peopleCSV})
	}
	reqA := h.requestFrom(h.alice, a, "dana@acme.com", "raj@acme.com")
	h.do(h.bob, "POST", "/v1/workspaces/"+b+"/people/import", map[string]any{"csv": peopleCSV})
	reqB := h.requestFrom(h.bob, b, "dana@acme.com")
	_, keyA := h.apiKey(h.alice, a, "alpha")
	_, keyB := h.apiKey(h.bob, b, "beta")

	// list
	_, list, _ := h.do(keyA, "GET", "/v1/ext/requests", nil)
	rs := list["requests"].([]any)
	if len(rs) != 1 || rs[0].(map[string]any)["id"] != reqA {
		t.Fatalf("list: %v", list)
	}
	if s := fmt.Sprint(list); strings.Contains(s, "acme.com") || strings.Contains(s, "dana") {
		t.Errorf("the list names people: %v", list)
	}
	if _, l2, _ := h.do(keyA, "GET", "/v1/ext/requests?q=zzzznomatch", nil); len(l2["requests"].([]any)) != 0 {
		t.Errorf("search: %v", l2)
	}
	if _, l3, _ := h.do(keyA, "GET", "/v1/ext/requests?q=We", nil); len(l3["requests"].([]any)) != 1 {
		t.Errorf("search by words in the title: %v", l3)
	}
	// get: every quote is word for word what is stored at its span
	code, d, _ := h.do(keyA, "GET", "/v1/ext/requests/"+reqA, nil)
	ev := d["evidence"].([]any)
	if code != 200 || len(ev) != 2 {
		t.Fatalf("get: %d %v", code, d)
	}
	for _, e := range ev {
		m := e.(map[string]any)
		_, src, _ := h.do(h.alice, "GET", "/v1/workspaces/"+a+"/sources/"+m["sourceItemId"].(string), nil)
		text := src["text"].(string)
		s, en := int(m["spanStart"].(float64)), int(m["spanEnd"].(float64))
		if text[s:en] != m["quote"] {
			t.Errorf("a quote is not the source text at its span: %q", m["quote"])
		}
	}
	if s := fmt.Sprint(d); strings.Contains(s, "acme.com") || strings.Contains(s, "Dana") || strings.Contains(s, "Raj") {
		t.Errorf("the request names people: %v", d)
	}
	// the other workspace's request is simply not found
	if code, _, _ := h.do(keyA, "GET", "/v1/ext/requests/"+reqB, nil); code != 404 {
		t.Errorf("another workspace's request: %d", code)
	}
	if code, _, _ := h.do(keyA, "GET", "/v1/ext/requests/"+uuid.NewString(), nil); code != 404 {
		t.Errorf("a made-up request: %d", code)
	}
	if code, _, _ := h.do(keyA, "GET", "/v1/ext/requests/not-a-uuid", nil); code != 400 {
		t.Errorf("a malformed id: %d", code)
	}
	if _, lb, _ := h.do(keyB, "GET", "/v1/ext/requests", nil); len(lb["requests"].([]any)) != 1 || lb["requests"].([]any)[0].(map[string]any)["id"] != reqB {
		t.Errorf("beta's list: %v", lb)
	}
	// asking: answered with citations from this workspace only, or an honest "no evidence"
	code, ans, _ := h.do(keyA, "POST", "/v1/ext/ask", map[string]any{"question": "What do customers say about single sign-on?"})
	if code != 200 {
		t.Fatalf("ask: %d %v", code, ans)
	}
	if ans["outcome"] == "answered" {
		cits := ans["citations"].([]any)
		if len(cits) == 0 {
			t.Error("an answer without citations")
		}
		for _, c := range cits {
			sid := c.(map[string]any)["sourceItemId"].(string)
			if c2, _, _ := h.do(h.alice, "GET", "/v1/workspaces/"+a+"/sources/"+sid, nil); c2 != 200 {
				t.Errorf("a citation to a source outside the workspace: %d", c2)
			}
		}
	}
	if code, _, _ := h.do(keyA, "POST", "/v1/ext/ask", map[string]any{"question": "x"}); code != 400 {
		t.Errorf("a too-short question: %d", code)
	}
	if code, _, _ := h.do(keyA, "POST", "/v1/ext/ask", map[string]any{"question": strings.Repeat("q", 501)}); code != 400 {
		t.Errorf("a too-long question: %d", code)
	}
	// a revoked key stops at once
	idA, k2 := h.apiKey(h.alice, a, "second")
	if c, _, _ := h.do(k2, "GET", "/v1/ext/requests", nil); c != 200 {
		t.Fatal(c)
	}
	h.do(h.alice, "DELETE", "/v1/workspaces/"+a+"/api-keys/"+idA, nil)
	if c, _, _ := h.do(k2, "GET", "/v1/ext/requests", nil); c != 401 {
		t.Errorf("a revoked key: %d", c)
	}
	// use is noted
	var used int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM api_key WHERE workspace_id=$1 AND last_used_at IS NOT NULL`, a).Scan(&used)
	if used < 1 {
		t.Error("last_used_at was never set")
	}
	// the key is not in the logs
	if strings.Contains(h.logs.String(), keyA) {
		t.Error("a key reached the logs")
	}
}

func TestEachKeyIsRateLimited(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Busy")
	_, key := h.apiKey(h.alice, ws, "busy")
	_, other := h.apiKey(h.alice, ws, "calm")
	limited := 0
	for i := 0; i < ExtPerMinute+10; i++ {
		if c, _, _ := h.do(key, "GET", "/v1/ext/requests", nil); c == 429 {
			limited++
		}
	}
	if limited < 5 {
		t.Errorf("only %d refused after %d requests", limited, ExtPerMinute+10)
	}
	if c, _, _ := h.do(other, "GET", "/v1/ext/requests", nil); c != 200 {
		t.Errorf("another key was slowed down by the first: %d", c)
	}
}

// ---- through the MCP server ----

func mcpSession(t *testing.T, h *harness, key string) *mcp.ClientSession {
	t.Helper()
	srv := httptest.NewServer(h.h)
	t.Cleanup(srv.Close)
	ctx := context.Background()
	st, ct := mcp.NewInMemoryTransports()
	s := mcpserver.NewServer(&mcpserver.Client{BaseURL: srv.URL, Key: key}, "test")
	ss, err := s.Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ss.Close() })
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

func callTool(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) (map[string]any, string) {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			text += tc.Text
		}
	}
	if res.IsError {
		return nil, text
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("tool %s answered %q", name, text)
	}
	return out, ""
}

func TestTheMCPServerGivesAssistantsTheSameReadOnlyView(t *testing.T) {
	h := newHarness(t)
	a := h.workspace(h.alice, "MCP Alpha")
	b := h.workspace(h.bob, "MCP Beta")
	h.do(h.alice, "POST", "/v1/workspaces/"+a+"/people/import", map[string]any{"csv": peopleCSV})
	h.do(h.bob, "POST", "/v1/workspaces/"+b+"/people/import", map[string]any{"csv": peopleCSV})
	reqA := h.requestFrom(h.alice, a, "dana@acme.com", "raj@acme.com")
	reqB := h.requestFrom(h.bob, b, "dana@acme.com")
	_, keyA := h.apiKey(h.alice, a, "mcp")
	cs := mcpSession(t, h, keyA)

	tools, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, tl := range tools.Tools {
		names[tl.Name] = true
		if tl.Name == "submit_feedback" || tl.Name == "set_request_status" || tl.Name == "tag_request" { // the writes: each needs its own permission, and none destroys anything
			if tl.Annotations == nil || tl.Annotations.ReadOnlyHint || tl.Annotations.DestructiveHint == nil || *tl.Annotations.DestructiveHint {
				t.Errorf("%s is mis-described: %+v", tl.Name, tl.Annotations)
			}
		} else if tl.Annotations == nil || !tl.Annotations.ReadOnlyHint {
			t.Errorf("tool %s is not marked read-only", tl.Name)
		}
	}
	if len(names) != 10 || !names["set_request_status"] || !names["tag_request"] || !names["search_quotes"] || !names["list_statuses"] || !names["list_tags"] || !names["list_release_notes"] || !names["search_requests"] || !names["get_request"] || !names["ask_feedback"] || !names["submit_feedback"] {
		t.Fatalf("tools: %v", names)
	}

	// search: the same requests the API returns
	out, why := callTool(t, cs, "search_requests", map[string]any{"limit": 10})
	if out == nil {
		t.Fatalf("search_requests failed: %q", why)
	}
	rs := out["requests"].([]any)
	if len(rs) != 1 || rs[0].(map[string]any)["id"] != reqA || out["note"] == "" {
		t.Fatalf("search: %v", out)
	}
	// get: the same quotes the API returns, each word for word
	_, apiDetail, _ := h.do(keyA, "GET", "/v1/ext/requests/"+reqA, nil)
	got, _ := callTool(t, cs, "get_request", map[string]any{"id": reqA})
	gev, aev := got["evidence"].([]any), apiDetail["evidence"].([]any)
	if len(gev) != len(aev) || len(gev) != 2 {
		t.Fatalf("evidence: %v", got)
	}
	for i := range gev {
		g, a2 := gev[i].(map[string]any), aev[i].(map[string]any)
		if g["quote"] != a2["quote"] || g["sourceItemId"] != a2["sourceItemId"] || g["spanStart"] != a2["spanStart"] || g["spanEnd"] != a2["spanEnd"] {
			t.Errorf("quote %d differs between the API and the MCP server", i)
		}
	}
	if s := fmt.Sprint(got); strings.Contains(s, "acme.com") || strings.Contains(s, "Dana") {
		t.Errorf("a tool result names a person: %v", got)
	}
	// the other workspace's request is not found, with no hint that it exists
	if _, msg := callTool(t, cs, "get_request", map[string]any{"id": reqB}); msg != "not found" {
		t.Errorf("another workspace's request: %q", msg)
	}
	if _, msg := callTool(t, cs, "get_request", map[string]any{"id": "../../etc/passwd"}); !strings.Contains(msg, "request id") {
		t.Errorf("a malformed id: %q", msg)
	}
	if _, msg := callTool(t, cs, "search_requests", map[string]any{"limit": 500}); !strings.Contains(msg, "between 1 and 50") {
		t.Errorf("a huge limit: %q", msg)
	}
	// ask: an answer cites quotes, or says there is no evidence; never an answer without one of the two
	ans, msg := callTool(t, cs, "ask_feedback", map[string]any{"question": "What do customers say about single sign-on?"})
	if msg != "" {
		t.Fatalf("ask: %q", msg)
	}
	switch ans["outcome"] {
	case "answered":
		if len(ans["citations"].([]any)) == 0 {
			t.Error("an answer with no citations")
		}
	case "no_evidence":
		if ans["reason"] == "" {
			t.Error("no evidence without a reason")
		}
	default:
		t.Errorf("outcome %v", ans["outcome"])
	}
	if _, msg := callTool(t, cs, "ask_feedback", map[string]any{"question": "hi"}); !strings.Contains(msg, "3 to 500") {
		t.Errorf("a short question: %q", msg)
	}

	// a revoked key, and a wrong key, are told plainly and show nothing
	id, k2 := h.apiKey(h.alice, a, "temp")
	cs2 := mcpSession(t, h, k2)
	if _, msg := callTool(t, cs2, "search_requests", map[string]any{}); msg != "" {
		t.Fatalf("a good key: %q", msg)
	}
	h.do(h.alice, "DELETE", "/v1/workspaces/"+a+"/api-keys/"+id, nil)
	if _, msg := callTool(t, cs2, "search_requests", map[string]any{}); !strings.Contains(msg, "not accepted") {
		t.Errorf("a revoked key: %q", msg)
	}
	bad := mcpSession(t, h, "fk_"+strings.Repeat("Z", 43))
	if _, msg := callTool(t, bad, "get_request", map[string]any{"id": reqA}); !strings.Contains(msg, "not accepted") || strings.Contains(msg, "Single") {
		t.Errorf("a wrong key: %q", msg)
	}
}

func newMCPWith(baseURL, key string, showFlagged bool) *mcp.Server {
	return mcpserver.NewServer(&mcpserver.Client{BaseURL: baseURL, Key: key, ShowFlagged: showFlagged}, "test")
}

func workExtract(h *harness, ws string, id uuid.UUID) error {
	return h.worker.Work(context.Background(), &river.Job[intake.ExtractArgs]{
		JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
		Args:   intake.ExtractArgs{WorkspaceID: uuid.MustParse(ws), SourceItemID: id, UserID: uuid.Nil},
	})
}
