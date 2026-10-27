// Package cache is the API's shared, optional cache. It exists so instances can
// stay stateless: anything worth remembering between requests lives in Redis, not
// in a process. It is only ever a cache. Postgres stays the source of truth, every
// caller must work when the cache is empty or down, and nothing personal is
// stored here (ids, roles, plan state and counters only).
package cache

import (
	"context"
	"errors"
	"time"
)

// ErrUnavailable means the cache could not answer (not configured, down, or
// skipped by the circuit breaker). Callers go to the database instead.
var ErrUnavailable = errors.New("cache unavailable")

// Store is the cache. A missing key is not an error: Get reports ok=false.
type Store interface {
	Get(ctx context.Context, key string) (val []byte, ok bool, err error)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
	// Hit counts one event against key in a window that starts at the first hit and
	// lasts `window`. It returns the count so far and the time left in the window.
	Hit(ctx context.Context, key string, window time.Duration) (hits int, left time.Duration, err error)
}

// Nop is the Store used when no cache is configured: every read misses and
// every write is dropped, so callers behave exactly as they did before caching.
type Nop struct{}

func (Nop) Get(context.Context, string) ([]byte, bool, error)        { return nil, false, nil }
func (Nop) Set(context.Context, string, []byte, time.Duration) error { return nil }
func (Nop) Del(context.Context, ...string) error                     { return nil }
func (Nop) Hit(context.Context, string, time.Duration) (int, time.Duration, error) {
	return 0, 0, ErrUnavailable
}
