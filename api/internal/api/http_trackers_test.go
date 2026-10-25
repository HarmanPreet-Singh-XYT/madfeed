package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"product/api/internal/devfakes"
	"product/api/internal/integrations"
)

type trEnv struct {
	h   *harness
	ws  string
	req string
}

func newTrEnv(t *testing.T) *trEnv {
	h := newHarness(t)
	h.srv.Integrations.GitHub = integrations.GitHubConfig{APIURL: "https://api.example"}
	e := &trEnv{h: h, ws: h.workspace(h.alice, "Trackers Co")}
	h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": peopleCSV})
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com", "raj@acme.com")
	return e
}

func (e *trEnv) base(kind string) string {
	return "/v1/workspaces/" + e.ws + "/integrations/trackers/" + kind
}
func (e *trEnv) issueURL() string { return "/v1/workspaces/" + e.ws + "/requests/" + e.req + "/issue" }
func (e *trEnv) status() string {
	var n string
	e.h.db.Super.QueryRow(context.Background(), `SELECT s.name FROM request r JOIN status s ON s.id = r.status_id WHERE r.id=$1`, e.req).Scan(&n)
	return n
}
func (e *trEnv) mapping() map[string]any {
	return map[string]any{"closeStatusId": e.h.statusID(e.h.alice, e.ws, "Shipped"), "reopenStatusId": e.h.statusID(e.h.alice, e.ws, "In progress")}
}
func (e *trEnv) connect(kind string, fields map[string]any) (int, map[string]any) {
	body := map[string]any{"fields": fields}
	for k, v := range e.mapping() {
		body[k] = v
	}
	c, b, _ := e.h.do(e.h.alice, "POST", e.base(kind)+"/connect", body)
	return c, b
}
func (e *trEnv) post(kind string, body []byte, header map[string]string) (int, http.Header) {
	req := httptest.NewRequest("POST", "/v1/integrations/"+kind+"/"+e.ws+"/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	return rec.Code, rec.Header()
}
func sign(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}
func js(v any) []byte { b, _ := json.Marshal(v); return b }

func serve(t *testing.T, h http.Handler) string {
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return s.URL
}

func TestTheCatalogListsEveryTrackerOnceAndOnlyToAdmins(t *testing.T) {
	e := newTrEnv(t)
	c, b, _ := e.h.do(e.h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations/trackers", nil)
	if c != 200 {
		t.Fatalf("%d %v", c, b)
	}
	kinds := map[string]int{}
	for _, tr := range b["trackers"].([]any) {
		m := tr.(map[string]any)
		kinds[m["kind"].(string)]++
		if len(m["fields"].([]any)) < 2 || m["intro"] == "" {
			t.Errorf("%v", m)
		}
	}
	if len(kinds) != 3 || kinds["clickup"] != 1 || kinds["asana"] != 1 || kinds["azuredevops"] != 1 {
		t.Errorf("trackers %v", kinds)
	}
	if c, _, _ := e.h.do(e.h.bob, "GET", "/v1/workspaces/"+e.ws+"/integrations/trackers", nil); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	// switched off, a tracker disappears from the list and its routes answer not found
	m, _ := integrations.ParseEnabled("slack,github,clickup")
	e.h.srv.Integrations.Enabled = m
	_, b, _ = e.h.do(e.h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations/trackers", nil)
	if l := b["trackers"].([]any); len(l) != 1 || l[0].(map[string]any)["kind"] != "clickup" {
		t.Errorf("only ClickUp should be offered: %v", b)
	}
	if c, _ := e.connect("asana", map[string]any{"projectId": "120000000001", "token": "xxxxxxxxxxxxxx"}); c != 404 {
		t.Errorf("connecting a tracker that is off: %d", c)
	}
	if c, _ := e.post("asana", []byte("{}"), nil); c != 404 && c != 401 {
		t.Errorf("a notification for a tracker that is off: %d", c)
	}
}

func TestClickUp(t *testing.T) {
	e := newTrEnv(t)
	h := e.h
	f := devfakes.NewClickUp()
	h.srv.Integrations.ClickUp = integrations.ClickUpConfig{APIBase: serve(t, f.Handler())}
	good := map[string]any{"listId": f.ListID, "token": f.Token}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for a, b := range good {
			m[a] = b
		}
		m[k] = v
		return m
	}
	for name, body := range map[string]map[string]any{"a list id with letters": with("listId", "abc"), "a path trick": with("listId", "1/../2"), "a short token": with("token", "short"), "no token": with("token", ""), "a bad workspace id": with("teamId", "x y")} {
		if c, _ := e.connect("clickup", body); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	if c, b := e.connect("clickup", with("token", "pk_wrong_token_00000")); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("a wrong token: %d %v", c, b)
	}
	if c, _ := e.connect("clickup", with("listId", "999999")); c != 400 {
		t.Errorf("a list that does not exist: %d", c)
	}
	if c, _, _ := h.do(h.bob, "POST", e.base("clickup")+"/connect", map[string]any{"fields": good}); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}

	c, b := e.connect("clickup", good)
	if c != 200 || b["webhookUrl"] != "https://api.example/v1/integrations/clickup/"+e.ws+"/events" {
		t.Fatalf("connect: %d %v", c, b)
	}
	if f.Endpoint != b["webhookUrl"] || f.Secret == "" {
		t.Fatalf("the webhook was not made at ClickUp: %q", f.Endpoint)
	}
	secret := f.Secret
	_, d, _ := h.do(h.alice, "GET", e.base("clickup")+"/details", nil)
	if d["summary"] != "Product backlog" || d["state"] != "connected" {
		t.Errorf("details %v", d)
	}
	_, list, _ := h.rawJSON(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", "", nil)
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='clickup'`, e.ws).Scan(&sealed)
	if strings.Contains(list, f.Token) || strings.Contains(list, secret) || bytes.Contains(sealed, []byte(f.Token)) || bytes.Contains(sealed, []byte(secret)) {
		t.Error("a credential is exposed")
	}
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/integrations/linear/connect", map[string]any{"token": "lin_api_whatever_value", "teamKey": "ENG"}); c != 400 || !strings.Contains(fmt.Sprint(b), "ClickUp is already connected") {
		t.Errorf("another tracker next to it: %d %v", c, b)
	}

	// an issue is opened with title and counts only
	c, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	if c != 201 || link["tracker"] != "clickup" || link["repo"] != f.ListID || link["ref"] != "86c101" || link["label"] != "86c101" || link["url"] != "https://app.clickup.com/t/86c101" {
		t.Fatalf("create: %d %v", c, link)
	}
	if c, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); c != 400 {
		t.Errorf("a second task: %d", c)
	}
	f.Mu.Lock()
	sent := strings.Join(f.Bodies, "\n")
	f.Mu.Unlock()
	if strings.Contains(sent, "SSO for our team") || strings.Contains(sent, "dana@acme.com") {
		t.Errorf("customer words were sent: %s", sent)
	}

	// notifications
	event := func(kind, hid string, status string, at time.Time) []byte {
		return js(map[string]any{"event": kind, "task_id": "86c101", "webhook_id": f.WebhookID, "history_items": []any{map[string]any{"id": hid, "date": fmt.Sprint(at.UnixMilli()), "field": "status", "after": map[string]any{"status": "x", "type": status}}}})
	}
	now := time.Now()
	body := event("taskStatusUpdated", "h1", "closed", now)
	if c, _ := e.post("clickup", body, map[string]string{"X-Signature": sign("not-the-secret", body)}); c != 401 {
		t.Errorf("a wrong signature: %d", c)
	}
	if c, _ := e.post("clickup", body, nil); c != 401 {
		t.Errorf("no signature: %d", c)
	}
	if e.status() == "Shipped" {
		t.Fatal("an unverified notification moved the request")
	}
	if c, _ := e.post("clickup", body, map[string]string{"X-Signature": sign(secret, body)}); c != 200 {
		t.Fatalf("closed: %d", c)
	}
	if e.status() != "Shipped" {
		t.Errorf("status %s", e.statusName())
	}
	e.post("clickup", body, map[string]string{"X-Signature": sign(secret, body)}) // the same again
	other := js(map[string]any{"event": "taskStatusUpdated", "task_id": "86zzz999", "history_items": []any{}})
	e.post("clickup", other, map[string]string{"X-Signature": sign(secret, other)}) // a task we did not make
	re := event("taskStatusUpdated", "h2", "open", now.Add(time.Second))
	e.post("clickup", re, map[string]string{"X-Signature": sign(secret, re)})
	if e.status() != "In progress" {
		t.Errorf("after reopening %s", e.status())
	}
	del := event("taskDeleted", "h3", "open", now.Add(2*time.Second))
	e.post("clickup", del, map[string]string{"X-Signature": sign(secret, del)})
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "deleted" {
		t.Errorf("link %v", l)
	}

	// disconnecting also removes the webhook made at ClickUp
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/integrations/clickup", nil); c != 204 {
		t.Errorf("disconnect: %d", c)
	}
	f.Mu.Lock()
	left := f.Secret
	f.Mu.Unlock()
	if left != "" {
		t.Error("the webhook at ClickUp was left behind")
	}
}

func (e *trEnv) statusName() string { return e.status() }

func TestAsana(t *testing.T) {
	e := newTrEnv(t)
	h := e.h
	f := devfakes.NewAsana()
	h.srv.Integrations.Asana = integrations.AsanaConfig{APIBase: serve(t, f.Handler())}
	// Asana's handshake: it calls the notification address with a secret and expects it echoed
	var handshakes int
	f.OnHandshake = func(target, secret string) error {
		handshakes++
		path := strings.TrimPrefix(target, "https://api.example")
		req := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		req.Header.Set("X-Hook-Secret", secret)
		rec := httptest.NewRecorder()
		h.h.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("X-Hook-Secret") != secret {
			return fmt.Errorf("handshake answered %d", rec.Code)
		}
		return nil
	}
	good := map[string]any{"projectId": f.ProjectID, "token": f.Token}
	if c, _ := e.connect("asana", map[string]any{"projectId": "abc", "token": f.Token}); c != 400 {
		t.Errorf("a project id with letters: %d", c)
	}
	if c, b := e.connect("asana", map[string]any{"projectId": f.ProjectID, "token": "wrong-token-00000000"}); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("a wrong token: %d %v", c, b)
	}
	if c, _ := e.connect("asana", map[string]any{"projectId": "999999999999", "token": f.Token}); c != 400 {
		t.Errorf("a project that does not exist: %d", c)
	}
	// a failed handshake connects nothing
	f.OnHandshake = func(string, string) error { return fmt.Errorf("unreachable") }
	if c, _ := e.connect("asana", good); c != 400 {
		t.Errorf("handshake failure: %d", c)
	}
	if c, _, _ := h.do(h.alice, "GET", e.base("asana")+"/details", nil); c != 404 {
		t.Errorf("a half-made connection was kept: %d", c)
	}
	f.OnHandshake = func(target, secret string) error {
		handshakes++
		path := strings.TrimPrefix(target, "https://api.example")
		req := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		req.Header.Set("X-Hook-Secret", secret)
		rec := httptest.NewRecorder()
		h.h.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("X-Hook-Secret") != secret {
			return fmt.Errorf("handshake answered %d", rec.Code)
		}
		return nil
	}
	if c, b := e.connect("asana", good); c != 200 {
		t.Fatalf("connect: %d %v", c, b)
	}
	secret := f.Secret
	// the secret cannot be introduced a second time, or replaced
	if c, _ := e.post("asana", []byte("{}"), map[string]string{"X-Hook-Secret": "attacker-secret"}); c != 401 {
		t.Errorf("a second introduction: %d", c)
	}
	_, d, _ := h.do(h.alice, "GET", e.base("asana")+"/details", nil)
	if d["summary"] != "Roadmap" || d["state"] != "connected" {
		t.Errorf("details %v", d)
	}

	c, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	if c != 201 || link["tracker"] != "asana" || link["repo"] != f.ProjectID || link["ref"] == "" || link["label"] != link["ref"] {
		t.Fatalf("create: %d %v", c, link)
	}
	gid := link["ref"].(string)
	f.Mu.Lock()
	sent := strings.Join(f.Bodies, "\n")
	f.Mu.Unlock()
	if strings.Contains(sent, "SSO for our team") || strings.Contains(sent, "dana@acme.com") {
		t.Errorf("customer words were sent: %s", sent)
	}

	completed := js(map[string]any{"events": []any{map[string]any{"action": "changed", "created_at": time.Now().UTC().Format(time.RFC3339), "resource": map[string]any{"gid": gid, "resource_type": "task"}, "change": map[string]any{"field": "completed"}}}})
	if c, _ := e.post("asana", completed, map[string]string{"X-Hook-Signature": sign("not-the-secret", completed)}); c != 401 {
		t.Errorf("a wrong signature: %d", c)
	}
	f.Set(func() { f.Completed[gid] = true })
	if c, _ := e.post("asana", completed, map[string]string{"X-Hook-Signature": sign(secret, completed)}); c != 200 {
		t.Fatalf("completed: %d", c)
	}
	if e.status() != "Shipped" {
		t.Errorf("status %s", e.status())
	}
	f.Set(func() { f.Completed[gid] = false })
	reopened := js(map[string]any{"events": []any{map[string]any{"action": "changed", "created_at": time.Now().Add(time.Second).UTC().Format(time.RFC3339), "resource": map[string]any{"gid": gid, "resource_type": "task"}, "change": map[string]any{"field": "completed"}}}})
	e.post("asana", reopened, map[string]string{"X-Hook-Signature": sign(secret, reopened)})
	if e.status() != "In progress" {
		t.Errorf("after reopening %s", e.status())
	}
	// other fields and other resources are ignored; a heartbeat with no events is fine
	ignored := js(map[string]any{"events": []any{
		map[string]any{"action": "changed", "resource": map[string]any{"gid": gid, "resource_type": "task"}, "change": map[string]any{"field": "name"}},
		map[string]any{"action": "changed", "resource": map[string]any{"gid": "1234567", "resource_type": "story"}},
	}})
	if c, _ := e.post("asana", ignored, map[string]string{"X-Hook-Signature": sign(secret, ignored)}); c != 200 {
		t.Errorf("ignored: %d", c)
	}
	if c, _ := e.post("asana", []byte("{}"), map[string]string{"X-Hook-Signature": sign(secret, []byte("{}"))}); c != 200 {
		t.Errorf("heartbeat: %d", c)
	}
	deleted := js(map[string]any{"events": []any{map[string]any{"action": "deleted", "created_at": time.Now().Add(2 * time.Second).UTC().Format(time.RFC3339), "resource": map[string]any{"gid": gid, "resource_type": "task"}}}})
	e.post("asana", deleted, map[string]string{"X-Hook-Signature": sign(secret, deleted)})
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "deleted" {
		t.Errorf("link %v", l)
	}
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/integrations/asana", nil); c != 204 {
		t.Errorf("disconnect: %d", c)
	}
	f.Mu.Lock()
	left := f.Secret
	f.Mu.Unlock()
	if left != "" {
		t.Error("the webhook at Asana was left behind")
	}
	_ = handshakes
}

func TestAzureDevOps(t *testing.T) {
	e := newTrEnv(t)
	h := e.h
	f := devfakes.NewAzureDevOps()
	h.srv.Integrations.Azure = integrations.AzureConfig{APIBase: serve(t, f.Handler())}
	good := map[string]any{"organization": f.Org, "project": f.Project, "token": f.Token}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for a, b := range good {
			m[a] = b
		}
		m[k] = v
		return m
	}
	for name, body := range map[string]map[string]any{
		"a foreign organization": with("organization", "evil.example.com/x"), "an odd project": with("project", "a/../b"), "an odd type": with("workItemType", "Task\nBug"),
		"no token": with("token", ""), "too many states": with("doneStates", "a,b,c,d,e,f,g,h,i,j,k"),
	} {
		if c, _ := e.connect("azuredevops", body); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	if c, b := e.connect("azuredevops", with("token", "wrong-token-0000000")); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("a wrong token (the service answers 203): %d %v", c, b)
	}
	if c, _ := e.connect("azuredevops", with("project", "Nope")); c != 400 {
		t.Errorf("a project that does not exist: %d", c)
	}
	c, b := e.connect("azuredevops", with("doneStates", "Done, Closed"))
	if c != 200 {
		t.Fatalf("connect: %d %v", c, b)
	}
	var secret string
	for _, s := range b["show"].([]any) {
		m := s.(map[string]any)
		if strings.HasPrefix(fmt.Sprint(m["label"]), "Basic authentication password") {
			secret = m["value"].(string)
			if m["secret"] != true {
				t.Error("the password is not marked as shown once")
			}
		}
	}
	if len(secret) != 64 || b["webhookUrl"] != "https://api.example/v1/integrations/azuredevops/"+e.ws+"/events" || b["note"] == "" {
		t.Fatalf("setup %v", b)
	}
	if _, d, _ := h.do(h.alice, "GET", e.base("azuredevops")+"/details", nil); fmt.Sprint(d) == "" || strings.Contains(fmt.Sprint(d), secret) {
		t.Errorf("details leak the password: %v", d)
	}

	c, link, _ := h.do(h.alice, "POST", e.issueURL(), nil)
	if c != 201 || link["tracker"] != "azuredevops" || link["repo"] != f.Project || link["number"] != float64(301) || link["label"] != "Product #301" {
		t.Fatalf("create: %d %v", c, link)
	}
	f.Mu.Lock()
	sent := strings.Join(f.Bodies, "\n")
	f.Mu.Unlock()
	if !strings.Contains(sent, "application/json-patch+json") || !strings.Contains(sent, "|$Task") || !strings.Contains(sent, "/fields/System.Title") || strings.Contains(sent, "SSO for our team") || strings.Contains(sent, "dana@acme.com") {
		t.Errorf("what was sent: %s", sent)
	}

	basic := func(pass string) map[string]string {
		r := &http.Request{Header: http.Header{}}
		r.SetBasicAuth("feedback", pass)
		return map[string]string{"Authorization": r.Header.Get("Authorization")}
	}
	updated := func(id, state string, at time.Time) []byte {
		fields := map[string]any{}
		if state != "" {
			fields["System.State"] = map[string]any{"oldValue": "x", "newValue": state}
		}
		return js(map[string]any{"id": id, "eventType": "workitem.updated", "createdDate": at.UTC().Format(time.RFC3339), "resource": map[string]any{"workItemId": 301, "fields": fields}})
	}
	now := time.Now()
	body := updated("e1", "Done", now)
	if c, _ := e.post("azuredevops", body, basic("wrong")); c != 401 {
		t.Errorf("a wrong password: %d", c)
	}
	if c, _ := e.post("azuredevops", body, nil); c != 401 {
		t.Errorf("no password: %d", c)
	}
	if e.status() == "Shipped" {
		t.Fatal("something unverified moved the request")
	}
	if c, _ := e.post("azuredevops", body, basic(secret)); c != 200 || e.status() != "Shipped" {
		t.Fatalf("done: %d %s", c, e.status())
	}
	e.post("azuredevops", body, basic(secret)) // the same again
	nostate := updated("e2", "", now.Add(time.Second))
	e.post("azuredevops", nostate, basic(secret)) // an edit of something else
	other := js(map[string]any{"id": "e3", "eventType": "workitem.updated", "createdDate": now.Add(time.Second).UTC().Format(time.RFC3339), "resource": map[string]any{"workItemId": 9999, "fields": map[string]any{"System.State": map[string]any{"newValue": "Active"}}}})
	e.post("azuredevops", other, basic(secret)) // a work item we did not make
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "closed" {
		t.Errorf("link %v", l)
	}
	re := updated("e4", "Active", now.Add(2*time.Second))
	e.post("azuredevops", re, basic(secret))
	if e.status() != "In progress" {
		t.Errorf("after reopening %s", e.status())
	}
	del := js(map[string]any{"id": "e5", "eventType": "workitem.deleted", "createdDate": now.Add(3 * time.Second).UTC().Format(time.RFC3339), "resource": map[string]any{"id": 301}})
	e.post("azuredevops", del, basic(secret))
	if _, l, _ := h.do(h.alice, "GET", e.issueURL(), nil); l["state"] != "deleted" {
		t.Errorf("link %v", l)
	}
	// the token stops working
	f.Set(func() { f.Token += "-rotated" })
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com")
	if c, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); c != 409 {
		t.Errorf("a revoked token: %d", c)
	}
}
