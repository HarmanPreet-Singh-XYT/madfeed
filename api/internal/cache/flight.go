package cache

import (
	"context"
	"time"

	"golang.org/x/sync/singleflight"
)

// Flight lets many callers that all missed the cache on the same key share one database lookup, so a hot entry
// expiring costs one query, not one per waiting request.
type Flight struct{ g singleflight.Group }

// loadTimeout bounds a shared lookup. It runs detached from any one caller, so one client hanging up cannot
// fail the others that are waiting on the same answer.
const loadTimeout = 5 * time.Second

// Load runs fn once for all concurrent callers with the same key. The context passed to fn ignores the
// caller's cancellation but keeps its values (tenant, request id).
func Load[T any](ctx context.Context, f *Flight, key string, fn func(ctx context.Context) (T, error)) (T, error) {
	v, err, _ := f.g.Do(key, func() (any, error) {
		c, cancel := context.WithTimeout(context.WithoutCancel(ctx), loadTimeout)
		defer cancel()
		return fn(c)
	})
	if v == nil {
		var zero T
		return zero, err
	}
	return v.(T), err
}
