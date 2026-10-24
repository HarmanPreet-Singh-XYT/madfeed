package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"product/api/internal/billing"
)

type oaEnv struct {
	h  *harness
	ws string
}

func newOAEnv(t *testing.T) *oaEnv {
	h := newHarness(t)
	e := &oaEnv{h: h, ws: h.workspace(h.alice, "Assistants Co")}
	h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": peopleCSV})
	h.requestFrom(h.alice, e.ws, "dana@acme.com")
	return e
}

func pkce() (verifier, challenge string) {
	b := make([]byte, 32)
	rand.Read(b)
	verifier = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

func (e *oaEnv) rawJSON(method, path string, body any) (int, map[string]any, http.Header) {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Header()
}

func (e *oaEnv) register(redirects ...string) string {
	e.h.t.Helper()
	code, b, _ := e.rawJSON("POST", "/oauth/register", map[string]any{"client_name": "Claude (test)", "redirect_uris": redirects, "token_endpoint_auth_method": "none"})
	if code != 201 {
		e.h.t.Fatalf("register: %d %v", code, b)
	}
	return b["client_id"].(string)
}

func (e *oaEnv) token(form url.Values) (int, map[string]any) {
	req := httptest.NewRequest("POST", "/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	if rec.Header().Get("Cache-Control") != "no-store" {
		e.h.t.Errorf("token answer may be cached: %q", rec.Header().Get("Cache-Control"))
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// approve is what the approval page does for the person who clicks Approve.
func (e *oaEnv) approve(who, client, redirect, challenge string, scopes []string, extra map[string]any) (int, string) {
	body := map[string]any{"clientId": client, "workspaceId": e.ws, "redirectUri": redirect, "codeChallenge": challenge, "codeChallengeMethod": "S256", "scopes": scopes, "state": "st-123", "approve": true}
	for k, v := range extra {
		body[k] = v
	}
	code, b, _ := e.h.do(who, "POST", "/v1/oauth/authorize", body)
	if code != 200 {
		return code, fmt.Sprint(b)
	}
	return code, b["redirectUrl"].(string)
}

func codeOf(t *testing.T, redirect string) string {
	u, err := url.Parse(redirect)
	if err != nil || u.Query().Get("code") == "" || u.Query().Get("state") != "st-123" {
		t.Fatalf("redirect %q", redirect)
	}
	return u.Query().Get("code")
}

const cb = "http://127.0.0.1:53682/callback"

// connect runs the whole flow and returns the tokens.
func (e *oaEnv) connect(scopes []string) (client string, tokens map[string]any) {
	e.h.t.Helper()
	client = e.register(cb)
	ver, chal := pkce()
	code, redirect := e.approve(e.h.alice, client, cb, chal, scopes, nil)
	if code != 200 {
		e.h.t.Fatalf("approve: %d %s", code, redirect)
	}
	c, tok := e.token(url.Values{"grant_type": {"authorization_code"}, "code": {codeOf(e.h.t, redirect)}, "redirect_uri": {cb}, "client_id": {client}, "code_verifier": {ver}})
	if c != 200 {
		e.h.t.Fatalf("token: %d %v", c, tok)
	}
	return client, tok
}

func TestAssistantsFindOutHowToSignIn(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	for _, p := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		rq := httptest.NewRequest("GET", p, nil)
		rc := httptest.NewRecorder()
		h.h.ServeHTTP(rc, rq)
		var m map[string]any
		json.Unmarshal(rc.Body.Bytes(), &m)
		if rc.Code != 200 || m["resource"] != "https://api.example/mcp" || fmt.Sprint(m["authorization_servers"]) != "[https://api.example]" {
			t.Errorf("%s: %d %v", p, rc.Code, m)
		}
	}
	rq := httptest.NewRequest("GET", "/.well-known/oauth-authorization-server", nil)
	rc := httptest.NewRecorder()
	h.h.ServeHTTP(rc, rq)
	var m map[string]any
	json.Unmarshal(rc.Body.Bytes(), &m)
	if m["token_endpoint"] != "https://api.example/oauth/token" || m["registration_endpoint"] != "https://api.example/oauth/register" || m["authorization_endpoint"] != "https://app.example/oauth/authorize" ||
		fmt.Sprint(m["code_challenge_methods_supported"]) != "[S256]" || fmt.Sprint(m["token_endpoint_auth_methods_supported"]) != "[none]" {
		t.Errorf("server metadata: %v", m)
	}
	// a refused assistant is told where to start
	rq = httptest.NewRequest("POST", "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	rq.Header.Set("Content-Type", "application/json")
	rc = httptest.NewRecorder()
	h.h.ServeHTTP(rc, rq)
	if rc.Code != 401 || rc.Header().Get("WWW-Authenticate") != `Bearer resource_metadata="https://api.example/.well-known/oauth-protected-resource/mcp"` {
		t.Errorf("challenge: %d %q", rc.Code, rc.Header().Get("WWW-Authenticate"))
	}
}

func TestRegistrationOnlyAcceptsSafeReturnAddresses(t *testing.T) {
	e := newOAEnv(t)
	for _, ok := range []string{"https://assistant.example/cb", "http://localhost:3000/cb", "http://127.0.0.1:9/cb", "http://[::1]:8080/cb", "cursor://anysphere.cursor-mcp/oauth/callback", "claude://callback"} {
		if c, b, _ := e.rawJSON("POST", "/oauth/register", map[string]any{"client_name": "x", "redirect_uris": []string{ok}}); c != 201 {
			t.Errorf("%s refused: %d %v", ok, c, b)
		}
	}
	for _, bad := range []string{"", "javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "http://evil.example/cb", "https://u:p@evil.example/cb", "https://a.example/cb#frag", "ftp://a.example/", "not a url", "/relative", "https://a.example/ with space", "vbscript:x", strings.Repeat("https://a.example/", 30)} {
		if c, b, _ := e.rawJSON("POST", "/oauth/register", map[string]any{"client_name": "x", "redirect_uris": []string{bad}}); c != 400 || b["error"] != "invalid_redirect_uri" {
			t.Errorf("%q: %d %v", bad, c, b)
		}
	}
	for name, body := range map[string]map[string]any{
		"none":            {"client_name": "x", "redirect_uris": []string{}},
		"six":             {"client_name": "x", "redirect_uris": []string{"https://a.example/1", "https://a.example/2", "https://a.example/3", "https://a.example/4", "https://a.example/5", "https://a.example/6"}},
		"a secret client": {"client_name": "x", "redirect_uris": []string{"https://a.example/1"}, "token_endpoint_auth_method": "client_secret_basic"},
		"a bad grant":     {"client_name": "x", "redirect_uris": []string{"https://a.example/1"}, "grant_types": []string{"password"}},
	} {
		if c, _, _ := e.rawJSON("POST", "/oauth/register", body); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	// the name is cleaned and bounded, never trusted as markup
	_, b, _ := e.rawJSON("POST", "/oauth/register", map[string]any{"client_name": "  <b>Evil</b>\n\u0000\t" + strings.Repeat("x", 200), "redirect_uris": []string{"https://a.example/cb"}})
	if n := b["client_name"].(string); len([]rune(n)) > 80 || strings.ContainsAny(n, "\n\t\x00") {
		t.Errorf("name: %q", n)
	}
	// and one address cannot register without limit
	e.h.setLimits(Limits{ReadPerMinute: 100000, WritePerMinute: 100000, PublicPerMinute: 100000, RegisterPerHour: 5})
	limited := 0
	for i := 0; i < 30; i++ {
		if c, _, _ := e.rawJSON("POST", "/oauth/register", map[string]any{"client_name": "x", "redirect_uris": []string{"https://a.example/cb"}}); c == 429 {
			limited++
		}
	}
	if limited < 20 {
		t.Error("registration was never limited")
	}
}

func TestAnAdminApprovesAndTheAssistantGetsShortLivedAccess(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	client := e.register(cb)
	if c, b, _ := h.do(h.alice, "GET", "/v1/oauth/clients/"+client, nil); c != 200 || b["name"] != "Claude (test)" {
		t.Errorf("client info: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "GET", "/v1/oauth/clients/"+strings.Repeat("z", 30), nil); c != 404 {
		t.Errorf("unknown client: %d", c)
	}
	if c, _, _ := h.do("", "GET", "/v1/oauth/clients/"+client, nil); c != 401 {
		t.Errorf("client info without signing in: %d", c)
	}
	ver, chal := pkce()
	// who may approve
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, e.ws, bobID)
	if c, _ := e.approve(h.bob, client, cb, chal, []string{"requests"}, nil); c != 403 {
		t.Errorf("a member approved: %d", c)
	}
	if c, _ := e.approve("t:"+uuid.NewString(), client, cb, chal, []string{"requests"}, nil); c != 404 {
		t.Errorf("a stranger approved: %d", c)
	}
	if c, _ := e.approve("", client, cb, chal, []string{"requests"}, nil); c != 401 {
		t.Errorf("anonymous approved: %d", c)
	}
	// what a request must look like
	for name, c := range map[string]struct {
		redirect, chal string
		extra          map[string]any
		scopes         []string
	}{
		"a return address that was not registered":   {"https://evil.example/cb", chal, nil, []string{"requests"}},
		"a different port is only for this computer": {"http://127.0.0.1:53682/other", chal, nil, []string{"requests"}},
		"no proof key":          {cb, "", nil, []string{"requests"}},
		"a short proof key":     {cb, "abc", nil, []string{"requests"}},
		"the plain method":      {cb, chal, map[string]any{"codeChallengeMethod": "plain"}, []string{"requests"}},
		"another resource":      {cb, chal, map[string]any{"resource": "https://evil.example/mcp"}, []string{"requests"}},
		"an unknown permission": {cb, chal, nil, []string{"admin"}},
		"no permission":         {cb, chal, nil, []string{}},
	} {
		if code, msg := e.approve(h.alice, client, c.redirect, c.chal, c.scopes, c.extra); code != 400 {
			t.Errorf("%s: %d %s", name, code, msg)
		}
	}
	// refusing sends the person back with access_denied, and only to a registered address
	code, b, _ := h.do(h.alice, "POST", "/v1/oauth/authorize", map[string]any{"clientId": client, "workspaceId": e.ws, "redirectUri": cb, "codeChallenge": chal, "codeChallengeMethod": "S256", "scopes": []string{"requests"}, "state": "st-123", "approve": false})
	if code != 200 || !strings.Contains(b["redirectUrl"].(string), "error=access_denied") || strings.Contains(b["redirectUrl"].(string), "code=") {
		t.Errorf("deny: %d %v", code, b)
	}
	// a loopback program may listen on whichever port is free
	c2, redirect := e.approve(h.alice, client, "http://127.0.0.1:60001/callback", chal, []string{"requests"}, nil)
	if c2 != 200 || !strings.HasPrefix(redirect, "http://127.0.0.1:60001/callback?") {
		t.Errorf("a free port on this computer: %d %s", c2, redirect)
	}

	// approve, then trade the code
	c3, redirect := e.approve(h.alice, client, cb, chal, []string{"requests", "quotes"}, map[string]any{"resource": "https://api.example/mcp"})
	if c3 != 200 {
		t.Fatalf("approve: %d %s", c3, redirect)
	}
	code1 := codeOf(t, redirect)
	// the code is stored only as a hash
	var raw int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM oauth_code WHERE code_hash = $1`, code1).Scan(&raw)
	if raw != 0 {
		t.Error("the code is stored in readable form")
	}
	exch := func(code, ver, redirect, cl string) (int, map[string]any) {
		return e.token(url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect}, "client_id": {cl}, "code_verifier": {ver}, "resource": {"https://api.example/mcp"}})
	}
	otherVer, _ := pkce()
	otherClient := e.register("http://127.0.0.1:1/cb")
	for name, args := range map[string][4]string{
		"the wrong proof":        {code1, otherVer, cb, client},
		"another return address": {code1, ver, "http://127.0.0.1:53682/other", client},
		"another assistant":      {code1, ver, cb, otherClient},
	} {
		// a code that was tried wrongly is gone: try each against a fresh one
		_, rd := e.approve(h.alice, client, cb, chal, []string{"requests"}, nil)
		c := codeOf(t, rd)
		if st, b := exch(c, args[1], args[2], args[3]); st != 400 || b["error"] != "invalid_grant" {
			t.Errorf("%s: %d %v", name, st, b)
		}
		if st, _ := exch(c, ver, cb, client); st != 400 {
			t.Errorf("%s: the code survived a wrong attempt", name)
		}
	}
	if st, b := e.token(url.Values{"grant_type": {"authorization_code"}, "code": {code1}, "redirect_uri": {cb}, "client_id": {client}, "code_verifier": {"short"}}); st != 400 || b["error"] != "invalid_request" {
		t.Errorf("a malformed verifier: %d %v", st, b)
	}
	st, tok := exch(code1, ver, cb, client)
	if st != 200 || tok["token_type"] != "Bearer" || tok["expires_in"].(float64) != 3600 || tok["scope"] != "requests quotes" {
		t.Fatalf("exchange: %d %v", st, tok)
	}
	access, refresh := tok["access_token"].(string), tok["refresh_token"].(string)
	if !strings.HasPrefix(access, "fk_") || !strings.HasPrefix(refresh, "fr_") {
		t.Fatalf("token shapes: %q %q", access, refresh)
	}
	// the code works once
	if st, _ := exch(code1, ver, cb, client); st != 400 {
		t.Errorf("a code used twice: %d", st)
	}
	// the access token is a key that lasts an hour and does what was approved, nothing more
	var expires time.Time
	h.db.Super.QueryRow(context.Background(), `SELECT expires_at FROM api_key WHERE oauth_grant_id IS NOT NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).Scan(&expires)
	if d := time.Until(expires); d < 55*time.Minute || d > 61*time.Minute {
		t.Errorf("the access token lasts %v", d)
	}
	if c, _, _ := h.do(access, "GET", "/v1/ext/requests", nil); c != 200 {
		t.Errorf("list with the access token: %d", c)
	}
	if c, _, _ := h.do(access, "POST", "/v1/ext/ask", map[string]any{"question": "What do customers say about SSO?"}); c != 403 {
		t.Errorf("ask without the permission: %d", c)
	}
	if c, _, _ := h.do(access, "GET", "/v1/workspaces", nil); c != 401 {
		t.Errorf("the access token worked outside the assistant API: %d", c)
	}
	// it is hidden from the ordinary key list
	_, keys, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/api-keys", nil)
	if len(keys["keys"].([]any)) != 0 {
		t.Errorf("assistant tokens clutter the key list: %v", keys)
	}
	// the admin sees the connected assistant, nobody else does
	_, gs, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/oauth/grants", nil)
	grants := gs["grants"].([]any)
	if len(grants) < 1 || grants[0].(map[string]any)["clientName"] != "Claude (test)" || strings.Contains(fmt.Sprint(gs), refresh) || strings.Contains(fmt.Sprint(gs), access) {
		t.Errorf("grants: %v", gs)
	}
	if c, _, _ := h.do(h.bob, "GET", "/v1/workspaces/"+e.ws+"/oauth/grants", nil); c != 403 {
		t.Errorf("a member listed grants: %d", c)
	}
	// secrets never reach the logs
	for _, s := range []string{access, refresh, code1} {
		if strings.Contains(h.logs.String(), s) {
			t.Error("a token reached the logs")
		}
	}
	// and the refresh token is stored only as a hash
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM oauth_grant WHERE refresh_hash = $1 OR previous_refresh_hash = $1`, refresh).Scan(&raw)
	if raw != 0 {
		t.Error("the refresh token is stored in readable form")
	}
}

func TestRefreshTokensAreReplacedEachTimeAndReuseEndsTheGrant(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	client, tok := e.connect([]string{"requests", "quotes", "ask"})
	a1, r1 := tok["access_token"].(string), tok["refresh_token"].(string)
	refresh := func(client, r string) (int, map[string]any) {
		return e.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {r}, "client_id": {client}})
	}
	// the wrong assistant, a made-up token
	if st, _ := refresh("oc_"+strings.Repeat("x", 30), r1); st != 400 {
		t.Errorf("another assistant's refresh: %d", st)
	}
	if st, _ := refresh(client, "fr_"+strings.Repeat("y", 43)); st != 400 {
		t.Errorf("a made-up refresh token: %d", st)
	}
	if st, _ := e.token(url.Values{"grant_type": {"password"}}); st != 400 {
		t.Errorf("an unsupported grant: %d", st)
	}
	// a normal renewal: new tokens, old access token dead at once
	st, t2 := refresh(client, r1)
	if st != 200 {
		t.Fatalf("refresh: %d %v", st, t2)
	}
	a2, r2 := t2["access_token"].(string), t2["refresh_token"].(string)
	if a2 == a1 || r2 == r1 || t2["scope"] != "requests quotes ask" {
		t.Errorf("tokens were not replaced: %v", t2)
	}
	if c, _, _ := h.do(a1, "GET", "/v1/ext/requests", nil); c != 401 {
		t.Errorf("the replaced access token still works: %d", c)
	}
	if c, _, _ := h.do(a2, "GET", "/v1/ext/requests", nil); c != 200 {
		t.Errorf("the new access token: %d", c)
	}
	// one live access token per grant
	var live int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM api_key WHERE workspace_id=$1 AND oauth_grant_id IS NOT NULL AND revoked_at IS NULL`, e.ws).Scan(&live)
	if live != 1 {
		t.Errorf("%d live access tokens for one assistant", live)
	}
	// the old refresh token being presented again means it was copied: everything ends
	if st, _ := refresh(client, r1); st != 400 {
		t.Errorf("reusing a replaced refresh token: %d", st)
	}
	if c, _, _ := h.do(a2, "GET", "/v1/ext/requests", nil); c != 401 {
		t.Errorf("the grant survived a refresh token being reused: %d", c)
	}
	if st, _ := refresh(client, r2); st != 400 {
		t.Errorf("the newest refresh token worked after the reuse alarm: %d", st)
	}
	if _, gs, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/oauth/grants", nil); len(gs["grants"].([]any)) != 0 {
		t.Errorf("an ended grant is still listed: %v", gs)
	}
}

func TestDisconnectingAndLosingAdminRightsEndAccess(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	client, tok := e.connect([]string{"requests"})
	access, refresh := tok["access_token"].(string), tok["refresh_token"].(string)
	_, gs, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/oauth/grants", nil)
	id := gs["grants"].([]any)[0].(map[string]any)["id"].(string)
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, e.ws, bobID)
	if c, _, _ := h.do(h.bob, "DELETE", "/v1/workspaces/"+e.ws+"/oauth/grants/"+id, nil); c != 403 {
		t.Errorf("a member disconnected: %d", c)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "DELETE", "/v1/workspaces/"+e.ws+"/oauth/grants/"+id, nil); c != 404 {
		t.Errorf("a stranger disconnected: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/oauth/grants/"+id, nil); c != 204 {
		t.Fatalf("disconnect: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/oauth/grants/"+id, nil); c != 404 {
		t.Errorf("disconnecting twice: %d", c)
	}
	if c, _, _ := h.do(access, "GET", "/v1/ext/requests", nil); c != 401 {
		t.Errorf("the access token outlived the disconnect: %d", c)
	}
	if st, _ := e.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {client}}); st != 400 {
		t.Errorf("the refresh token outlived the disconnect: %d", st)
	}
	// access rides on the person who approved: if they stop being an admin, it stops
	client2, tok2 := e.connect([]string{"requests"})
	h.db.Super.Exec(context.Background(), `UPDATE member SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`, e.ws, h.aliceID)
	if st, _ := e.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {tok2["refresh_token"].(string)}, "client_id": {client2}}); st != 400 {
		t.Errorf("a grant kept working after its approver lost admin rights: %d", st)
	}
	h.db.Super.Exec(context.Background(), `UPDATE member SET role='admin' WHERE workspace_id=$1 AND user_id=$2`, e.ws, h.aliceID)
	// an expired code and an expired refresh token
	client3 := e.register(cb)
	ver, chal := pkce()
	_, rd := e.approve(h.alice, client3, cb, chal, []string{"requests"}, nil)
	h.db.Super.Exec(context.Background(), `UPDATE oauth_code SET expires_at = now() - interval '1 second'`)
	if st, _ := e.token(url.Values{"grant_type": {"authorization_code"}, "code": {codeOf(t, rd)}, "redirect_uri": {cb}, "client_id": {client3}, "code_verifier": {ver}}); st != 400 {
		t.Errorf("an expired code: %d", st)
	}
	client4, tok4 := e.connect([]string{"requests"})
	h.db.Super.Exec(context.Background(), `UPDATE oauth_grant SET refresh_expires_at = now() - interval '1 second'`)
	if st, _ := e.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {tok4["refresh_token"].(string)}, "client_id": {client4}}); st != 400 {
		t.Errorf("an expired refresh token: %d", st)
	}
}

