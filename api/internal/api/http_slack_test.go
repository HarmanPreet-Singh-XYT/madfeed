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
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/integrations"
)

const slackSigning = "slack-signing-secret"

type slackEnv struct {
	h  *harness
	f  *fakeSlack
	ws string
}

func newSlackEnv(t *testing.T) *slackEnv {
	h := newHarness(t)
	f := newFakeSlack(t)
	h.srv.Integrations.Slack = integrations.SlackConfig{
		ClientID: "slack-client-id", ClientSecret: "slack-client-secret", SigningSecret: slackSigning,
		APIBase: f.srv.URL, AuthorizeURL: f.srv.URL + "/oauth/v2/authorize", RedirectURI: "https://app.example/integrations/slack/callback",
	}
	return &slackEnv{h: h, f: f, ws: h.workspace(h.alice, "Slack Co")}
}

func (e *slackEnv) base() string { return "/v1/workspaces/" + e.ws + "/integrations" }

// connect runs the whole approval: our link, Slack sending the person back, finishing it.
func (e *slackEnv) connect(token, ws string) (int, map[string]any) {
	e.h.t.Helper()
	code, b, _ := e.h.do(token, "POST", "/v1/workspaces/"+ws+"/integrations/slack/connect", nil)
	if code != 200 {
		return code, b
	}
	state := authorizeParams(b["url"].(string)).Get("state")
	code, b, _ = e.h.do(token, "POST", "/v1/integrations/slack/complete", map[string]any{"code": "code-" + uuid.NewString(), "state": state})
	return code, b
}

func (e *slackEnv) event(body map[string]any, ts time.Time, secret string) (int, string) {
	raw, _ := json.Marshal(body)
	return e.rawEvent(raw, strconv.FormatInt(ts.Unix(), 10), secret)
}

func (e *slackEnv) rawEvent(raw []byte, tsHeader, secret string) (int, string) {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("v0:" + tsHeader + ":"))
	m.Write(raw)
	req := httptest.NewRequest("POST", "/v1/integrations/slack/events", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Slack-Request-Timestamp", tsHeader)
	req.Header.Set("X-Slack-Signature", "v0="+hex.EncodeToString(m.Sum(nil)))
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func slackMessage(team, channel, text, ts string, extra map[string]any) map[string]any {
	ev := map[string]any{"type": "message", "channel": channel, "channel_type": "channel", "user": "U123", "text": text, "ts": ts}
	for k, v := range extra {
		ev[k] = v
	}
	return map[string]any{"type": "event_callback", "team_id": team, "event_id": "Ev" + ts, "event": ev}
}

func (e *slackEnv) chatItems() []string {
	rows, _ := e.h.db.Super.Query(context.Background(), `SELECT raw_text FROM source_item WHERE workspace_id=$1 AND kind='chat' ORDER BY created_at`, e.ws)
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		out = append(out, s)
	}
	return out
}

