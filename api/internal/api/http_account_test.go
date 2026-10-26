package api

import (
	"context"
	"testing"
)

func TestAPersonCanAskForTheirAccountToBeDeletedAndTakeItBack(t *testing.T) {
	h := newHarness(t)
	open := func(tok string) bool {
		code, b, _ := h.do(tok, "GET", "/v1/account/deletion-request", nil)
		if code != 200 {
			t.Fatalf("status: %d %v", code, b)
		}
		return b["open"].(bool)
	}
	if open(h.alice) {
		t.Fatal("a request exists before anyone asked")
	}
	code, first, _ := h.do(h.alice, "POST", "/v1/account/deletion-request", nil)
	if code != 200 {
		t.Fatalf("request: %d %v", code, first)
	}
	// asking again keeps the first request; it does not queue a second
	if code, again, _ := h.do(h.alice, "POST", "/v1/account/deletion-request", nil); code != 200 || again["requestedAt"] != first["requestedAt"] {
		t.Errorf("second ask: %d %v vs %v", code, again, first)
	}
	var n int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM account_deletion_request WHERE user_id=$1 AND status='open'`, h.aliceID).Scan(&n)
	if n != 1 {
		t.Errorf("%d open requests", n)
	}
	if !open(h.alice) {
		t.Error("the request is not shown")
	}
	if open(h.bob) {
		t.Error("someone else's request is visible")
	}
	// bob taking his own back does not touch alice's
	h.do(h.bob, "DELETE", "/v1/account/deletion-request", nil)
	if !open(h.alice) {
		t.Error("another person cancelled it")
	}
	if code, _, _ := h.do(h.alice, "DELETE", "/v1/account/deletion-request", nil); code != 204 {
		t.Errorf("cancel: %d", code)
	}
	if open(h.alice) {
		t.Error("still open after cancelling")
	}
	if code, _, _ := h.do(h.alice, "POST", "/v1/account/deletion-request", nil); code != 200 {
		t.Errorf("asking again after cancelling: %d", code)
	}
	if code, _, _ := h.do("", "GET", "/v1/account/deletion-request", nil); code != 401 {
		t.Errorf("without signing in: %d", code)
	}
}
