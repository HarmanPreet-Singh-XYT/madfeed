// Package ratelimit limits how often one caller may hit an endpoint. Counters
// live in Postgres (see migration 16), so the limit is shared by every API
// instance. If the database cannot be reached the request is allowed and the
// failure is logged: the limiter must never be the reason the product is down.
package ratelimit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Limiter struct {
	mu       sync.Mutex
	fallback map[string]*localWindow
	Pool     *pgxpool.Pool
	Secret   []byte // keys the hash of the caller, so stored buckets reveal nothing
	Log      *slog.Logger
}

// Decision says whether to let the request through and, if not, for how long to wait.
type Decision struct {
	Allowed    bool
	RetryAfter int // seconds
}

// Allow counts one request from `who` against `name` and says whether it is within `limit` per window.
func (l *Limiter) Allow(ctx context.Context, name, who string, limit, windowSeconds int) Decision {
	mac := hmac.New(sha256.New, l.Secret)
	mac.Write([]byte(who))
	bucket := name + ":" + hex.EncodeToString(mac.Sum(nil))[:24]
	var hits, retry int
	if err := l.Pool.QueryRow(ctx, `SELECT hits, retry_after FROM rate_hit($1, $2)`, bucket, windowSeconds).Scan(&hits, &retry); err != nil {
		log := l.Log
		if log == nil {
			log = slog.Default()
		}
		log.Error("rate limiter unavailable; using this process's own coarse count", "limit", name, "error", err)
		return l.local(bucket, limit, windowSeconds)
	}
	return Decision{Allowed: hits <= limit, RetryAfter: retry}
}

type localWindow struct {
	start time.Time
	hits  int
}

// local is the stand-in count used only while the database cannot be reached: per process,
// not shared, but it keeps one caller from being unlimited just because the store is down.
func (l *Limiter) local(bucket string, limit, windowSeconds int) Decision {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.fallback == nil || len(l.fallback) > 10_000 {
		l.fallback = map[string]*localWindow{}
	}
	now := time.Now()
	w := l.fallback[bucket]
	if w == nil || now.Sub(w.start) >= time.Duration(windowSeconds)*time.Second {
		w = &localWindow{start: now}
		l.fallback[bucket] = w
	}
	w.hits++
	retry := int(time.Duration(windowSeconds)*time.Second/time.Second) - int(now.Sub(w.start)/time.Second)
	if retry < 1 {
		retry = 1
	}
	return Decision{Allowed: w.hits <= limit, RetryAfter: retry}
}

// clientKey makes one caller one bucket: an IPv6 network is handed out as a /64, so a single
// host cannot spread across its whole range.
func clientKey(ip string) string {
	if a, err := netip.ParseAddr(ip); err == nil && a.Is6() && !a.Is4In6() {
		if p, err := a.Prefix(64); err == nil {
			return p.String()
		}
	}
	return ip
}

// ClientIP is the address a request really came from. Behind proxies the
// right-most `trustedHops` entries of X-Forwarded-For were added by our own
// infrastructure; the one before them is the client. With no trusted proxy
// the header is ignored entirely, because anyone can send it.
func ClientIP(r *http.Request, trustedHops int) string {
	if trustedHops > 0 {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if i := len(parts) - trustedHops; i >= 0 && i < len(parts) {
			if ip := net.ParseIP(strings.TrimSpace(parts[i])); ip != nil {
				return clientKey(ip.String())
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return clientKey(r.RemoteAddr)
	}
	return clientKey(host)
}

// Reject writes the standard "slow down" response.
func Reject(w http.ResponseWriter, d Decision) {
	w.Header().Set("Retry-After", strconv.Itoa(d.RetryAfter))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"error":{"code":"rate_limited","message":"Too many requests. Please wait a moment and try again."}}` + "\n"))
}
