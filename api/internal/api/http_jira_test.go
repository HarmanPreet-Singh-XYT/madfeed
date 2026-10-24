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

type jiraEnv struct {
	h      *harness
	f      *devfakes.Jira
	ws     string
	req    string
	secret string
}

func newJiraEnv(t *testing.T, connect bool) *jiraEnv {
	h := newHarness(t)
	f := devfakes.NewJira()
	srv := httptest.NewServer(f.Handler())
	t.Cleanup(srv.Close)
	h.srv.Integrations.Jira = integrations.JiraConfig{APIBase: srv.URL}
	h.srv.Integrations.GitHub = integrations.GitHubConfig{APIURL: "https://api.example"}
	e := &jiraEnv{h: h, f: f, ws: h.workspace(h.alice, "Jira Co")}
	h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": peopleCSV})
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com", "raj@acme.com")
	if connect {
		e.connect(map[string]any{"closeStatusId": h.statusID(h.alice, e.ws, "Shipped"), "reopenStatusId": h.statusID(h.alice, e.ws, "In progress")})
	}
	return e
}

func (e *jiraEnv) base() string { return "/v1/workspaces/" + e.ws + "/integrations/jira" }

func (e *jiraEnv) connect(extra map[string]any) map[string]any {
	e.h.t.Helper()
	body := map[string]any{"site": "https://Acme.atlassian.net/jira", "email": e.f.Email, "token": e.f.Token, "project": "proj"}
	for k, v := range extra {
		body[k] = v
	}
	code, b, _ := e.h.do(e.h.alice, "POST", e.base()+"/connect", body)
	if code != 200 {
		e.h.t.Fatalf("connect: %d %v", code, b)
	}
	e.secret = b["webhookSecret"].(string)
	return b
}

func (e *jiraEnv) issueURL() string {
	return "/v1/workspaces/" + e.ws + "/requests/" + e.req + "/issue"
}

func (e *jiraEnv) statusName() string {
	var n string
	e.h.db.Super.QueryRow(context.Background(), `SELECT s.name FROM request r JOIN status s ON s.id = r.status_id WHERE r.id=$1`, e.req).Scan(&n)
	return n
}

