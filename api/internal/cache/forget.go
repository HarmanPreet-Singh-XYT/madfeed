package cache

import (
	"context"
	"log/slog"
	"time"
)

// retryDelays is how long a failed invalidation waits before trying again. A variable so tests can shorten it.
var retryDelays = []time.Duration{500 * time.Millisecond, 2 * time.Second, 6 * time.Second, 15 * time.Second}

// retrySlots bounds how many invalidations may be retrying at once, so an outage cannot pile up goroutines.
var retrySlots = make(chan struct{}, 256)

// Persist runs fn (a delete or a set that other readers rely on). If Redis cannot take it right now, the failure
// is logged and fn is retried in the background for about 25 seconds, which covers a short outage. An entry
// that is still readable after that expires on its own within its TTL. kind names what was being changed, for
// the log; it never contains an id or a key.
func Persist(ctx context.Context, kind string, fn func(ctx context.Context) error) {
	err := fn(context.WithoutCancel(ctx))
	if err == nil {
		return
	}
	slog.Warn("cache: could not apply a change; retrying", "kind", kind, "error", err)
	select {
	case retrySlots <- struct{}{}:
	default:
		slog.Error("cache: too many changes waiting to be retried; the entry may stay until it expires", "kind", kind)
		return
	}
	go func() {
		defer func() { <-retrySlots }()
		for _, d := range retryDelays {
			time.Sleep(d)
			if fn(context.Background()) == nil {
				return
			}
		}
		slog.Error("cache: gave up applying a change; the entry may stay until it expires", "kind", kind)
	}()
}

func del(ctx context.Context, c Store, kind string, keys ...string) {
	if c == nil || len(keys) == 0 {
		return
	}
	Persist(ctx, kind, func(ctx context.Context) error { return c.Del(ctx, keys...) })
}