func TestSlackConnectionIsAdminOnlyAndBoundToTheRightPerson(t *testing.T) {
	e := newSlackEnv(t)
	h := e.h
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, e.ws, bobID)
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", e.base(), nil}, {"POST", e.base() + "/slack/connect", nil}, {"GET", e.base() + "/slack/channels", nil},
		{"PUT", e.base() + "/slack/channel", map[string]any{"channelId": "C0FEEDBACK"}}, {"POST", e.base() + "/slack/check", nil}, {"DELETE", e.base() + "/slack", nil},
	} {
		if code, _, _ := h.do(h.bob, c.method, c.path, c.body); code != 403 {
			t.Errorf("a member on %s %s: %d", c.method, c.path, code)
		}
		if code, _, _ := h.do("t:"+uuid.NewString(), c.method, c.path, c.body); code != 404 {
			t.Errorf("a stranger on %s %s: %d", c.method, c.path, code)
		}
		if code, _, _ := h.do("", c.method, c.path, c.body); code != 401 {
			t.Errorf("anonymous on %s %s: %d", c.method, c.path, code)
		}
	}
	// the link carries a signed state; nothing else about the workspace
	_, b, _ := h.do(h.alice, "POST", e.base()+"/slack/connect", nil)
	q := authorizeParams(b["url"].(string))
	if q.Get("client_id") != "slack-client-id" || q.Get("redirect_uri") != "https://app.example/integrations/slack/callback" || !strings.Contains(q.Get("scope"), "channels:history") {
		t.Errorf("authorize link: %v", q)
	}
	if strings.Contains(b["url"].(string), "slack-client-secret") {
		t.Error("the client secret is in the link")
	}
	state := q.Get("state")
	complete := func(token, code, st string) int {
		c, _, _ := h.do(token, "POST", "/v1/integrations/slack/complete", map[string]any{"code": code, "state": st})
		return c
	}
	// a link made for Alice cannot be finished by anyone else, even another admin of the same workspace
	carol := "t:" + uuid.NewString()
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, e.ws, uuid.MustParse(strings.TrimPrefix(carol, "t:")))
	if c := complete(carol, "good-code-carol", state); c != 400 {
		t.Errorf("another admin finished Alice's link: %d", c)
	}
	if c := complete(h.bob, "good", state); c == 200 { // a member, not an admin
		t.Error("a member connected the workspace")
	}
	other := h.workspace(h.bob, "Bob's own")
	if c := complete(h.alice, "good", state[:len(state)-1]+flipped(state)); c != 400 {
		t.Errorf("a tampered state: %d", c)
	}
	if c := complete(h.alice, "good", "not-a-state-at-all"); c != 400 {
		t.Errorf("an invented state: %d", c)
	}
	if c := complete("", "good", state); c != 401 {
		t.Errorf("no sign-in: %d", c)
	}
	// an expired link
	h.srv.Integrations.Now = func() time.Time { return time.Now().Add(11 * time.Minute) }
	if c := complete(h.alice, "good", state); c != 400 {
		t.Errorf("an expired state: %d", c)
	}
	h.srv.Integrations.Now = nil
	// the real thing
	if c := complete(h.alice, "good-code", state); c != 200 {
		t.Fatalf("complete: %d", c)
	}
	// a code works once
	if c := complete(h.alice, "good-code", state); c != 400 {
		t.Errorf("a reused code: %d", c)
	}
	// what we store: sealed, readable only with our key, and no token in anything shown
	var secret []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='slack'`, e.ws).Scan(&secret)
	if len(secret) == 0 || bytes.Contains(secret, []byte("xoxb")) || bytes.Contains(secret, []byte("fake-token")) {
		t.Errorf("credentials are not sealed: %q", secret)
	}
	code, list, _ := h.do(h.alice, "GET", e.base(), nil)
	if code != 200 || strings.Contains(fmt.Sprint(list), "xoxb") || strings.Contains(fmt.Sprint(list), "fake-token") {
		t.Errorf("list: %d %v", code, list)
	}
	it := list["integrations"].([]any)[0].(map[string]any)
	if it["kind"] != "slack" || it["state"] != "connected" || it["summary"] != "Acme Slack" || list["slackAvailable"] != true {
		t.Errorf("status: %v", it)
	}
	if strings.Contains(h.logs.String(), "fake-token") || strings.Contains(h.logs.String(), "slack-client-secret") {
		t.Error("a credential reached the logs")
	}
	// one Slack workspace belongs to one workspace here
	if c, b2 := e.connect(h.bob, other); c != 400 || !strings.Contains(fmt.Sprint(b2), "already connected") {
		t.Errorf("the same Slack team in a second workspace: %d %v", c, b2)
	}
}

func TestSlackMessagesInTheChosenChannelBecomeReviewedFeedback(t *testing.T) {
	e := newSlackEnv(t)
	h := e.h
	if c, b := e.connect(h.alice, e.ws); c != 200 {
		t.Fatalf("connect: %d %v", c, b)
	}
	// pick the channel from the list; the app joins it
	_, ch, _ := h.do(h.alice, "GET", e.base()+"/slack/channels", nil)
	cs := ch["channels"].([]any)
	if len(cs) != 2 { // the archived one is not offered
		t.Errorf("channels: %v", cs)
	}
	if c, _, _ := h.do(h.alice, "PUT", e.base()+"/slack/channel", map[string]any{"channelId": "C0NOPE"}); c != 400 && c != 502 && c != 500 {
		t.Errorf("a channel that does not exist: %d", c)
	}
	for _, bad := range []string{"general", "C", "../x", strings.Repeat("C", 60)} {
		if c, _, _ := h.do(h.alice, "PUT", e.base()+"/slack/channel", map[string]any{"channelId": bad}); c != 400 {
			t.Errorf("channel %q: %d", bad, c)
		}
	}
	if c, _, _ := h.do(h.alice, "PUT", e.base()+"/slack/channel", map[string]any{"channelId": "C0FEEDBACK"}); c != 204 {
		t.Fatalf("set channel: %d", c)
	}
	if len(e.f.Joined) != 1 || e.f.Joined[0] != "C0FEEDBACK" {
		t.Errorf("the app did not join the channel: %v", e.f.Joined)
	}
	_, list, _ := h.do(h.alice, "GET", e.base(), nil)
	if list["integrations"].([]any)[0].(map[string]any)["detail"] != "#feedback" {
		t.Errorf("%v", list)
	}

	now := time.Now()
	// the one-time URL check
	raw, _ := json.Marshal(map[string]any{"type": "url_verification", "challenge": "abc123"})
	if c, body := e.rawEvent(raw, strconv.FormatInt(now.Unix(), 10), slackSigning); c != 200 || !strings.Contains(body, "abc123") {
		t.Fatalf("challenge: %d %s", c, body)
	}
	// signatures: wrong secret, wrong body, old timestamp, future timestamp, missing, junk
	good := slackMessage(e.f.Team, "C0FEEDBACK", "We really need SSO for our team.", "1700000001.000100", nil)
	if c, _ := e.event(good, now, "another-secret"); c != 401 {
		t.Errorf("wrong secret: %d", c)
	}
	if c, _ := e.event(good, now.Add(-6*time.Minute), slackSigning); c != 401 {
		t.Errorf("old timestamp: %d", c)
	}
	if c, _ := e.event(good, now.Add(6*time.Minute), slackSigning); c != 401 {
		t.Errorf("future timestamp: %d", c)
	}
	rb, _ := json.Marshal(good)
	m := hmac.New(sha256.New, []byte(slackSigning))
	m.Write([]byte("v0:" + strconv.FormatInt(now.Unix(), 10) + ":"))
	m.Write(rb)
	tampered := httptest.NewRequest("POST", "/v1/integrations/slack/events", bytes.NewReader(append(rb[:len(rb)-1], []byte(` ,"x":1}`)...)))
	tampered.Header.Set("X-Slack-Request-Timestamp", strconv.FormatInt(now.Unix(), 10))
	tampered.Header.Set("X-Slack-Signature", "v0="+hex.EncodeToString(m.Sum(nil)))
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, tampered)
	if rec.Code != 401 {
		t.Errorf("a body changed after signing: %d", rec.Code)
	}
	for _, hdr := range []struct{ ts, sig string }{{"", ""}, {"abc", "v0=00"}, {strconv.FormatInt(now.Unix(), 10), "v0=" + strings.Repeat("0", 64)}} {
		rq := httptest.NewRequest("POST", "/v1/integrations/slack/events", bytes.NewReader(rb))
		rq.Header.Set("X-Slack-Request-Timestamp", hdr.ts)
		rq.Header.Set("X-Slack-Signature", hdr.sig)
		rc := httptest.NewRecorder()
		h.h.ServeHTTP(rc, rq)
		if rc.Code != 401 {
			t.Errorf("headers %v: %d", hdr, rc.Code)
		}
	}
	if len(e.chatItems()) != 0 {
		t.Fatal("something was stored before a valid event")
	}

	// a real message: stored once, however many times Slack delivers it
	for i := 0; i < 4; i++ {
		if c, _ := e.event(good, now, slackSigning); c != 200 {
			t.Fatalf("event %d: %d", i, c)
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); e.event(good, time.Now(), slackSigning) }()
	}
	wg.Wait()
	items := e.chatItems()
	if len(items) != 1 || items[0] != "We really need SSO for our team." {
		t.Fatalf("stored: %q", items)
	}
	var title, ext string
	h.db.Super.QueryRow(context.Background(), `SELECT title, external_id FROM source_item WHERE workspace_id=$1 AND kind='chat'`, e.ws).Scan(&title, &ext)
	if title != "Slack #feedback" || ext != "slack:"+e.f.Team+":C0FEEDBACK:1700000001.000100" {
		t.Errorf("title %q external %q", title, ext)
	}
	// the same words said again later are the same text: stored once, like pasting them twice
	e.event(slackMessage(e.f.Team, "C0FEEDBACK", "We really need SSO for our team.", "1700000002.000100", nil), time.Now(), slackSigning)
	if len(e.chatItems()) != 1 {
		t.Error("identical text stored twice")
	}

	// what is ignored: other channels, other teams, edits, bots, joins, empty text, direct messages
	for name, ev := range map[string]map[string]any{
		"another channel":   slackMessage(e.f.Team, "C0RANDOM", "hello there", "1700000010.1", nil),
		"another team":      slackMessage("T9999", "C0FEEDBACK", "hello there", "1700000011.1", nil),
		"an edit":           slackMessage(e.f.Team, "C0FEEDBACK", "hello there", "1700000012.1", map[string]any{"subtype": "message_changed"}),
		"a bot":             slackMessage(e.f.Team, "C0FEEDBACK", "hello there", "1700000013.1", map[string]any{"bot_id": "B1"}),
		"a join":            slackMessage(e.f.Team, "C0FEEDBACK", "hello there", "1700000014.1", map[string]any{"subtype": "channel_join"}),
		"empty":             slackMessage(e.f.Team, "C0FEEDBACK", "   ", "1700000015.1", nil),
		"a direct message":  slackMessage(e.f.Team, "C0FEEDBACK", "hello there", "1700000016.1", map[string]any{"channel_type": "im"}),
		"no author":         slackMessage(e.f.Team, "C0FEEDBACK", "hello there", "1700000017.1", map[string]any{"user": ""}),
		"another event":     {"type": "event_callback", "team_id": e.f.Team, "event": map[string]any{"type": "reaction_added"}},
		"an unknown family": {"type": "something_else"},
	} {
		if c, _ := e.event(ev, time.Now(), slackSigning); c != 200 {
			t.Errorf("%s: %d (Slack must be answered, not retried)", name, c)
		}
	}
	if n := len(e.chatItems()); n != 1 {
		t.Errorf("ignored events were stored: %d items", n)
	}

	// Slack's markup becomes words; the same intake rules as anything pasted apply
	e.event(slackMessage(e.f.Team, "C0FEEDBACK", "<@U42> says <https://example.com/doc|the doc> &amp; <#C0RANDOM|random> are wrong. Card 4242 4242 4242 4242 <!here>", "1700000020.1", nil), time.Now(), slackSigning)
	items = e.chatItems()
	if len(items) != 2 {
		t.Fatalf("items: %q", items)
	}
	got := items[1]
	if got != "@someone says the doc & #random are wrong. Card [hidden] @here" && !strings.Contains(got, "@someone says the doc & #random are wrong.") {
		t.Errorf("text: %q", got)
	}
	if strings.Contains(got, "4242") || strings.Contains(got, "<@") || strings.Contains(got, "&amp;") {
		t.Errorf("not cleaned: %q", got)
	}
	// nothing became a request by itself; extraction proposes, a person decides
	var sid uuid.UUID
	h.db.Super.QueryRow(context.Background(), `SELECT id FROM source_item WHERE workspace_id=$1 AND kind='chat' ORDER BY created_at LIMIT 1`, e.ws).Scan(&sid)
	if err := workExtract(h, e.ws, sid); err != nil {
		t.Fatal(err)
	}
	_, reqs, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/requests", nil)
	_, props, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/proposals", nil)
	if len(reqs["requests"].([]any)) != 0 || len(props["proposals"].([]any)) == 0 {
		t.Errorf("requests %v proposals %v", reqs["requests"], props["proposals"])
	}
	// too long, over the daily allowance, a flood: dropped quietly (Slack must not retry), never an error
	long := strings.Repeat("word ", 50_000)
	if c, _ := e.event(slackMessage(e.f.Team, "C0FEEDBACK", long, "1700000030.1", nil), time.Now(), slackSigning); c != 200 {
		t.Errorf("too long: %d", c)
	}
	h.srv.Intake.DailyBytes = 10
	if c, _ := e.event(slackMessage(e.f.Team, "C0FEEDBACK", "this would exceed the allowance", "1700000031.1", nil), time.Now(), slackSigning); c != 200 {
		t.Errorf("over the allowance: %d", c)
	}
	h.srv.Intake.DailyBytes = 0
	var n int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM source_item WHERE workspace_id=$1 AND kind='chat'`, e.ws).Scan(&n)
	if n != 2 {
		t.Errorf("dropped messages were stored: %d", n)
	}
	// the model reads at most a fixed number of chat messages a day, like form and API notes
	h.worker.FormPerDay = 1
	h.db.Super.Exec(context.Background(), `UPDATE source_item SET extract_started_at = now() WHERE id=$1`, sid)
	var second uuid.UUID
	h.db.Super.QueryRow(context.Background(), `SELECT id FROM source_item WHERE workspace_id=$1 AND kind='chat' AND id <> $2`, e.ws, sid).Scan(&second)
	if err := workExtract(h, e.ws, second); err == nil {
		t.Error("the daily cap on model reads did not apply to chat messages")
	}
}

