package api

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/digest"
)

func TestWeeklyDigestSettingsOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Digest Co")
	base := "/v1/workspaces/" + ws + "/digest"
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	// defaults: off, Monday 09:00 UTC, nobody; and the admin is told email is not set up here
	code, st, _ := h.do(h.alice, "GET", base, nil)
	if code != 200 || st["enabled"] != false || st["weekday"].(float64) != 1 || st["hourUtc"].(float64) != 9 || len(st["recipients"].([]any)) != 0 || st["emailConfigured"] != false {
		t.Fatalf("defaults: %d %v", code, st)
	}
	put := map[string]any{"enabled": true, "weekday": 3, "hourUtc": 14, "recipients": []string{"Ana@Example.com", "bo@example.com"}, "recipientsConfirmed": true}
	// members can read and preview, only admins can change
	if c, _, _ := h.do(h.bob, "PUT", base, put); c != 403 {
		t.Errorf("a member changed the digest: %d", c)
	}
	if c, _, _ := h.do(h.bob, "GET", base, nil); c != 200 {
		t.Errorf("a member could not read it: %d", c)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "GET", base, nil); c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	// the confirmation is required to turn it on
	noConfirm := map[string]any{"enabled": true, "weekday": 3, "hourUtc": 14, "recipients": []string{"a@example.com"}}
	if c, _, _ := h.do(h.alice, "PUT", base, noConfirm); c != 400 {
		t.Errorf("enabled without confirming: %d", c)
	}
	for name, bad := range map[string]map[string]any{
		"hour out of range": {"enabled": false, "weekday": 3, "hourUtc": 24, "recipients": []string{}},
		"day out of range":  {"enabled": false, "weekday": 7, "hourUtc": 1, "recipients": []string{}},
		"unknown field":     {"enabled": false, "weekday": 3, "hourUtc": 1, "recipients": []string{}, "extra": 1},
		"not an address":    {"enabled": false, "weekday": 3, "hourUtc": 1, "recipients": []string{"nope"}},
	} {
		if c, _, _ := h.do(h.alice, "PUT", base, bad); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	code, saved, _ := h.do(h.alice, "PUT", base, put)
	recips := saved["recipients"].([]any)
	if code != 200 || saved["enabled"] != true || saved["weekday"].(float64) != 3 || len(recips) != 2 || recips[0].(map[string]any)["email"] != "ana@example.com" {
		t.Fatalf("saved: %d %v", code, saved)
	}

	// the preview shows what would be said and sends nothing
	h.activityFor(ws)
	code, pv, _ := h.do(h.bob, "GET", base+"/preview", nil)
	if code != 200 || !strings.Contains(pv["text"].(string), "Weekly digest for Digest Co") || !strings.Contains(pv["text"].(string), "1 new conversation") || pv["empty"] != false {
		t.Fatalf("preview: %d %v", code, pv)
	}
	if n := len(h.mail.all()); n != 0 {
		t.Errorf("the preview sent %d emails", n)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "GET", base+"/preview", nil); c != 404 {
		t.Errorf("a stranger's preview: %d", c)
	}
}

func (hn *harness) activityFor(ws string) {
	hn.t.Helper()
	if _, err := hn.db.Super.Exec(context.Background(), `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste','hello',$2,$3)`, ws, uuid.NewString(), uuid.New()); err != nil {
		hn.t.Fatal(err)
	}
}

func TestDigestUnsubscribeOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Unsub Digest")
	base := "/v1/workspaces/" + ws + "/digest"
	if c, b, _ := h.do(h.alice, "PUT", base, map[string]any{"enabled": true, "weekday": 1, "hourUtc": 9, "recipients": []string{"ana@example.com"}, "recipientsConfirmed": true}); c != 200 {
		t.Fatalf("save: %d %v", c, b)
	}
	var rid uuid.UUID
	if err := h.db.Super.QueryRow(context.Background(), `SELECT id FROM digest_recipient WHERE workspace_id=$1`, ws).Scan(&rid); err != nil {
		t.Fatal(err)
	}
	tok := digest.Unsubscriber{BaseURL: "https://app.example", Secret: []byte("http-test-secret-with-enough-length")}.Token(uuid.MustParse(ws), rid)

	// opening the link changes nothing and reveals only a masked address
	code, body, _ := h.do("", "GET", "/v1/public/digest/unsubscribe/"+tok, nil)
	if code != 200 || body["maskedEmail"] != "a***@example.com" {
		t.Fatalf("check: %d %v", code, body)
	}
	_, st, _ := h.do(h.alice, "GET", base, nil)
	if st["recipients"].([]any)[0].(map[string]any)["unsubscribed"] != false {
		t.Fatal("a GET unsubscribed someone")
	}
	for i := 0; i < 2; i++ {
		if c, _, _ := h.do("", "POST", "/v1/public/digest/unsubscribe/"+tok, nil); c != 204 {
			t.Fatalf("confirm %d: %d", i, c)
		}
	}
	_, st, _ = h.do(h.alice, "GET", base, nil)
	if st["recipients"].([]any)[0].(map[string]any)["unsubscribed"] != true {
		t.Error("not unsubscribed")
	}
	for _, bad := range []string{"x", strings.Repeat("A", 64), tok[:len(tok)-3] + "AAA"} {
		if c, _, _ := h.do("", "GET", "/v1/public/digest/unsubscribe/"+bad, nil); c != 404 && c != 400 {
			t.Errorf("bad link %q: %d", bad, c)
		}
		if c, _, _ := h.do("", "POST", "/v1/public/digest/unsubscribe/"+bad, nil); c != 404 && c != 400 {
			t.Errorf("bad link %q: %d", bad, c)
		}
	}
	// the token is not echoed into the access log
	if strings.Contains(h.logs.String(), tok) {
		t.Error("the digest unsubscribe token reached the logs")
	}
}
