package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/inbox"
)

func (hn *harness) postEmail(ws, key, body string, stamp time.Time) int {
	hn.t.Helper()
	ts := strconv.FormatInt(stamp.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(ts + "." + body))
	req := httptest.NewRequest("POST", "/v1/integrations/email/"+ws+"/inbound", bytes.NewBufferString(body))
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	rec := httptest.NewRecorder()
	hn.h.ServeHTTP(rec, req)
	return rec.Code
}

func TestTheSupportDeskOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Shop Support")
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.exec(`INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID)
	base := "/v1/workspaces/" + ws

	// only an admin sets it up
	cfg := map[string]any{"chatEnabled": true, "emailEnabled": true, "origins": []string{"https://shop.example"}, "greeting": "Hi!"}
	if c, _, _ := h.do(h.bob, "PUT", base+"/inbox/settings", cfg); c != 403 {
		t.Errorf("a member changed the settings: %d", c)
	}
	c, st, _ := h.do(h.alice, "PUT", base+"/inbox/settings", cfg)
	if c != 200 || st["widgetToken"] == nil || st["inboundKey"] == nil {
		t.Fatalf("settings: %d %v", c, st)
	}
	widget, key := st["widgetToken"].(string), st["inboundKey"].(string)
	if c, _, _ := h.do(h.alice, "PUT", base+"/inbox/settings", map[string]any{"chatEnabled": true, "emailEnabled": false, "origins": []string{"http://shop.example"}}); c != 400 {
		t.Errorf("plain http for a live site: %d", c)
	}

	// a visitor chats from the listed site; from another site they are refused
	pub := "/v1/public/chat/" + widget
	if c, b, _ := h.do("", "GET", pub+"/config?origin=https://shop.example", nil); c != 200 || b["greeting"] != "Hi!" {
		t.Errorf("config: %d %v", c, b)
	}
	if c, _, _ := h.do("", "GET", pub+"/config?origin=https://evil.example", nil); c != 403 {
		t.Errorf("config from another site: %d", c)
	}
	visitor := "visitor-key-0000000000000001"
	msg := map[string]any{"origin": "https://shop.example", "visitor": visitor, "text": "<b>Where is my order?</b>", "email": "kim@acme.com"}
	if c, b, _ := h.do("", "POST", pub+"/messages", msg); c != 202 {
		t.Fatalf("send: %d %v", c, b)
	}
	if c, _, _ := h.do("", "POST", pub+"/messages", map[string]any{"origin": "https://evil.example", "visitor": visitor, "text": "x"}); c != 403 {
		t.Errorf("chat from another site: %d", c)
	}
	if c, _, _ := h.do("", "POST", pub+"/messages", `{"origin":"https://shop.example","visitor":"`+visitor+`","text":"x","admin":true}`); c != 400 {
		t.Errorf("an unknown field: %d", c)
	}
	if c, _, _ := h.do("", "POST", "/v1/public/chat/c.not-a-real-widget-address-12345/messages", msg); c != 404 {
		t.Errorf("a made-up widget address: %d", c)
	}

	// the team sees it, replies, and the visitor sees the reply but not a note
	_, list, _ := h.do(h.bob, "GET", base+"/conversations?state=open", nil)
	convs := list["conversations"].([]any)
	if len(convs) != 1 || convs[0].(map[string]any)["channel"] != "chat" {
		t.Fatalf("inbox %v", list)
	}
	conv := base + "/conversations/" + convs[0].(map[string]any)["id"].(string)
	_, one, _ := h.do(h.bob, "GET", conv, nil)
	seen := one["lastMessageId"].(string)
	if c, _, _ := h.do(h.bob, "POST", conv+"/notes", map[string]any{"body": "internal only"}); c != 201 {
		t.Fatalf("note: %d", c)
	}
	// the note made the view stale
	if c, b, _ := h.do(h.bob, "POST", conv+"/reply", map[string]any{"body": "On it", "seenMessageId": seen}); c != 409 {
		t.Errorf("replying to an out-of-date view: %d %v", c, b)
	}
	_, one, _ = h.do(h.bob, "GET", conv, nil)
	if c, b, _ := h.do(h.bob, "POST", conv+"/reply", map[string]any{"body": "On it", "seenMessageId": one["lastMessageId"]}); c != 201 {
		t.Fatalf("reply: %d %v", c, b)
	}
	_, polled, _ := h.do("", "GET", pub+"/messages?origin=https://shop.example&visitor="+visitor, nil)
	ms := polled["messages"].([]any)
	if len(ms) != 2 || ms[1].(map[string]any)["fromTeam"] != true || strings.Contains(toJSON(polled), "internal only") {
		t.Errorf("what the visitor sees: %v", polled)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "GET", conv, nil); c != 404 {
		t.Errorf("a stranger read the conversation: %d", c)
	}

	// email: signed, once, and a reply is queued for the worker
	body := `{"from":"dana@acme.com","subject":"Export broken","text":"Rows are missing.","messageId":"<one@mail>"}`
	if c := h.postEmail(ws, "wrong-key", body, time.Now()); c != 401 {
		t.Errorf("a wrong key: %d", c)
	}
	if c := h.postEmail(ws, key, body, time.Now().Add(-time.Hour)); c != 401 {
		t.Errorf("an old stamp: %d", c)
	}
	if c := h.postEmail(ws, key, body, time.Now()); c != 200 {
		t.Fatalf("email: %d", c)
	}
	if c := h.postEmail(ws, key, body, time.Now()); c != 200 {
		t.Errorf("the same email again: %d", c)
	}
	_, list, _ = h.do(h.bob, "GET", base+"/conversations?mine=false", nil)
	var emailConv string
	for _, c := range list["conversations"].([]any) {
		m := c.(map[string]any)
		if m["channel"] == "email" {
			emailConv = m["id"].(string)
		}
	}
	if len(list["conversations"].([]any)) != 2 || emailConv == "" {
		t.Fatalf("inbox after email: %v", list)
	}
	ec := base + "/conversations/" + emailConv
	_, d, _ := h.do(h.bob, "GET", ec, nil)
	if c, b, _ := h.do(h.bob, "POST", ec+"/reply", map[string]any{"body": "We are looking.", "seenMessageId": d["lastMessageId"]}); c != 201 {
		t.Fatalf("email reply: %d %v", c, b)
	}
	if len(h.mail.all()) != 0 {
		t.Fatal("the email went out before the worker ran")
	}
	_, d, _ = h.do(h.bob, "GET", ec, nil)
	th := d["thread"].([]any)
	replyID := th[len(th)-1].(map[string]any)["id"].(string)
	if err := h.inboxW.Work(context.Background(), &river.Job[inbox.ReplyArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: inbox.ReplyArgs{WorkspaceID: uuid.MustParse(ws), MessageID: uuid.MustParse(replyID), UserID: bobID}}); err != nil {
		t.Fatal(err)
	}
	var sent []string
	for _, m := range h.mail.all() {
		sent = append(sent, m.To[0]+"|"+m.Subject)
	}
	if len(sent) != 1 || !strings.HasPrefix(sent[0], "dana@acme.com|Re: Export broken [#") {
		t.Errorf("sent %v", sent)
	}

	// from conversation to the review queue, and back as a card
	m0 := th[0].(map[string]any)["id"].(string)
	c, cv, _ := h.do(h.bob, "POST", ec+"/messages/"+m0+"/convert", nil)
	if c != 200 || cv["sourceItemId"] == nil {
		t.Fatalf("convert: %d %v", c, cv)
	}
	_, d, _ = h.do(h.bob, "GET", ec, nil)
	if cards := d["cards"].([]any); len(cards) != 1 || cards[0].(map[string]any)["stage"] != "processing" {
		t.Errorf("cards %v", d["cards"])
	}
	// assignment and closing
	if c, _, _ := h.do(h.bob, "PUT", ec+"/assignee", map[string]any{"take": true, "expectedAssignee": uuid.NewString()}); c != 409 {
		t.Errorf("taking with the wrong view: %d", c)
	}
	if c, _, _ := h.do(h.bob, "PUT", ec+"/state", map[string]any{"state": "closed"}); c != 204 {
		t.Errorf("close: %d", c)
	}
	if c, _, _ := h.do(h.bob, "DELETE", ec, nil); c != 403 {
		t.Errorf("a member deleted: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", ec, nil); c != 204 {
		t.Errorf("an admin deleted: %d", c)
	}
	// switching the widget off ends it at once
	h.do(h.alice, "PUT", base+"/inbox/settings", map[string]any{"chatEnabled": false, "emailEnabled": true, "origins": []string{}})
	if c, _, _ := h.do("", "POST", pub+"/messages", msg); c != 404 {
		t.Errorf("a switched-off widget: %d", c)
	}
	_ = http.StatusOK
}
