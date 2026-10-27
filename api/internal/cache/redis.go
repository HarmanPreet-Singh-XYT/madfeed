package cache

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultTimeout   = 50 * time.Millisecond // a slow cache must never slow the product
	breakerThreshold = 3                     // consecutive failures before Redis is skipped
	breakerPause     = 5 * time.Second
)

// hit counts an event and makes sure the key always expires, even if an earlier
// call died between INCR and PEXPIRE.
var hit = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
local t = redis.call('PTTL', KEYS[1])
if n == 1 or t < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {n, t}`)

// Redis is a Store backed by Redis. Every call has a short timeout, and after
// repeated failures calls return ErrUnavailable straight away for a few seconds,
// so an outage costs speed, never availability.
type Redis struct {
	rdb     *redis.Client
	prefix  string
	timeout time.Duration

	mu        sync.Mutex
	failures  int
	skipUntil time.Time
	wasOpen   bool
	now       func() time.Time
	log       *slog.Logger

	hits, misses, errs, skipped atomic.Int64
}

// Stats are counts since the process started, for the metrics page.
type Stats struct {
	Hits, Misses, Errors, Skipped int64
	BreakerOpen                   bool
}

// Stats reports how the cache has been doing.
func (r *Redis) Stats() Stats {
	r.mu.Lock()
	open := r.now().Before(r.skipUntil)
	r.mu.Unlock()
	return Stats{r.hits.Load(), r.misses.Load(), r.errs.Load(), r.skipped.Load(), open}
}

// NewRedis connects to the redis:// or rediss:// URL. Keys are namespaced with
// prefix so one Redis can serve several environments.
func NewRedis(url, prefix string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		// The parser's message repeats the whole address, password included; never pass it on.
		return nil, errors.New("cache: REDIS_URL is not a valid redis:// or rediss:// address")
	}
	opt.MaxRetries = 0 // retries would break the timeout budget; the breaker handles repeats
	opt.DialTimeout = defaultTimeout * 4
	opt.ReadTimeout = defaultTimeout
	opt.WriteTimeout = defaultTimeout
	return &Redis{rdb: redis.NewClient(opt), prefix: prefix + ":", timeout: defaultTimeout, now: time.Now, log: slog.Default()}, nil
}

// Close releases the connection pool.
func (r *Redis) Close() error { return r.rdb.Close() }

// Ping checks the connection, for the readiness report.
func (r *Redis) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, r.timeout*4)
	defer cancel()
	return r.rdb.Ping(ctx).Err()
}

// allow says whether Redis may be tried now.
func (r *Redis) allow() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.now().After(r.skipUntil)
}

// record feeds the breaker. A success closes it; enough failures in a row open it. Both changes are logged,
// because otherwise a cache that has quietly switched itself off looks like a slow database.
func (r *Redis) record(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err == nil || errors.Is(err, redis.Nil) {
		r.failures = 0
		if r.wasOpen {
			r.wasOpen = false
			r.log.Info("redis cache is answering again")
		}
		return
	}
	r.errs.Add(1)
	r.failures++
	if r.failures >= breakerThreshold {
		r.skipUntil = r.now().Add(breakerPause)
		r.failures = 0
		if !r.wasOpen {
			r.wasOpen = true
			r.log.Warn("redis cache is not answering; using Postgres for now", "pause", breakerPause.String())
		}
	}
}

func (r *Redis) do(ctx context.Context, fn func(ctx context.Context) error) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err) // the caller already gave up; Redis is not at fault
	}
	if !r.allow() {
		r.skipped.Add(1)
		return ErrUnavailable
	}
	cctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	err := fn(cctx)
	if err != nil && !errors.Is(err, redis.Nil) && ctx.Err() != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err) // the caller hung up mid-call: not counted against Redis
	}
	r.record(err)
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return err
}

func (r *Redis) Get(ctx context.Context, key string) ([]byte, bool, error) {
	var out []byte
	err := r.do(ctx, func(ctx context.Context) (err error) {
		out, err = r.rdb.Get(ctx, r.prefix+key).Bytes()
		return
	})
	if errors.Is(err, redis.Nil) {
		r.misses.Add(1)
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	r.hits.Add(1)
	return out, true, nil
}

func (r *Redis) Set(ctx context.Context, key string, val []byte, ttl time.Duration) error {
	return r.do(ctx, func(ctx context.Context) error { return r.rdb.Set(ctx, r.prefix+key, val, ttl).Err() })
}

func (r *Redis) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	full := make([]string, len(keys))
	for i, k := range keys {
		full[i] = r.prefix + k
	}
	return r.do(ctx, func(ctx context.Context) error { return r.rdb.Del(ctx, full...).Err() })
}

func (r *Redis) Hit(ctx context.Context, key string, window time.Duration) (int, time.Duration, error) {
	var res []int64
	err := r.do(ctx, func(ctx context.Context) (err error) {
		res, err = hit.Run(ctx, r.rdb, []string{r.prefix + key}, window.Milliseconds()).Int64Slice()
		return
	})
	if err != nil {
		return 0, 0, err
	}
	if len(res) != 2 {
		return 0, 0, fmt.Errorf("%w: unexpected reply", ErrUnavailable)
	}
	return int(res[0]), time.Duration(res[1]) * time.Millisecond, nil
}
