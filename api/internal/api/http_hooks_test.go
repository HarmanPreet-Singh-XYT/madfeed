package api

import (
	"context"
	"strings"
	"testing"
)

func TestWebhooksOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Hooks Co")
	base := "/v1/workspaces/" + ws + "/webhooks"

	// the address must be https and public
	for _, u := range []string{"http://example.com/h", "https://localhost/h", "https://10.1.2.3/h"} {
		if c, _, _ := h.do(h.alice, "POST", base, map[string]any{"url": u, "events": []string{"request.created"}}); c != 400 {
			t.Errorf("%s: %d", u, c)
		}
	}
	if c, _, _ := h.do(h.alice, "POST", base, map[string]any{"url": "https://example.com/h", "events": []string{"nope"}}); c != 400 {
		t.Errorf("unknown event: %d", c)
	}

	c, created, body := h.do(h.alice, "POST", base, map[string]any{"url": "https://example.com/h", "description": "Zap", "events": []string{"request.created", "request.status_changed"}})
	if c != 201 {
		t.Fatalf("create: %d %v", c, body)
	}
	secret, _ := created["secret"].(string)
	id := created["endpoint"].(map[string]any)["id"].(string)
	if !strings.HasPrefix(secret, "whsec_") {
		t.Fatalf("secret %q", secret)
	}

	// the list never shows the secret again
	c, raw, _ := h.rawJSON(h.alice, "GET", base, "", nil)
	if c != 200 || strings.Contains(raw, secret) || strings.Contains(raw, "secret") {
		t.Fatalf("list leaks: %d %s", c, raw)
	}
	_, got, _ := h.do(h.alice, "GET", base, nil)
	if len(got["endpoints"].([]any)) != 1 || len(got["events"].([]any)) < 4 {
		t.Errorf("list %v", got)
	}

	// edit, test, history, rotate
	if c, _, _ := h.do(h.alice, "PUT", base+"/"+id, map[string]any{"url": "https://example.com/v2", "events": []string{"request.created"}, "enabled": true}); c != 204 {
		t.Errorf("update: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", base+"/"+id+"/test", nil); c != 202 {
		t.Errorf("test: %d", c)
	}
	_, ds, _ := h.do(h.alice, "GET", base+"/"+id+"/deliveries", nil)
	if l := ds["deliveries"].([]any); len(l) != 1 || l[0].(map[string]any)["eventType"] != "ping" || l[0].(map[string]any)["state"] != "pending" {
		t.Errorf("deliveries %v", ds)
	}
	c, rot, _ := h.do(h.alice, "POST", base+"/"+id+"/secret", nil)
	if c != 200 || rot["secret"] == secret || !strings.HasPrefix(rot["secret"].(string), "whsec_") {
		t.Errorf("rotate: %d %v", c, rot)
	}

	// anonymous and another workspace's people get nothing
	if c, _, _ := h.do("", "GET", base, nil); c != 401 {
		t.Errorf("anonymous: %d", c)
	}
	for _, call := range [][2]string{{"GET", base}, {"GET", base + "/" + id + "/deliveries"}, {"DELETE", base + "/" + id}, {"POST", base + "/" + id + "/secret"}, {"POST", base + "/" + id + "/test"}} {
		if c, _, _ := h.do(h.bob, call[0], call[1], nil); c != 403 && c != 404 {
			t.Errorf("stranger %v: %d", call, c)
		}
	}

	if c, _, _ := h.do(h.alice, "DELETE", base+"/"+id, nil); c != 204 {
		t.Errorf("delete: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", base+"/"+id, nil); c != 404 {
		t.Errorf("delete twice: %d", c)
	}
}

func TestRealChangesQueueTheirMessages(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Hooks Co")
	base := "/v1/workspaces/" + ws
	all := []string{"request.created", "request.status_changed", "suggestions.ready", "release_note.published", "survey.response_completed"}
	if c, _, b := h.do(h.alice, "POST", base+"/webhooks", map[string]any{"url": "https://example.com/h", "events": all}); c != 201 {
		t.Fatalf("%d %v", c, b)
	}
	count := func(typ string) (n int) {
		_ = h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM outbound_delivery WHERE workspace_id = $1 AND event_type = $2`, ws, typ).Scan(&n)
		return
	}

	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	// the first accepted quote starts a request; the second joins it and is not a new request
	req := h.requestFrom(h.alice, ws, "dana@acme.com", "raj@acme.com")
	if count("request.created") != 1 {
		t.Errorf("request.created: %d", count("request.created"))
	}

	planned := h.statusID(h.alice, ws, "Planned")
	h.do(h.alice, "PUT", base+"/requests/"+req+"/status", map[string]any{"statusId": planned})
	h.do(h.alice, "PUT", base+"/requests/"+req+"/status", map[string]any{"statusId": planned}) // no change, no message
	if count("request.status_changed") != 1 {
		t.Errorf("status changes: %d", count("request.status_changed"))
	}
	var payload string
	_ = h.db.Super.QueryRow(context.Background(), `SELECT payload::text FROM outbound_delivery WHERE workspace_id = $1 AND event_type = 'request.status_changed'`, ws).Scan(&payload)
	if !strings.Contains(payload, `"toStatusName": "Planned"`) && !strings.Contains(payload, `"toStatusName":"Planned"`) {
		t.Errorf("payload %s", payload)
	}
	if strings.Contains(payload, "SSO for our team") {
		t.Errorf("a customer's words are in the message: %s", payload)
	}

	_, created, _ := h.do(h.alice, "POST", base+"/release-notes", map[string]any{"title": "SSO is here", "body": "Sign in with your company account."})
	note := created["id"].(string)
	h.do(h.alice, "POST", base+"/release-notes/"+note+"/publish", nil)
	if count("release_note.published") != 1 {
		t.Errorf("release note: %d", count("release_note.published"))
	}
}
