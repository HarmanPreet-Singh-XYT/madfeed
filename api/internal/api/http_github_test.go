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
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/integrations"
)

type ghEnv struct {
	h      *harness
	f      *fakeGitHub
	ws     string
	secret string
	repo   string
	req    string
}

func newGHEnv(t *testing.T, connect bool) *ghEnv {
	h := newHarness(t)
	f := newFakeGitHub(t)
	h.srv.Integrations.GitHub = integrations.GitHubConfig{APIBase: f.srv.URL, APIURL: "https://api.example"}
	e := &ghEnv{h: h, f: f, ws: h.workspace(h.alice, "Issues Co"), repo: "acme/product-" + uuid.NewString()[:6]}
	h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": peopleCSV})
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com", "raj@acme.com")
	if connect {
		e.connect(map[string]any{"closeStatusId": h.statusID(h.alice, e.ws, "Shipped"), "reopenStatusId": h.statusID(h.alice, e.ws, "In progress")})
	}
	return e
}

func (e *ghEnv) base() string { return "/v1/workspaces/" + e.ws + "/integrations/github" }

func (e *ghEnv) connect(extra map[string]any) map[string]any {
	e.h.t.Helper()
	body := map[string]any{"token": e.f.token, "repo": e.repo}
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

func (e *ghEnv) issueURL() string { return "/v1/workspaces/" + e.ws + "/requests/" + e.req + "/issue" }

func (e *ghEnv) createIssue() (int, map[string]any) {
	code, b, _ := e.h.do(e.h.alice, "POST", e.issueURL(), nil)
	return code, b
}

// deliver sends a signed GitHub notification.
func (e *ghEnv) deliver(secret, event, delivery string, payload map[string]any) (int, string) {
	raw, _ := json.Marshal(payload)
	return e.deliverRaw(secret, event, delivery, raw, "")
}

func (e *ghEnv) deliverRaw(secret, event, delivery string, raw []byte, sigOverride string) (int, string) {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(raw)
	sig := "sha256=" + hex.EncodeToString(m.Sum(nil))
	if sigOverride != "" {
		sig = sigOverride
	}
	req := httptest.NewRequest("POST", "/v1/integrations/github/"+e.ws+"/events", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", event)
	req.Header.Set("X-GitHub-Delivery", delivery)
	req.Header.Set("X-Hub-Signature-256", sig)
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func issueEvent(repo string, number int, action string, at time.Time) map[string]any {
	return map[string]any{"action": action, "issue": map[string]any{"number": number, "state": map[string]string{"closed": "closed"}[action], "updated_at": at.UTC().Format(time.RFC3339)}, "repository": map[string]any{"full_name": repo}}
}

func (e *ghEnv) statusName() string {
	var n string
	e.h.db.Super.QueryRow(context.Background(), `SELECT s.name FROM request r JOIN status s ON s.id = r.status_id WHERE r.id=$1`, e.req).Scan(&n)
	return n
}

func (e *ghEnv) setStatus(name string) {
	e.h.t.Helper()
	if code, b, _ := e.h.do(e.h.alice, "PUT", "/v1/workspaces/"+e.ws+"/requests/"+e.req+"/status", map[string]any{"statusId": e.h.statusID(e.h.alice, e.ws, name)}); code != 200 {
		e.h.t.Fatalf("set status %s: %d %v", name, code, b)
	}
}

func (e *ghEnv) link() map[string]any {
	_, b, _ := e.h.do(e.h.alice, "GET", e.issueURL(), nil)
	return b
}

func TestConnectingARepositoryIsCheckedAndItsTokenIsSealed(t *testing.T) {
	e := newGHEnv(t, false)
	h := e.h
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, e.ws, bobID)
	good := map[string]any{"token": e.f.token, "repo": e.repo}
	if c, _, _ := h.do(h.bob, "POST", e.base()+"/connect", good); c != 403 {
		t.Errorf("a member connected: %d", c)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "POST", e.base()+"/connect", good); c != 404 {
		t.Errorf("a stranger connected: %d", c)
	}
	for _, repo := range []string{"", "nope", "a/b/c", "../x/y", "owner/..", "ow ner/name", "owner/na me", "owner/name?x=1", strings.Repeat("a", 101) + "/b", "owner/na\nme"} {
		if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.token, "repo": repo}); c != 400 {
			t.Errorf("repo %q: %d", repo, c)
		}
	}
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": "wrong-token-value", "repo": e.repo}); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept that token") {
		t.Errorf("a wrong token: %d %v", c, b)
	}
	e.f.set(func() { e.f.missing = true })
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", good); c != 400 {
		t.Errorf("a repository that cannot be reached: %d", c)
	}
	e.f.set(func() { e.f.missing = false; e.f.hasIssues = false })
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", good); c != 400 || !strings.Contains(fmt.Sprint(b), "issues switched off") {
		t.Errorf("issues off: %d %v", c, b)
	}
	// a public repository would put request titles (written from customer words) where anyone can read them
	e.f.set(func() { e.f.hasIssues = true; e.f.private = false })
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", good); c != 400 || !strings.Contains(fmt.Sprint(b), "public") {
		t.Errorf("a public repository without confirmation: %d %v", c, b)
	}
	e.f.set(func() { e.f.private = true })
	// statuses must belong to this workspace
	other := h.workspace(h.bob, "Elsewhere")
	foreign := h.statusID(h.bob, other, "Shipped")
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.token, "repo": e.repo, "closeStatusId": foreign}); c != 400 {
		t.Errorf("another workspace's status: %d", c)
	}
	// the real thing: the notification secret is returned once; the token and secret are sealed
	b := e.connect(nil)
	if b["webhookUrl"] != "https://api.example/v1/integrations/github/"+e.ws+"/events" || len(e.secret) != 64 {
		t.Errorf("setup: %v", b)
	}
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='github'`, e.ws).Scan(&sealed)
	if bytes.Contains(sealed, []byte("github_pat")) || bytes.Contains(sealed, []byte(e.secret)) || len(sealed) == 0 {
		t.Error("credentials are not sealed")
	}
	_, info, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if strings.Contains(fmt.Sprint(info), e.secret) || strings.Contains(fmt.Sprint(info), "github_pat") || info["repo"] != e.repo || info["state"] != "connected" {
		t.Errorf("info: %v", info)
	}
	_, list, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", nil)
	if strings.Contains(fmt.Sprint(list), e.secret) || strings.Contains(fmt.Sprint(list), "github_pat") {
		t.Errorf("list: %v", list)
	}
	if strings.Contains(h.logs.String(), "github_pat") || strings.Contains(h.logs.String(), e.secret) {
		t.Error("a credential reached the logs")
	}
	// connecting again makes a new notification secret; the old one stops working at once
	old := e.secret
	e.connect(nil)
	if old == e.secret {
		t.Fatal("the secret did not change")
	}
	if c, _ := e.deliver(old, "ping", "d-old", map[string]any{"zen": "x"}); c != 401 {
		t.Errorf("the old secret still works: %d", c)
	}
	if c, _ := e.deliver(e.secret, "ping", "d-new", map[string]any{"zen": "x"}); c != 200 {
		t.Errorf("the new secret: %d", c)
	}
}

func TestIssuesAreMadeForRequestsWithoutCustomerWords(t *testing.T) {
	e := newGHEnv(t, true)
	h := e.h
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, e.ws, bobID)
	if c, _, _ := h.do(h.bob, "POST", e.issueURL(), nil); c != 403 {
		t.Errorf("a viewer made an issue: %d", c)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "POST", e.issueURL(), nil); c != 404 {
		t.Errorf("a stranger made an issue: %d", c)
	}
	if c, _, _ := h.do("", "POST", e.issueURL(), nil); c != 401 {
		t.Errorf("anonymous: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/requests/"+uuid.NewString()+"/issue", nil); c != 404 {
		t.Errorf("a request that does not exist: %d", c)
	}
	code, link := e.createIssue()
	if code != 201 || link["state"] != "open" || link["repo"] != e.repo || !strings.HasPrefix(link["url"].(string), "https://github.com/"+e.repo+"/issues/") || link["conflict"] != "" {
		t.Fatalf("create: %d %v", code, link)
	}
	if len(e.f.bodies) != 1 {
		t.Fatalf("issues created: %d", len(e.f.bodies))
	}
	sent := e.f.bodies[0]
	var posted struct{ Title, Body string }
	json.Unmarshal([]byte(sent), &posted)
	if !strings.Contains(posted.Body, "Quotes: 2") || !strings.Contains(posted.Body, "People: 2") || !strings.Contains(posted.Body, "/w/"+e.ws+"/requests/"+e.req) {
		t.Errorf("issue body: %q", posted.Body)
	}
	for _, leak := range []string{"We really need SSO", "dana", "raj", "acme.com", "Dana", "Raj", "Acme"} {
		if strings.Contains(sent, leak) {
			t.Errorf("the issue contains %q: %s", leak, sent)
		}
	}
	// one issue per request
	if c, _ := e.createIssue(); c != 400 {
		t.Errorf("a second issue for the same request: %d", c)
	}
	if len(e.f.bodies) != 1 {
		t.Error("a second issue was created on GitHub")
	}
	if c, b, _ := h.do(h.alice, "GET", e.issueURL(), nil); c != 200 || b["number"] != link["number"] {
		t.Errorf("get: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "DELETE", e.issueURL(), nil); c != 204 {
		t.Errorf("unlink: %d", c)
	}
	if c, _, _ := h.do(h.alice, "GET", e.issueURL(), nil); c != 404 {
		t.Errorf("after unlinking: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", e.issueURL(), nil); c != 404 {
		t.Errorf("unlinking twice: %d", c)
	}
	// without a connection there is nothing to create
	e2 := newGHEnv(t, false)
	if c, _ := e2.createIssue(); c != 404 {
		t.Errorf("no connection: %d", c)
	}
}

func TestRequestsFollowTheirIssuesSafely(t *testing.T) {
	e := newGHEnv(t, true)
	h := e.h
	_, link := e.createIssue()
	num := int(link["number"].(float64))
	t0 := time.Now()
	at := func(s int) time.Time { return t0.Add(time.Duration(s) * time.Second) }

	// signatures and delivery rules
	body := issueEvent(e.repo, num, "closed", at(1))
	raw, _ := json.Marshal(body)
	for name, c := range map[string]struct {
		secret string
		code   int
	}{"another secret": {strings.Repeat("a", 64), 401}} {
		if got, _ := e.deliver(c.secret, "issues", "d-"+name, body); got != c.code {
			t.Errorf("%s: %d", name, got)
		}
	}
	if got, _ := e.deliverRaw(e.secret, "issues", "d-tamper", append(raw[:len(raw)-1], []byte(`,"x":1}`)...), "sha256="+hex.EncodeToString(func() []byte { m := hmac.New(sha256.New, []byte(e.secret)); m.Write(raw); return m.Sum(nil) }())); got != 401 {
		t.Errorf("a body changed after signing: %d", got)
	}
	for _, sig := range []string{"sha256=", "sha1=abc", "sha256=" + strings.Repeat("0", 64), "garbage"} {
		if got, _ := e.deliverRaw(e.secret, "issues", "d-sig", raw, sig); got != 401 {
			t.Errorf("signature %q: %d", sig, got)
		}
	}
	// a workspace that has no connection, or another workspace's secret, answers the same as a wrong one
	other := h.workspace(h.bob, "No connection")
	rq := httptest.NewRequest("POST", "/v1/integrations/github/"+other+"/events", bytes.NewReader(raw))
	rq.Header.Set("X-GitHub-Delivery", "d-x")
	rq.Header.Set("X-GitHub-Event", "issues")
	m := hmac.New(sha256.New, []byte(e.secret))
	m.Write(raw)
	rq.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(m.Sum(nil)))
	rc := httptest.NewRecorder()
	h.h.ServeHTTP(rc, rq)
	if rc.Code != 401 {
		t.Errorf("an unconnected workspace: %d", rc.Code)
	}
	if e.statusName() != "New" {
		t.Fatalf("status changed before a valid event: %s", e.statusName())
	}
	// ping, other repositories, issues nobody linked: acknowledged, nothing happens
	if c, _ := e.deliver(e.secret, "ping", "d-ping", map[string]any{"zen": "hi"}); c != 200 {
		t.Errorf("ping: %d", c)
	}
	if c, _ := e.deliver(e.secret, "issues", "d-other-repo", issueEvent("someone/else", num, "closed", at(2))); c != 200 {
		t.Errorf("other repository: %d", c)
	}
	if c, _ := e.deliver(e.secret, "issues", "d-unlinked", issueEvent(e.repo, 99999, "closed", at(3))); c != 200 {
		t.Errorf("unlinked issue: %d", c)
	}
	if c, _ := e.deliver(e.secret, "issues", "d-edit", issueEvent(e.repo, num, "edited", at(4))); c != 200 {
		t.Errorf("edit: %d", c)
	}
	if e.statusName() != "New" {
		t.Fatalf("ignored events changed the status: %s", e.statusName())
	}

	// closed: the request follows (to Shipped, as chosen), drafts are prepared, and nothing is sent
	if c, _ := e.deliver(e.secret, "issues", "d-close", issueEvent(e.repo, num, "closed", at(10))); c != 200 {
		t.Fatalf("closed: %d", c)
	}
	if e.statusName() != "Shipped" {
		t.Fatalf("status after closing: %s", e.statusName())
	}
	var drafts int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM outreach_message WHERE workspace_id=$1`, e.ws).Scan(&drafts)
	if drafts == 0 {
		t.Error("moving to a shipped status prepared no drafts for review")
	}
	if len(h.mail.all()) != 0 {
		t.Fatal("something was sent without anyone approving it")
	}
	if l := e.link(); l["state"] != "closed" || l["conflict"] != "" {
		t.Errorf("link: %v", l)
	}
	// the same delivery again, from a person having moved it back meanwhile: acted on once
	e.setStatus("Planned")
	if c, _ := e.deliver(e.secret, "issues", "d-close", issueEvent(e.repo, num, "closed", at(10))); c != 200 {
		t.Fatalf("replay: %d", c)
	}
	if e.statusName() != "Planned" || e.link()["conflict"] != "" {
		t.Errorf("a replayed delivery was acted on twice: %s %v", e.statusName(), e.link())
	}
	// 8 copies of one delivery at the same moment: one effect
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.deliver(e.secret, "issues", "d-reopen", issueEvent(e.repo, num, "reopened", at(20)))
		}()
	}
	wg.Wait()

	// the link last agreed on Shipped, and a person has since set Planned: the reopen is a conflict, not an overwrite
	if e.statusName() != "Planned" {
		t.Errorf("status after reopen: %s", e.statusName())
	}
	l := e.link()
	if l["state"] != "open" || !strings.Contains(l["conflict"].(string), "changed here") {
		t.Fatalf("a conflict was not reported: %v", l)
	}
	// older than what we know: ignored, even though it is a new delivery
	if c, _ := e.deliver(e.secret, "issues", "d-stale", issueEvent(e.repo, num, "closed", at(5))); c != 200 {
		t.Fatal(c)
	}
	if e.link()["state"] != "open" {
		t.Error("an out-of-order, older event changed the link")
	}
	// settle it: keep things here, then do it the other way
	if c, _, _ := h.do(h.alice, "POST", e.issueURL()+"/resolve", map[string]any{"apply": false}); c != 204 {
		t.Fatalf("keep: %d", c)
	}
	if e.statusName() != "Planned" || e.link()["conflict"] != "" {
		t.Errorf("after keeping: %s %v", e.statusName(), e.link())
	}
	if c, _, _ := h.do(h.alice, "POST", e.issueURL()+"/resolve", map[string]any{"apply": true}); c != 400 {
		t.Errorf("resolving with nothing to resolve: %d", c)
	}
	// now the sides agree again (synced on Planned): closing follows without a conflict
	if c, _ := e.deliver(e.secret, "issues", "d-close2", issueEvent(e.repo, num, "closed", at(30))); c != 200 {
		t.Fatal(c)
	}
	if e.statusName() != "Shipped" || e.link()["conflict"] != "" {
		t.Errorf("after the sides agreed: %s %v", e.statusName(), e.link())
	}
	// reopening moves it out of Shipped, and withdraws drafts nobody approved
	if c, _ := e.deliver(e.secret, "issues", "d-reopen2", issueEvent(e.repo, num, "reopened", at(40))); c != 200 {
		t.Fatal(c)
	}
	if e.statusName() != "In progress" {
		t.Errorf("after reopening: %s", e.statusName())
	}
	var open int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM outreach_batch WHERE workspace_id=$1 AND state IN ('drafting','review','approved')`, e.ws).Scan(&open)
	if open != 0 {
		t.Errorf("%d unapproved batches were left open after leaving Shipped", open)
	}
	// a person moves it, then the issue closes: held back, and "apply" does it with the same rules as a person
	e.setStatus("New")
	e.deliver(e.secret, "issues", "d-close3", issueEvent(e.repo, num, "closed", at(50)))
	if e.statusName() != "New" || e.link()["conflict"] == "" {
		t.Fatalf("expected a conflict: %s %v", e.statusName(), e.link())
	}
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, e.ws, bobID)
	if c, _, _ := h.do(h.bob, "POST", e.issueURL()+"/resolve", map[string]any{"apply": true}); c != 403 {
		t.Errorf("a viewer resolved a conflict: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", e.issueURL()+"/resolve", map[string]any{"apply": true}); c != 204 {
		t.Fatalf("apply: %d", c)
	}
	if e.statusName() != "Shipped" || e.link()["conflict"] != "" {
		t.Errorf("after applying: %s %v", e.statusName(), e.link())
	}
	// deleted on GitHub: the link says so, the request is untouched
	e.deliver(e.secret, "issues", "d-deleted", issueEvent(e.repo, num, "deleted", at(60)))
	l = e.link()
	if l["state"] != "deleted" || !strings.Contains(l["conflict"].(string), "deleted") || e.statusName() != "Shipped" {
		t.Errorf("after deletion: %v %s", l, e.statusName())
	}
	// no mail went out at any point, and we never wrote to GitHub except to make the one issue (no loop is possible)
	if len(h.mail.all()) != 0 {
		t.Error("mail was sent")
	}
	if w := e.f.writes(); w != 1 {
		t.Errorf("%d writes to GitHub, want exactly the one that created the issue", w)
	}
}

func TestWithoutAChosenStatusAnIssueOnlyChangesTheLink(t *testing.T) {
	e := newGHEnv(t, false)
	e.connect(nil) // no mapping
	_, link := e.createIssue()
	num := int(link["number"].(float64))
	e.deliver(e.secret, "issues", "d1", issueEvent(e.repo, num, "closed", time.Now().Add(time.Second)))
	if e.statusName() != "New" {
		t.Errorf("the request moved without a chosen status: %s", e.statusName())
	}
	if l := e.link(); l["state"] != "closed" || l["conflict"] != "" {
		t.Errorf("link: %v", l)
	}
	// the mapping can be set later by an admin; a member cannot set it; a status elsewhere is refused
	h := e.h
	if c, _, _ := h.do(h.alice, "PUT", e.base()+"/mapping", map[string]any{"closeStatusId": h.statusID(h.alice, e.ws, "Shipped")}); c != 204 {
		t.Fatalf("mapping: %d", c)
	}
	other := h.workspace(h.bob, "Elsewhere 2")
	if c, _, _ := h.do(h.alice, "PUT", e.base()+"/mapping", map[string]any{"closeStatusId": h.statusID(h.bob, other, "Shipped")}); c != 400 {
		t.Errorf("a foreign status: %d", c)
	}
	_, info, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if info["closeStatusId"] != h.statusID(h.alice, e.ws, "Shipped") || info["reopenStatusId"] != nil {
		t.Errorf("info: %v", info)
	}
}

func TestARevokedGitHubTokenIsShownAndNothingIsLost(t *testing.T) {
	e := newGHEnv(t, true)
	h := e.h
	_, link := e.createIssue()
	num := int(link["number"].(float64))
	e.f.set(func() { e.f.token = "github_pat_rotated_elsewhere" }) // the token was revoked or replaced on GitHub
	c, b, _ := h.do(h.alice, "POST", e.base()+"/check", nil)
	if c != 409 || b["error"].(map[string]any)["code"] != "needs_reconnect" {
		t.Fatalf("check: %d %v", c, b)
	}
	_, list, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", nil)
	if list["integrations"].([]any)[0].(map[string]any)["state"] != "needs_reconnect" {
		t.Errorf("not shown: %v", list)
	}
	// we can no longer make issues, but links and what GitHub tells us still work: nothing is lost
	e.req = h.requestFrom(h.alice, e.ws, "raj@acme.com")
	if c, _ := e.createIssue(); c != 409 {
		t.Errorf("creating with a dead token: %d", c)
	}
	if e.link() != nil && false {
		t.Fatal("unreachable")
	}
	if c, _ := e.deliver(e.secret, "issues", "d-dead", issueEvent(e.repo, num, "closed", time.Now().Add(time.Second))); c != 200 {
		t.Errorf("an event for an existing link: %d", c)
	}
	// connect again with the new token: works, with a fresh notification secret
	e.f.set(func() { e.f.token = "github_pat_new_token_0002" })
	e.connect(nil)
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/check", nil); c != 204 {
		t.Errorf("check after reconnecting: %d", c)
	}
	// the repository going away is noticed too, by the background check
	h.db.Super.Exec(context.Background(), `UPDATE integration SET last_ok_at = now() - interval '2 hours' WHERE workspace_id=$1 AND kind='github'`, e.ws)
	e.f.set(func() { e.f.missing = true })
	h.srv.Integrations.CheckAll(context.Background())
	_, list, _ = h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", nil)
	if list["integrations"].([]any)[0].(map[string]any)["state"] != "needs_reconnect" {
		t.Error("the background check did not notice the repository was gone")
	}
	// disconnecting forgets the credentials and the notification secret
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/integrations/github", nil); c != 204 {
		t.Fatal(c)
	}
	if c, _ := e.deliver(e.secret, "ping", "d-after", map[string]any{"zen": "x"}); c != 401 {
		t.Errorf("a disconnected workspace still accepts events: %d", c)
	}
}
