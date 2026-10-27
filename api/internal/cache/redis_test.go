package cache

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
)

var ctx = context.Background()

func newTest(t *testing.T) (*Redis, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	r, err := NewRedis("redis://"+mr.Addr(), "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r, mr
}

func TestSetGetDelAndAMissIsNotAnError(t *testing.T) {
	r, _ := newTest(t)
	if _, ok, err := r.Get(ctx, "k"); ok || err != nil {
		t.Fatalf("empty cache: ok=%v err=%v", ok, err)
	}
	if err := r.Set(ctx, "k", []byte("v"), time.Minute); err != nil {
		t.Fatal(err)
	}
	if v, ok, _ := r.Get(ctx, "k"); !ok || string(v) != "v" {
		t.Fatalf("got %q ok=%v", v, ok)
	}
	if err := r.Del(ctx, "k", "other"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.Get(ctx, "k"); ok {
		t.Fatal("key survived Del")
	}
}

func TestKeysAreNamespaced(t *testing.T) {
	r, mr := newTest(t)
	_ = r.Set(ctx, "k", []byte("v"), time.Minute)
	if !mr.Exists("test:k") || mr.Exists("k") {
		t.Fatalf("keys: %v", mr.Keys())
	}
}

func TestHitCountsWithinAWindowAndExpires(t *testing.T) {
	r, mr := newTest(t)
	for want := 1; want <= 3; want++ {
		n, left, err := r.Hit(ctx, "w", 10*time.Second)
		if err != nil || n != want || left <= 0 || left > 10*time.Second {
			t.Fatalf("hit %d: n=%d left=%v err=%v", want, n, left, err)
		}
	}
	mr.FastForward(11 * time.Second)
	if n, _, _ := r.Hit(ctx, "w", 10*time.Second); n != 1 {
		t.Fatalf("window did not reset: %d", n)
	}
}

func TestAKeyWithoutAnExpiryGetsOne(t *testing.T) {
	r, mr := newTest(t)
	_ = mr.Set("test:orphan", "5") // an earlier call died between INCR and PEXPIRE
	if n, left, err := r.Hit(ctx, "orphan", 10*time.Second); err != nil || n != 6 || left <= 0 {
		t.Fatalf("n=%d left=%v err=%v", n, left, err)
	}
	if mr.TTL("test:orphan") <= 0 {
		t.Fatal("key still has no expiry")
	}
}

func TestOutageReturnsUnavailableThenTheBreakerSkipsRedis(t *testing.T) {
	r, mr := newTest(t)
	clock := time.Now()
	r.now = func() time.Time { return clock }
	mr.Close()
	for i := 0; i < breakerThreshold; i++ {
		if _, _, err := r.Get(ctx, "k"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if r.allow() {
		t.Fatal("breaker did not open")
	}
	began := time.Now()
	if _, _, err := r.Hit(ctx, "k", time.Second); !errors.Is(err, ErrUnavailable) || time.Since(began) > 5*time.Millisecond {
		t.Fatalf("open breaker should fail at once: %v after %v", err, time.Since(began))
	}
	clock = clock.Add(breakerPause + time.Second)
	if !r.allow() {
		t.Fatal("breaker did not close after the pause")
	}
}

func TestNopMissesAndCannotCount(t *testing.T) {
	var n Nop
	if _, ok, err := n.Get(ctx, "k"); ok || err != nil {
		t.Fatal("Nop must miss quietly")
	}
	if _, _, err := n.Hit(ctx, "k", time.Second); !errors.Is(err, ErrUnavailable) {
		t.Fatal("Nop cannot count, so callers must fall back")
	}
}

// Run with REDIS_TEST_URL=redis://127.0.0.1:63790 (make dev-redis) to check the script and timeouts against a real server.
func TestAgainstARealRedis(t *testing.T) {
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("set REDIS_TEST_URL to run against a real Redis")
	}
	r, err := NewRedis(url, "realtest-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	if err := r.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	for want := 1; want <= 3; want++ {
		n, left, err := r.Hit(ctx, "w", 2*time.Second)
		if err != nil || n != want || left <= 0 || left > 2*time.Second {
			t.Fatalf("hit %d: n=%d left=%v err=%v", want, n, left, err)
		}
	}
	time.Sleep(2100 * time.Millisecond)
	if n, _, _ := r.Hit(ctx, "w", 2*time.Second); n != 1 {
		t.Fatalf("window did not reset: %d", n)
	}
	if err := r.Set(ctx, "k", []byte("v"), time.Minute); err != nil {
		t.Fatal(err)
	}
	if v, ok, _ := r.Get(ctx, "k"); !ok || string(v) != "v" {
		t.Fatalf("get: %q %v", v, ok)
	}
	if err := r.Del(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.Get(ctx, "k"); ok {
		t.Fatal("Del did not delete")
	}
}