func TestOneWorkspacesAssistantCannotSeeAnother(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	other := h.workspace(h.bob, "Someone else")
	h.do(h.bob, "POST", "/v1/workspaces/"+other+"/people/import", map[string]any{"csv": peopleCSV})
	reqB := h.requestFrom(h.bob, other, "dana@acme.com")
	_, tok := e.connect([]string{"requests", "quotes"})
	access := tok["access_token"].(string)
	if c, _, _ := h.do(access, "GET", "/v1/ext/requests/"+reqB, nil); c != 404 {
		t.Errorf("another workspace's request: %d", c)
	}
	// Bob cannot approve an assistant into Alice's workspace even with a valid assistant id
	client := e.register(cb)
	_, chal := pkce()
	if c, _ := e.approve(h.bob, client, cb, chal, []string{"requests"}, nil); c != 404 {
		t.Errorf("approving into someone else's workspace: %d", c)
	}
}

func TestAnAssistantConnectsEndToEndOverMCP(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	_, tok := e.connect([]string{"requests", "quotes"})
	srv := httptest.NewServer(h.h)
	defer srv.Close()
	hc := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		r = r.Clone(r.Context())
		r.Header.Set("Authorization", "Bearer "+tok["access_token"].(string))
		return http.DefaultTransport.RoundTrip(r)
	})}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "remote", Version: "1"}, nil).Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: srv.URL + "/mcp", HTTPClient: hc}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	out, why := callTool(t, cs, "search_requests", map[string]any{})
	if out == nil || len(out["requests"].([]any)) != 1 {
		t.Fatalf("search: %q %v", why, out)
	}
	if _, msg := callTool(t, cs, "ask_feedback", map[string]any{"question": "What do customers say about SSO?"}); !strings.Contains(msg, "not allowed") {
		t.Errorf("a permission that was not approved: %q", msg)
	}
}

func TestSigningInAssistantsRespectThePlan(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	b := &billing.Service{Pool: h.db.Backend, Plans: billing.DefaultPlans()}
	_ = b
	h.srv.OAuth.Allow = func(ctx context.Context, ws uuid.UUID) error {
		return billing.ErrNotEntitled{Feature: string(billing.FeatureAPIKeys), Plan: "Free"}
	}
	client := e.register(cb)
	_, chal := pkce()
	if c, _ := e.approve(h.alice, client, cb, chal, []string{"requests"}, nil); c != 402 {
		t.Errorf("approving on a plan without API access: %d", c)
	}
}
