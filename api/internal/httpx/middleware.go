// Package httpx holds HTTP middleware shared by every route: request IDs,
// panic recovery, timeouts, body limits, security headers, strict CORS and
// structured access logs.
package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"product/api/internal/ops"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// Chain applies the standard middleware stack, outermost first.
func Chain(h http.Handler, log *slog.Logger, origins []string, timeout time.Duration, maxBody int64) http.Handler {
	h = MaxBody(maxBody)(h)
	h = CORS(origins)(h)
	h = SecurityHeaders(h)
	// Recording uploads and playback stream large bodies, which TimeoutHandler
	// would buffer in memory; those routes keep their own limits instead.
	streaming, timed := h, http.TimeoutHandler(h, timeout, `{"error":"timeout"}`)
	h = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isStreaming(r) {
			streaming.ServeHTTP(w, r)
			return
		}
		timed.ServeHTTP(w, r)
	})
	h = AccessLog(log)(h)
	h = middleware.Recoverer(h)
	h = requestIDToContext(h)
	h = middleware.RequestID(h)
	return h
}

// SecurityHeaders sets defensive headers on every response. The API returns
// JSON only, so the CSP forbids everything.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// CORS allows only exact origins from the allow-list. Credentials are not
// used: callers send a Bearer token, so no cookie/CSRF surface exists.
func CORS(allowed []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// The embeddable form is posted to from each customer's own site; the API decides
			// per workspace which sites those are, so this app-wide list must not answer for it.
			if strings.HasPrefix(r.URL.Path, "/v1/public/sites/") && strings.HasSuffix(r.URL.Path, "/feedback") {
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			if origin != "" {
				w.Header().Add("Vary", "Origin")
				if slices.Contains(allowed, origin) {
					h := w.Header()
					h.Set("Access-Control-Allow-Origin", origin)
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
					h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
					h.Set("Access-Control-Max-Age", "600")
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// isStreaming is true for the two media routes that move large bodies.
func isStreaming(r *http.Request) bool {
	p := r.URL.Path
	return (r.Method == http.MethodPut && strings.HasSuffix(p, "/chunk") && strings.Contains(p, "/media/")) ||
		(r.Method == http.MethodGet && strings.HasSuffix(p, "/file") && strings.Contains(p, "/media/"))
}

// ChunkBodyBytes is the cap for one upload piece: 8 MiB plus slack.
const ChunkBodyBytes = 9 << 20

// uploadSuffixes are the only routes allowed a larger body (CSV imports sent as
// JSON). Everything else keeps the small default.
var uploadSuffixes = []string{"/people/import", "/people/import/preview"}

// UploadBodyBytes is the cap on those routes: the 5 MB file limit plus JSON overhead.
const UploadBodyBytes = 7 << 20

// MaxBody caps request bodies so one client cannot exhaust memory.
func MaxBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			limit := n
			for _, s := range uploadSuffixes {
				if strings.HasSuffix(r.URL.Path, s) && limit < UploadBodyBytes {
					limit = UploadBodyBytes
				}
			}
			if isStreaming(r) && r.Method == http.MethodPut && limit < ChunkBodyBytes {
				limit = ChunkBodyBytes
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// AccessLog writes one structured line per request. It never logs headers,
// query strings or bodies (they can carry tokens or personal data).
func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			log.LogAttrs(r.Context(), slog.LevelInfo, "request",
				slog.String("request_id", middleware.GetReqID(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", loggablePath(r.URL.Path)),
				slog.Int("status", ww.Status()),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Duration("duration", time.Since(start)),
			)
		})
	}
}

var requestIDOK = regexp.MustCompile(`^[A-Za-z0-9._/\-]{1,80}$`)

// requestIDToContext does three things with the request id. A caller may send
// their own (so a request can be followed across systems), but only if it is
// short and plain; anything else, including line breaks that could forge log
// lines, is replaced by one we generate. It is echoed in the response so
// someone reporting a problem can quote it. And it is put on the context so
// code with only a context, such as the hook that stamps it on background
// jobs, can reach it.
func requestIDToContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		id := middleware.GetReqID(ctx)
		if !requestIDOK.MatchString(id) {
			b := make([]byte, 12)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
			ctx = context.WithValue(ctx, middleware.RequestIDKey, id)
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(ops.WithRequestID(ctx, id)))
	})
}

// loggablePath keeps capability tokens out of the logs. An unsubscribe link's
// token identifies a message and lets anyone holding it opt that address out,
// so it is written as {token}.
// SafePath is loggablePath for other packages' error logging.
func SafePath(p string) string { return loggablePath(p) }

func loggablePath(p string) string {
	for _, prefix := range []string{"/v1/public/unsubscribe/", "/unsubscribe/", "/v1/public/digest/unsubscribe/", "/digest/unsubscribe/"} {
		if strings.HasPrefix(p, prefix) {
			return prefix + "{token}"
		}
	}
	return p
}
