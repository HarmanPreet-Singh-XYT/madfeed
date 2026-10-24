package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"product/api/internal/devfakes"
	"product/api/internal/integrations"
)

type linEnv struct {
	h      *harness
	f      *devfakes.Linear
	srv    *httptest.Server
	ws     string
	req    string
	secret string
}

func newLinEnv(t *testing.T, connect bool) *linEnv {
	h := newHarness(t)
	f := devfakes.NewLinear()
	srv := httptest.NewServer(f.Handler())
	t.Cleanup(srv.Close)
	h.srv.Integrations.Linear = integrations.LinearConfig{APIBase: srv.URL}
	h.srv.Integrations.GitHub = integrations.GitHubConfig{APIURL: "https://api.example"}
	e := &linEnv{h: h, f: f, srv: srv, ws: h.workspace(h.alice, "Linear Co"), secret: "lin_wh_secret_for_tests"}
	h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": peopleCSV})
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com", "raj@acme.com")
	if connect {
		e.connect(map[string]any{"closeStatusId": h.statusID(h.alice, e.ws, "Shipped"), "reopenStatusId": h.statusID(h.alice, e.ws, "In progress")})
		if c, b, _ := h.do(h.alice, "PUT", e.base()+"/secret", map[string]any{"secret": e.secret}); c != 204 {
			t.Fatalf("secret: %d %v", c, b)
		}
	}
	return e
}

func (e *linEnv) base() string { return "/v1/workspaces/" + e.ws + "/integrations/linear" }

func (e *linEnv) connect(extra map[string]any) map[string]any {
	e.h.t.Helper()
	body := map[string]any{"token": e.f.Key, "teamKey": "eng"}
	for k, v := range extra {
		body[k] = v
	}
	code, b, _ := e.h.do(e.h.alice, "POST", e.base()+"/connect", body)
	if code != 200 {
		e.h.t.Fatalf("connect: %d %v", code, b)
	}
	return b
}

func (e *linEnv) issueURL() string { return "/v1/workspaces/" + e.ws + "/requests/" + e.req + "/issue" }

func (e *linEnv) statusName() string {
	var n string
	e.h.db.Super.QueryRow(context.Background(), `SELECT s.name FROM request r JOIN status s ON s.id = r.status_id WHERE r.id=$1`, e.req).Scan(&n)
	return n
}