func (e *jiraEnv) deliver(secret, id string, payload map[string]any) (int, string) {
	raw, _ := json.Marshal(payload)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(raw)
	req := httptest.NewRequest("POST", "/v1/integrations/jira/"+e.ws+"/events", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Atlassian-Webhook-Identifier", id)
	req.Header.Set("X-Hub-Signature", "sha256="+hex.EncodeToString(m.Sum(nil)))
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func jiraIssueEvent(event, key, category string, at time.Time) map[string]any {
	return map[string]any{"webhookEvent": event, "timestamp": at.UnixMilli(), "issue": map[string]any{
		"key": key, "fields": map[string]any{"status": map[string]any{"statusCategory": map[string]any{"key": category}}},
	}}
}

func TestConnectingAJiraProjectIsCheckedAndTheTokenIsSealed(t *testing.T) {
	e := newJiraEnv(t, false)
	h := e.h
	ok := map[string]any{"site": "acme", "email": e.f.Email, "token": e.f.Token, "project": "PROJ"}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for a, b := range ok {
			m[a] = b
		}
		m[k] = v
		return m
	}
	// no host of anyone's choosing, no odd keys or types
	for name, body := range map[string]map[string]any{
		"a foreign host": with("site", "evil.example.com"), "a path trick": with("site", "acme.atlassian.net.evil.com"), "an address with credentials": with("site", "user:pw@acme"),
		"a site with spaces": with("site", "ac me"), "a lowercase junk project": with("project", "p r"), "a numeric project": with("project", "1ABC"),
		"an odd issue type": with("issueType", "Task\nBug"), "no email": with("email", "nobody"), "a short token": with("token", "short"),
	} {
		if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", body); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", with("token", "wrong-token-value-00")); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("a wrong token: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", with("project", "OPS")); c != 400 {
		t.Errorf("a project that does not exist: %d", c)
	}
	if c, _, _ := h.do(h.bob, "POST", e.base()+"/connect", ok); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	if c, _, _ := h.do(h.alice, "GET", e.base()+"/details", nil); c != 404 {
		t.Errorf("details before connecting: %d", c)
	}
	b := e.connect(nil)
	if b["webhookUrl"] != "https://api.example/v1/integrations/jira/"+e.ws+"/events" || len(e.secret) != 64 {
		t.Errorf("setup %v", b)
	}
	_, d, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if d["site"] != "acme" || d["project"] != "PROJ" || d["issueType"] != "Task" || d["state"] != "connected" {
		t.Errorf("details %v", d)
	}
	_, list, _ := h.rawJSON(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", "", nil)
	if strings.Contains(list, e.f.Token) || strings.Contains(list, e.secret) {
		t.Errorf("a credential is in the listing: %s", list)
	}
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='jira'`, e.ws).Scan(&sealed)
	if len(sealed) == 0 || bytes.Contains(sealed, []byte(e.f.Token)) || bytes.Contains(sealed, []byte(e.secret)) {
		t.Error("credentials are not sealed")
	}
	// one tracker at a time
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/integrations/github/connect", map[string]any{"token": "github_pat_example_token", "repo": "a/b"}); c != 400 || !strings.Contains(fmt.Sprint(b), "Jira is already connected") {
		t.Errorf("github next to jira: %d %v", c, b)
	}
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/integrations/linear/connect", map[string]any{"token": "lin_api_whatever_value", "teamKey": "ENG"}); c != 400 || !strings.Contains(fmt.Sprint(b), "Jira is already connected") {
		t.Errorf("linear next to jira: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/integrations/jira", nil); c != 204 {
		t.Errorf("disconnect: %d", c)
	}
}

func TestAnIssueIsOpenedInJiraWithoutCustomerWords(t *testing.T) {
	e := newJiraEnv(t, true)
	h := e.h
	c, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	if c != 201 || link["tracker"] != "jira" || link["repo"] != "PROJ" || link["number"] != float64(71) || link["url"] != "https://acme.atlassian.net/browse/PROJ-71" || link["state"] != "open" {
		t.Fatalf("create: %d %v", c, link)
	}
	if c, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); c != 400 {
		t.Errorf("a second issue: %d", c)
	}
	e.f.Mu.Lock()
	sent := strings.Join(e.f.Bodies, "\n")
	e.f.Mu.Unlock()
	if !strings.Contains(sent, `"key":"PROJ"`) || !strings.Contains(sent, `"name":"Task"`) || strings.Contains(sent, "SSO for our team") || strings.Contains(sent, "dana@acme.com") {
		t.Errorf("what Jira was sent: %s", sent)
	}
	// Jira stops accepting the token
	e.f.Set(func() { e.f.Token += "-rotated" })
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com")
	if c, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); c != 409 {
		t.Errorf("revoked token: %d", c)
	}
	if _, d, _ := h.do(h.alice, "GET", e.base()+"/details", nil); d["state"] != "needs_reconnect" {
		t.Errorf("details %v", d)
	}
}

func TestJiraChangesMoveTheRequestUnlessSomeoneChangedItHere(t *testing.T) {
	e := newJiraEnv(t, true)
	h := e.h
	_, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	key := fmt.Sprintf("PROJ-%d", int(link["number"].(float64)))
	now := time.Now()

	if c, _ := e.deliver("someone-elses-secret", "j0", jiraIssueEvent("jira:issue_updated", key, "done", now)); c != 401 {
		t.Errorf("wrong secret: %d", c)
	}
	if e.statusName() == "Shipped" {
		t.Fatal("something unverified moved the request")
	}
	if c, b := e.deliver(e.secret, "j1", jiraIssueEvent("jira:issue_updated", key, "done", now)); c != 200 {
		t.Fatalf("done: %d %s", c, b)
	}
	if e.statusName() != "Shipped" {
		t.Errorf("status %s", e.statusName())
	}
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "closed" {
		t.Errorf("link %v", l)
	}
	// a retry (same identifier, much later), an edit with no change, and another project's issue do nothing
	e.deliver(e.secret, "j1", jiraIssueEvent("jira:issue_updated", key, "done", now))
	e.deliver(e.secret, "j2", jiraIssueEvent("jira:issue_updated", key, "done", now.Add(time.Second)))
	e.deliver(e.secret, "j3", jiraIssueEvent("jira:issue_updated", strings.Replace(key, "PROJ", "OPS", 1), "indeterminate", now.Add(2*time.Second)))
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "closed" {
		t.Errorf("link %v", l)
	}
	// reopening follows
	if c, b := e.deliver(e.secret, "j4", jiraIssueEvent("jira:issue_updated", key, "indeterminate", now.Add(3*time.Second))); c != 200 {
		t.Fatalf("reopened: %d %s", c, b)
	}
	if e.statusName() != "In progress" {
		t.Errorf("status after reopening %s", e.statusName())
	}
	// an edit while open does not drag the request around
	h.do(h.alice, "PUT", "/v1/workspaces/"+e.ws+"/requests/"+e.req+"/status", map[string]any{"statusId": h.statusID(h.alice, e.ws, "Planned")})
	e.deliver(e.secret, "j5", jiraIssueEvent("jira:issue_updated", key, "new", now.Add(4*time.Second)))
	if e.statusName() != "Planned" {
		t.Errorf("an edit moved the request to %s", e.statusName())
	}
	// done while someone moved the request here: held back
	e.deliver(e.secret, "j6", jiraIssueEvent("jira:issue_updated", key, "done", now.Add(5*time.Second)))
	_, l, _ := h.do(h.alice, "GET", e.issueURL(), nil)
	if e.statusName() != "Planned" || !strings.Contains(fmt.Sprint(l["conflict"]), "Jira") {
		t.Errorf("conflict: %s %v", e.statusName(), l)
	}
	// deleted in Jira
	e.deliver(e.secret, "j7", jiraIssueEvent("jira:issue_deleted", key, "done", now.Add(6*time.Second)))
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "deleted" {
		t.Errorf("link %v", l)
	}
	// unknown workspace looks like a bad signature
	req := httptest.NewRequest("POST", "/v1/integrations/jira/00000000-0000-0000-0000-000000000009/events", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Errorf("unknown workspace: %d", rec.Code)
	}
}
