package ratelimit

import (
	"net/http/httptest"
	"testing"
)

func TestIPv6IsBucketedByNetwork(t *testing.T) {
	a := httptest.NewRequest("GET", "/", nil)
	a.RemoteAddr = "[2001:db8:1:2:aaaa::1]:5000"
	b := httptest.NewRequest("GET", "/", nil)
	b.RemoteAddr = "[2001:db8:1:2:bbbb::9]:6000"
	c := httptest.NewRequest("GET", "/", nil)
	c.RemoteAddr = "[2001:db8:1:3::1]:6000"
	if ClientIP(a, 0) != ClientIP(b, 0) {
		t.Error("two hosts in one /64 got different buckets")
	}
	if ClientIP(a, 0) == ClientIP(c, 0) {
		t.Error("different /64 networks share a bucket")
	}
	v4 := httptest.NewRequest("GET", "/", nil)
	v4.RemoteAddr = "203.0.113.7:1234"
	if ClientIP(v4, 0) != "203.0.113.7" {
		t.Errorf("IPv4 changed: %s", ClientIP(v4, 0))
	}
}

func TestLocalFallbackStillLimits(t *testing.T) {
	var l Limiter
	allowed := 0
	for i := 0; i < 10; i++ {
		if l.local("x", 3, 60).Allowed {
			allowed++
		}
	}
	if allowed != 3 {
		t.Errorf("allowed %d, want 3", allowed)
	}
	if l.local("y", 3, 60).Allowed != true {
		t.Error("another bucket was affected")
	}
}