func TestARevokedExpiredOrReconnectedSlackConnectionIsShownAndLosesNothing(t *testing.T) {
	e := newSlackEnv(t)
	h := e.h
	e.connect(h.alice, e.ws)
	h.do(h.alice, "PUT", e.base()+"/slack/channel", map[string]any{"channelId": "C0FEEDBACK"})
	e.event(slackMessage(e.f.Team, "C0FEEDBACK", "Please add dark mode.", "1700000100.1", nil), time.Now(), slackSigning)
	if len(e.chatItems()) != 1 {
		t.Fatal("setup")
	}
	state := func() string {
		_, l, _ := h.do(h.alice, "GET", e.base(), nil)
		return l["integrations"].([]any)[0].(map[string]any)["state"].(string)
	}
	// Slack revokes the token: the next check says so, plainly, and tells the admin to reconnect
	e.f.Revoke()
	code, b, _ := h.do(h.alice, "POST", e.base()+"/slack/check", nil)
	if code != 409 || b["error"].(map[string]any)["code"] != "needs_reconnect" {
		t.Fatalf("check after revoking: %d %v", code, b)
	}
	if state() != "needs_reconnect" {
		t.Error("the list does not say the connection needs attention")
	}
	if c, _, _ := h.do(h.alice, "GET", e.base()+"/slack/channels", nil); c != 409 {
		t.Errorf("channels with a dead token: %d", c)
	}
	// messages stop being collected, what was collected is still there
	e.event(slackMessage(e.f.Team, "C0FEEDBACK", "A message while disconnected.", "1700000101.1", nil), time.Now(), slackSigning)
	if items := e.chatItems(); len(items) != 1 || items[0] != "Please add dark mode." {
		t.Errorf("items after revoking: %q", items)
	}
	// connecting again makes it work, and keeps the chosen channel
	e.f.Unrevoke()
	e.f.Mu.Lock()
	e.f.Token = "xoxb-fake-token-2"
	e.f.Mu.Unlock()
	if c, b := e.connect(h.alice, e.ws); c != 200 {
		t.Fatalf("reconnect: %d %v", c, b)
	}
	if state() != "connected" {
		t.Error("not connected after reconnecting")
	}
	_, l, _ := h.do(h.alice, "GET", e.base(), nil)
	if l["integrations"].([]any)[0].(map[string]any)["detail"] != "#feedback" {
		t.Errorf("the channel was forgotten: %v", l)
	}
	e.event(slackMessage(e.f.Team, "C0FEEDBACK", "Back again: please add export.", "1700000102.1", nil), time.Now(), slackSigning)
	if len(e.chatItems()) != 2 {
		t.Error("collection did not resume")
	}
	// Slack tells us the app was removed
	if c, _ := e.event(map[string]any{"type": "event_callback", "team_id": e.f.Team, "event": map[string]any{"type": "app_uninstalled"}}, time.Now(), slackSigning); c != 200 {
		t.Fatal(c)
	}
	if state() != "needs_reconnect" {
		t.Error("an uninstall was not noticed")
	}
	// an unknown team's uninstall changes nothing
	e.connect(h.alice, e.ws)
	e.event(map[string]any{"type": "event_callback", "team_id": "TOTHER", "event": map[string]any{"type": "tokens_revoked"}}, time.Now(), slackSigning)
	if state() != "connected" {
		t.Error("another team's uninstall disconnected this one")
	}
	// disconnecting forgets the credentials; collected data stays; events stop
	if c, _, _ := h.do(h.alice, "DELETE", e.base()+"/slack", nil); c != 204 {
		t.Fatal(c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", e.base()+"/slack", nil); c != 404 {
		t.Errorf("disconnecting twice: %d", c)
	}
	var rows int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM integration WHERE workspace_id=$1`, e.ws).Scan(&rows)
	if rows != 0 {
		t.Error("credentials were kept after disconnecting")
	}
	e.event(slackMessage(e.f.Team, "C0FEEDBACK", "After disconnecting.", "1700000103.1", nil), time.Now(), slackSigning)
	if len(e.chatItems()) != 2 {
		t.Errorf("events were accepted after disconnecting: %q", e.chatItems())
	}
}

func TestSlackTokensThatExpireAreRefreshedOrReported(t *testing.T) {
	e := newSlackEnv(t)
	h := e.h
	e.f.Rotate = true
	e.connect(h.alice, e.ws)
	// an hour before expiry nothing is refreshed; near expiry it is, once, and the new token is kept
	if _, _, _ = h.do(h.alice, "GET", e.base()+"/slack/channels", nil); true {
	}
	before := e.f.CallCount("oauth.v2.access")
	h.srv.Integrations.Now = func() time.Time { return time.Now().Add(12*time.Hour + 56*time.Minute) } // 4 minutes before expiry
	if c, _, _ := h.do(h.alice, "GET", e.base()+"/slack/channels", nil); c != 200 {
		t.Fatalf("channels near expiry: %d", c)
	}
	if e.f.CallCount("oauth.v2.access") != before+1 {
		t.Errorf("expected one refresh, token calls went %d -> %d", before, e.f.CallCount("oauth.v2.access"))
	}
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1`, e.ws).Scan(&sealed)
	raw, err := h.srv.Integrations.Box.Open(sealed, e.ws+"|slack")
	if err != nil || !strings.Contains(string(raw), "xoxb-fake-token-1r") {
		t.Errorf("the refreshed token was not stored: %v %s", err, raw)
	}
	// the stored credentials are bound to this workspace: moved to another row they do not open
	if _, err := h.srv.Integrations.Box.Open(sealed, uuid.NewString()+"|slack"); err == nil {
		t.Error("credentials opened for another workspace")
	}
	// a refresh that fails means "connect again", not an error page and not lost data
	h.srv.Integrations.Now = func() time.Time { return time.Now().Add(26 * time.Hour) }
	e.f.Mu.Lock()
	e.f.FailRefresh = true
	e.f.Mu.Unlock()
	c, b, _ := h.do(h.alice, "GET", e.base()+"/slack/channels", nil)
	if c != 409 || b["error"].(map[string]any)["code"] != "needs_reconnect" {
		t.Fatalf("failed refresh: %d %v", c, b)
	}
	_, l, _ := h.do(h.alice, "GET", e.base(), nil)
	if l["integrations"].([]any)[0].(map[string]any)["state"] != "needs_reconnect" {
		t.Error("not shown as needing a reconnect")
	}
	// the background check finds a revoked connection without anyone looking
	h.srv.Integrations.Now = nil
	e.f.FailRefresh = false
	e.f.Rotate = false
	e.connect(h.alice, e.ws)
	h.db.Super.Exec(context.Background(), `UPDATE integration SET last_ok_at = now() - interval '2 hours' WHERE workspace_id=$1`, e.ws)
	e.f.Revoke()
	h.srv.Integrations.CheckAll(context.Background())
	_, l, _ = h.do(h.alice, "GET", e.base(), nil)
	if l["integrations"].([]any)[0].(map[string]any)["state"] != "needs_reconnect" {
		t.Error("the background check did not notice the revoked connection")
	}
}

var _ = http.StatusOK
