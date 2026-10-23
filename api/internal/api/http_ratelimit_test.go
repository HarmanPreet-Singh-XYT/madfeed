package api

import (
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestSignedInCallersAreThrottledPerPersonAndReadsMoreLooselyThanChanges(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Throttle")
	h.setLimits(Limits{ReadPerMinute: 6, WritePerMinute: 3, PublicPerMinute: 100000})
	h.clearCounters() // the set-up above was counted too
	base := "/v1/workspaces/" + ws

	// Changes: three go through, the fourth is refused with a wait time.
	for i := 0; i < 3; i++ {
		if code, _, _ := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "t" + strconv.Itoa(i)}); code != 201 {
			t.Fatalf("change %d: %d", i, code)
		}
	}
	code, body, hdr := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "too many"})
	if code != 429 || body["error"].(map[string]any)["code"] != "rate_limited" || hdr.Get("Retry-After") == "" {
		t.Fatalf("fourth change: %d %v %v", code, body, hdr)
	}
	if n, _ := strconv.Atoi(hdr.Get("Retry-After")); n < 1 || n > 60 {
		t.Errorf("Retry-After %q", hdr.Get("Retry-After"))
	}
	// Reads have their own, larger allowance and are unaffected by the changes above.
	for i := 0; i < 6; i++ {
		if code, _, _ := h.do(h.alice, "GET", base+"/tags", nil); code != 200 {
			t.Fatalf("read %d: %d", i, code)
		}
	}
	if code, _, _ := h.do(h.alice, "GET", base+"/tags", nil); code != 429 {
		t.Fatalf("seventh read: %d", code)
	}
	// Someone else is not slowed down by alice.
	if code, _, _ := h.do(h.bob, "GET", "/v1/workspaces", nil); code != 200 {
		t.Fatalf("bob: %d", code)
	}
	// A refused request changed nothing.
	h.setLimits(Limits{})
	_, tags, _ := h.do(h.alice, "GET", base+"/tags", nil)
	if n := len(tags["tags"].([]any)); n != 3 {
		t.Errorf("tags: %d", n)
	}
	// Monitoring is never throttled.
	h.setLimits(Limits{ReadPerMinute: 1, WritePerMinute: 1, PublicPerMinute: 1})
	for i := 0; i < 5; i++ {
		for _, p := range []string{"/healthz", "/readyz"} {
			r := httptest.NewRequest("GET", p, nil)
			rec := httptest.NewRecorder()
			h.h.ServeHTTP(rec, r)
			if rec.Code == 429 {
				t.Fatalf("%s was throttled", p)
			}
		}
	}
}

func TestPublicRoutesAreThrottledPerAddressAndAForgedForwardingHeaderChangesNothing(t *testing.T) {
	h := newHarness(t)
	h.setLimits(Limits{PublicPerMinute: 3})
	get := func(ip, forwarded string) int {
		r := httptest.NewRequest("GET", "/v1/public/releases/nobody-here", nil)
		r.RemoteAddr = ip + ":1234"
		if forwarded != "" {
			r.Header.Set("X-Forwarded-For", forwarded)
		}
		rec := httptest.NewRecorder()
		h.h.ServeHTTP(rec, r)
		return rec.Code
	}
	for i := 0; i < 3; i++ {
		if code := get("198.51.100.1", ""); code == 429 {
			t.Fatalf("request %d was throttled too early", i)
		}
	}
	if code := get("198.51.100.1", ""); code != 429 {
		t.Fatalf("fourth request from one address: %d", code)
	}
	// Pretending to be someone else with a header does not help when no proxy of ours is trusted.
	for i := 0; i < 3; i++ {
		if code := get("198.51.100.1", "203.0.113."+strconv.Itoa(i)); code != 429 {
			t.Fatalf("a forged header bought a request: %d", code)
		}
	}
	// A different address has its own allowance.
	if code := get("198.51.100.2", ""); code == 429 {
		t.Fatal("another address was throttled")
	}
	// Behind one trusted proxy the forwarded address is believed instead.
	h.setLimits(Limits{PublicPerMinute: 1, TrustedHops: 1})
	if code := get("10.0.0.1", "203.0.113.50"); code == 429 {
		t.Fatal("first request throttled")
	}
	if code := get("10.0.0.1", "203.0.113.50"); code != 429 {
		t.Fatal("same real client not throttled")
	}
	if code := get("10.0.0.1", "203.0.113.51"); code == 429 {
		t.Fatal("a different real client behind the same proxy was throttled")
	}
	// The delivery-report endpoint has its own, higher allowance and still requires a signature.
	h.setLimits(Limits{WebhookPerMinute: 2})
	post := func() int {
		r := httptest.NewRequest("POST", "/v1/webhooks/resend", strings.NewReader("{}"))
		r.RemoteAddr = "198.51.100.3:1"
		rec := httptest.NewRecorder()
		h.h.ServeHTTP(rec, r)
		return rec.Code
	}
	if post() != 401 || post() != 401 || post() != 429 {
		t.Error("webhook throttling")
	}
}
