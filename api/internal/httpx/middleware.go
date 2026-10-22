// Package httpx holds HTTP middleware shared by every route: request IDs,
// panic recovery, timeouts, body limits, security headers, strict CORS and
// structured access logs.
package httpx

import (
	"log/slog"
	"net/http"
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
	h = http.TimeoutHandler(h, timeout, `{"error":"timeout"}`)
	h = AccessLog(log)(h)
	h = middleware.Recoverer(h)
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
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Duration("duration", time.Since(start)),
			)
		})
	}
}