// deliver sends a signed notification like Linear's.
func (e *linEnv) deliver(secret, delivery string, at time.Time, payload map[string]any) (int, string) {
	if _, ok := payload["webhookTimestamp"]; !ok {
		payload["webhookTimestamp"] = at.UnixMilli()
	}
	raw, _ := json.Marshal(payload)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(raw)
	req := httptest.NewRequest("POST", "/v1/integrations/linear/"+e.ws+"/events", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Linear-Delivery", delivery)
	req.Header.Set("Linear-Signature", hex.EncodeToString(m.Sum(nil)))
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func linIssue(team string, number int, action, stateType string, at time.Time) map[string]any {
	return map[string]any{"action": action, "type": "Issue", "data": map[string]any{
		"number": number, "team": map[string]any{"key": team}, "state": map[string]any{"type": stateType}, "updatedAt": at.UTC().Format(time.RFC3339),
	}}
}

func TestConnectingATeamIsCheckedAndItsKeyIsSealed(t *testing.T) {
	e := newLinEnv(t, false)
	h := e.h
	for _, key := range []string{"", "ENG TEAM", "ENG-1", "waytoolongteamkey", "e/g"} {
		if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.Key, "teamKey": key}); c != 400 {
			t.Errorf("team key %q: %d", key, c)
		}
	}
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": "wrong-key-value-00", "teamKey": "ENG"}); c != 400 && c != 409 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("a wrong key: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.Key, "teamKey": "OPS"}); c != 400 {
		t.Errorf("a team that does not exist: %d", c)
	}
	if c, _, _ := h.do("t:"+"00000000-0000-0000-0000-000000000001", "POST", e.base()+"/connect", map[string]any{"token": e.f.Key, "teamKey": "ENG"}); c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	if c, _, _ := h.do(h.alice, "GET", e.base()+"/details", nil); c != 404 {
		t.Errorf("details before connecting: %d", c)
	}

	b := e.connect(nil)
	if b["webhookUrl"] != "https://api.example/v1/integrations/linear/"+e.ws+"/events" {
		t.Errorf("webhook url %v", b)
	}
	_, d, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if d["teamKey"] != "ENG" || d["teamName"] != "Engineering" || d["hasSecret"] != false || d["state"] != "connected" {
		t.Errorf("details %v", d)
	}
	_, list, raw := h.rawJSON(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", "", nil)
	if strings.Contains(list, e.f.Key) {
		t.Errorf("the key is in the integrations list: %s %v", list, raw)
	}
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='linear'`, e.ws).Scan(&sealed)
	if len(sealed) == 0 || bytes.Contains(sealed, []byte(e.f.Key)) {
		t.Error("the key is not sealed")
	}
	// one tracker at a time, in both directions
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/integrations/github/connect", map[string]any{"token": "github_pat_example_token", "repo": "a/b"}); c != 400 || !strings.Contains(fmt.Sprint(b), "already connected") {
		t.Errorf("github next to linear: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/integrations/linear", nil); c != 204 {
		t.Errorf("disconnect: %d", c)
	}
	if c, _, _ := h.do(h.alice, "GET", e.base()+"/details", nil); c != 404 {
		t.Errorf("details after disconnecting: %d", c)
	}
}

func TestAnIssueIsOpenedInLinearWithoutCustomerWords(t *testing.T) {
	e := newLinEnv(t, true)
	h := e.h
	c, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	if c != 201 || link["tracker"] != "linear" || link["repo"] != "ENG" || link["number"] != float64(41) || link["state"] != "open" {
		t.Fatalf("create: %d %v", c, link)
	}
	if c, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); c != 400 {
		t.Errorf("a second issue for the same request: %d", c)
	}
	e.f.Mu.Lock()
	sent := strings.Join(e.f.Bodies, "\n")
	e.f.Mu.Unlock()
	if !strings.Contains(sent, "11111111-2222") || strings.Contains(sent, "SSO for our team") || strings.Contains(sent, "dana@acme.com") {
		t.Errorf("what Linear was sent: %s", sent)
	}
	if c, _, _ := h.do(h.bob, "POST", e.issueURL(), nil); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	// Linear stops accepting the key: the connection asks to be set up again and nothing is lost
	e.f.Set(func() { e.f.Key += "-rotated" })
	e2 := e
	e2.req = h.requestFrom(h.alice, e.ws, "dana@acme.com")
	if c, b, _ := h.do(h.alice, "POST", e2.issueURL(), nil); c != 409 {
		t.Errorf("revoked key: %d %v", c, b)
	}
	_, d, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if d["state"] != "needs_reconnect" {
		t.Errorf("details %v", d)
	}
}

func TestLinearChangesMoveTheRequestUnlessSomeoneChangedItHere(t *testing.T) {
	e := newLinEnv(t, true)
	h := e.h
	_, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	n := int(link["number"].(float64))
	now := time.Now()

	// unsigned, wrongly signed, stale and replayed notifications do nothing
	if c, _ := e.deliver("someone-elses-secret", "d0", now, linIssue("ENG", n, "update", "completed", now)); c != 401 {
		t.Errorf("wrong secret: %d", c)
	}
	if c, _ := e.deliver(e.secret, "d0", now, map[string]any{"webhookTimestamp": now.Add(-10 * time.Minute).UnixMilli(), "action": "update", "type": "Issue", "data": linIssue("ENG", n, "update", "completed", now)["data"]}); c != 401 {
		t.Errorf("a stale notification: %d", c)
	}
	if e.statusName() == "Shipped" {
		t.Fatal("something unverified moved the request")
	}
	// completing the issue moves the request to the chosen status
	if c, b := e.deliver(e.secret, "d1", now, linIssue("ENG", n, "update", "completed", now)); c != 200 {
		t.Fatalf("completed: %d %s", c, b)
	}
	if e.statusName() != "Shipped" {
		t.Errorf("status %s", e.statusName())
	}
	_, l, _ := h.do(h.alice, "GET", e.issueURL(), nil)
	if l["state"] != "closed" {
		t.Errorf("link %v", l)
	}
	// the same delivery again, and an edit that changes nothing about open/closed, do nothing
	e.deliver(e.secret, "d1", now, linIssue("ENG", n, "update", "completed", now))
	later := now.Add(time.Second)
	e.deliver(e.secret, "d2", later, linIssue("ENG", n, "update", "completed", later))
	// another team's issue with the same number is not ours
	e.deliver(e.secret, "d3", later, linIssue("OPS", n, "update", "started", later))
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "closed" {
		t.Errorf("link %v", l)
	}
	// reopening follows too
	re := now.Add(2 * time.Second)
	if c, b := e.deliver(e.secret, "d4", re, linIssue("ENG", n, "update", "started", re)); c != 200 {
		t.Fatalf("reopened: %d %s", c, b)
	}
	if e.statusName() != "In progress" {
		t.Errorf("status after reopening %s", e.statusName())
	}
	// an edit while open (title, assignee) must not drag the request around
	h.do(h.alice, "PUT", "/v1/workspaces/"+e.ws+"/requests/"+e.req+"/status", map[string]any{"statusId": h.statusID(h.alice, e.ws, "Planned")})
	ed := now.Add(3 * time.Second)
	e.deliver(e.secret, "d5", ed, linIssue("ENG", n, "update", "started", ed))
	if e.statusName() != "Planned" {
		t.Errorf("an edit moved the request to %s", e.statusName())
	}
	// completed while someone moved the request here: held back as a conflict, nothing overwritten
	co := now.Add(4 * time.Second)
	e.deliver(e.secret, "d6", co, linIssue("ENG", n, "update", "completed", co))
	_, l, _ = h.do(h.alice, "GET", e.issueURL(), nil)
	if e.statusName() != "Planned" || !strings.Contains(fmt.Sprint(l["conflict"]), "Linear") {
		t.Errorf("conflict: %s %v", e.statusName(), l)
	}
	// deleted in Linear: the link ends with a plain explanation
	rm := now.Add(5 * time.Second)
	e.deliver(e.secret, "d7", rm, linIssue("ENG", n, "remove", "started", rm))
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "deleted" {
		t.Errorf("link %v", l)
	}
}

func TestLinearNotificationsAreRefusedUntilTheSecretIsPasted(t *testing.T) {
	e := newLinEnv(t, false)
	e.connect(map[string]any{"closeStatusId": e.h.statusID(e.h.alice, e.ws, "Shipped")})
	_, link, _ := e.h.do(e.h.alice, "POST", e.issueURL(), nil)
	now := time.Now()
	if c, _ := e.deliver("", "x1", now, linIssue("ENG", int(link["number"].(float64)), "update", "completed", now)); c != 401 {
		t.Errorf("before the secret is known: %d", c)
	}
	// other roles cannot set it; short ones are refused
	if c, _, _ := e.h.do(e.h.bob, "PUT", e.base()+"/secret", map[string]any{"secret": "long-enough-secret"}); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	if c, _, _ := e.h.do(e.h.alice, "PUT", e.base()+"/secret", map[string]any{"secret": "short"}); c != 400 {
		t.Errorf("a short secret: %d", c)
	}
	// unknown workspace looks like any other bad signature
	req := httptest.NewRequest("POST", "/v1/integrations/linear/00000000-0000-0000-0000-000000000009/events", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Errorf("unknown workspace: %d", rec.Code)
	}
}
