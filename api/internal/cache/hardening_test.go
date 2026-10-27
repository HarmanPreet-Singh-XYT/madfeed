package cache

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestABadAddressNeverEchoesItsPassword(t *testing.T) {
	_, err := NewRedis("redis://default:SuperSecret123@host:notaport/0", "x")
	if err == nil {
		t.Fatal("a bad address was accepted")
	}
	if strings.Contains(err.Error(), "SuperSecret123") || strings.Contains(err.Error(), "host") {
		t.Fatalf("the error repeats the address: %v", err)
	}
}

func TestClientsThatHangUpDoNotCountAgainstRedis(t *testing.T) {
	r, _ := newTest(t)
	for i := 0; i < 3*breakerThreshold; i++ {
		c, cancel := context.WithCancel(ctx)
		cancel()
		if _, _, err := r.Get(c, "k"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("a cancelled call returned %v", err)
		}
	}
	if !r.allow() {
		t.Fatal("hung-up clients opened the breaker on a healthy Redis")
	}
	if st := r.Stats(); st.Errors != 0 {
		t.Fatalf("they were counted as Redis errors: %+v", st)
	}
	// A call that is cancelled while Redis is working is not Redis's fault either.
	if err := r.Set(ctx, "k", []byte("v"), time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.Get(ctx, "k"); !ok {
		t.Fatal("a normal read failed after the cancelled ones")
	}
}

func TestStatsCountHitsMissesErrorsAndSkippedCalls(t *testing.T) {
	r, mr := newTest(t)
	_ = r.Set(ctx, "a", []byte("1"), time.Minute)
	r.Get(ctx, "a")
	r.Get(ctx, "missing")
	mr.Close()
	for i := 0; i < breakerThreshold+2; i++ {
		r.Get(ctx, "a")
	}
	st := r.Stats()
	if st.Hits != 1 || st.Misses != 1 || st.Errors != int64(breakerThreshold) || st.Skipped != 2 || !st.BreakerOpen {
		t.Fatalf("%+v", st)
	}
}

func TestOnlyValuesWeSignedAreBelieved(t *testing.T) {
	r, mr := newTest(t)
	s := Sign(r, []byte("server-secret"))
	if err := s.Set(ctx, "tenant:1", []byte("admin"), time.Minute); err != nil {
		t.Fatal(err)
	}
	if v, ok, _ := s.Get(ctx, "tenant:1"); !ok || string(v) != "admin" {
		t.Fatalf("our own value: %q %v", v, ok)
	}
	// Someone with write access to Redis plants a value, with or without a made-up signature.
	_ = mr.Set("test:tenant:2", "admin")
	_ = mr.Set("test:tenant:3", strings.Repeat("x", macLen)+"admin")
	for _, k := range []string{"tenant:2", "tenant:3"} {
		if _, ok, _ := s.Get(ctx, k); ok {
			t.Errorf("a planted value under %s was believed", k)
		}
	}
	// A real entry copied under another key is refused: the signature covers the key.
	raw, _ := mr.Get("test:tenant:1")
	_ = mr.Set("test:tenant:9", raw)
	if _, ok, _ := s.Get(ctx, "tenant:9"); ok {
		t.Error("an entry copied to another key was believed")
	}
	// A different secret reads nothing.
	if _, ok, _ := Sign(r, []byte("another-secret")).Get(ctx, "tenant:1"); ok {
		t.Error("a value signed with another secret was believed")
	}
	// Tampering with the value breaks it.
	b := []byte(raw)
	b[len(b)-1] ^= 1
	_ = mr.Set("test:tenant:1", string(b))
	if _, ok, _ := s.Get(ctx, "tenant:1"); ok {
		t.Error("a tampered value was believed")
	}
	// Counting is unaffected.
	if n, _, err := s.Hit(ctx, "c", time.Minute); err != nil || n != 1 {
		t.Errorf("Hit through the wrapper: %d %v", n, err)
	}
}

func TestSharedLookupsRunOnceAndNobodyIsFailedByAnotherCallersCancel(t *testing.T) {
	var f Flight
	var runs atomic.Int32
	release := make(chan struct{})
	var wg sync.WaitGroup
	results := make([]int, 5)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := ctx
			if i == 0 {
				var cancel context.CancelFunc
				c, cancel = context.WithCancel(ctx)
				defer cancel()
				go func() { time.Sleep(20 * time.Millisecond); cancel() }()
			}
			v, err := Load(c, &f, "k", func(ctx context.Context) (int, error) {
				runs.Add(1)
				<-release
				return 42, ctx.Err()
			})
			if err != nil {
				t.Errorf("caller %d: %v", i, err)
			}
			results[i] = v
		}()
	}
	time.Sleep(80 * time.Millisecond)
	close(release)
	wg.Wait()
	if runs.Load() != 1 {
		t.Fatalf("the lookup ran %d times", runs.Load())
	}
	for i, v := range results {
		if v != 42 {
			t.Errorf("caller %d got %d", i, v)
		}
	}
}

func TestAChangeThatFailsDuringAnOutageIsAppliedWhenRedisIsBack(t *testing.T) {
	old := retryDelays
	retryDelays = []time.Duration{20 * time.Millisecond, 40 * time.Millisecond, 400 * time.Millisecond}
	t.Cleanup(func() { retryDelays = old })

	r, mr := newTest(t)
	var clock atomic.Int64
	clock.Store(time.Now().UnixNano())
	r.now = func() time.Time { return time.Unix(0, clock.Load()) }
	_ = r.Set(ctx, "tenant:x", []byte("admin"), time.Minute)
	// Redis drops out: three failures open the breaker, so the delete cannot be sent.
	addr := mr.Addr()
	mr.Close()
	for i := 0; i < breakerThreshold; i++ {
		r.Get(ctx, "x")
	}
	done := make(chan struct{})
	go func() { ForgetTenant(ctx, r, [16]byte{}, [16]byte{}); close(done) }()
	<-done

	// Bring Redis back at the same address with the entry still in it, and let the breaker pause pass.
	if err := mr.StartAddr(addr); err != nil {
		t.Skip("could not restart the test server on the same port: ", err)
	}
	_ = mr.Set("test:"+TenantKey([16]byte{}, [16]byte{}), "admin")
	clock.Add(int64(breakerPause + time.Second))
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !mr.Exists("test:" + TenantKey([16]byte{}, [16]byte{})) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the delete that failed during the outage was never applied")
}
