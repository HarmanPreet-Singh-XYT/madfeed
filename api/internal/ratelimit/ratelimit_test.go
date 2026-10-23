package ratelimit_test

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"product/api/internal/ratelimit"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func TestACallerIsLimitedPerWindowAndOthersAreNot(t *testing.T) {
	db := testdb.New(t)
	l := &ratelimit.Limiter{Pool: db.Backend, Secret: []byte("test-secret")}
	for i := 1; i <= 3; i++ {
		if d := l.Allow(ctx, "t1", "alice", 3, 60); !d.Allowed {
			t.Fatalf("request %d of 3 refused", i)
		}
	}
	d := l.Allow(ctx, "t1", "alice", 3, 60)
	if d.Allowed || d.RetryAfter < 1 || d.RetryAfter > 60 {
		t.Fatalf("the fourth request: %+v", d)
	}
	if !l.Allow(ctx, "t1", "bob", 3, 60).Allowed {
		t.Error("another caller was limited by alice's traffic")
	}
	if !l.Allow(ctx, "t2", "alice", 3, 60).Allowed {
		t.Error("another limit was affected")
	}
	// The next window starts fresh.
	for i := 0; i < 2; i++ {
		l.Allow(ctx, "short", "carol", 1, 1)
	}
	if l.Allow(ctx, "short", "carol", 1, 1).Allowed {
		t.Fatal("limit of 1 per second not enforced")
	}
	time.Sleep(1100 * time.Millisecond)
	if !l.Allow(ctx, "short", "carol", 1, 1).Allowed {
		t.Error("the limit did not reset with the next window")
	}
}

func TestTheCountIsExactUnderConcurrency(t *testing.T) {
	db := testdb.New(t)
	l := &ratelimit.Limiter{Pool: db.Backend, Secret: []byte("s")}
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if l.Allow(ctx, "race", "same", 25, 60).Allowed {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if allowed != 25 {
		t.Fatalf("%d of 60 simultaneous requests were let through, want exactly 25", allowed)
	}
}

func TestStoredBucketsDoNotRevealWhoCalled(t *testing.T) {
	db := testdb.New(t)
	l := &ratelimit.Limiter{Pool: db.Backend, Secret: []byte("s")}
	l.Allow(ctx, "priv", "203.0.113.77", 5, 60)
	var n int
	_ = db.Super.QueryRow(ctx, `SELECT count(*) FROM rate_limit WHERE bucket LIKE 'priv:%' AND bucket LIKE '%203.0.113%'`).Scan(&n)
	if n != 0 {
		t.Error("an address was stored in the clear")
	}
	_ = db.Super.QueryRow(ctx, `SELECT count(*) FROM rate_limit WHERE bucket LIKE 'priv:%'`).Scan(&n)
	if n != 1 {
		t.Errorf("buckets: %d", n)
	}
}

func TestDailyWindowsAreCountedInTheDatabase(t *testing.T) {
	db := testdb.New(t)
	l := &ratelimit.Limiter{Pool: db.Backend, Secret: []byte("s"), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	for i := 1; i <= 5; i++ {
		d := l.Allow(context.Background(), "daily", "who", 3, 86400)
		if d.Allowed != (i <= 3) {
			t.Fatalf("hit %d: allowed=%v", i, d.Allowed)
		}
	}
	var rows int
	if err := db.Super.QueryRow(context.Background(), `SELECT count(*) FROM rate_limit WHERE bucket LIKE 'daily:%'`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("the count was not kept in the database (rows=%d err=%v); the process-local fallback was used", rows, err)
	}
}

// (This one comes first: the test below closes the shared pool.)
func TestALimiterThatCannotReachTheDatabaseLetsRequestsThrough(t *testing.T) {
	db := testdb.New(t)
	pool := db.Backend
	l := &ratelimit.Limiter{Pool: pool, Secret: []byte("s")}
	pool.Close()
	if !l.Allow(ctx, "down", "x", 1, 60).Allowed {
		t.Error("the limiter took the product down with it")
	}
}

func TestOnlyTrustedProxiesCanSayWhereARequestCameFrom(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "198.51.100.9:4444"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.5")
	if got := ratelimit.ClientIP(r, 0); got != "198.51.100.9" {
		t.Errorf("no trusted proxy: %s (a forged header must be ignored)", got)
	}
	// One proxy of ours: the last entry is the address it saw; a client-supplied first entry is not believed.
	if got := ratelimit.ClientIP(r, 1); got != "203.0.113.5" {
		t.Errorf("one hop: %s", got)
	}
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 10.0.0.1, 203.0.113.5")
	if got := ratelimit.ClientIP(r, 2); got != "10.0.0.1" {
		t.Errorf("two hops: %s", got)
	}
	r.Header.Set("X-Forwarded-For", "not-an-ip")
	if got := ratelimit.ClientIP(r, 1); got != "198.51.100.9" {
		t.Errorf("garbage header: %s", got)
	}
	r.Header.Set("X-Forwarded-For", "")
	if got := ratelimit.ClientIP(r, 3); got != "198.51.100.9" {
		t.Errorf("more hops than entries: %s", got)
	}
	r.RemoteAddr = "[2001:db8::1]:80"
	if got := ratelimit.ClientIP(r, 0); !strings.HasPrefix(got, "2001:db8") {
		t.Errorf("ipv6: %s", got)
	}
}
