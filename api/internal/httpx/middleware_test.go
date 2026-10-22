package httpx

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var ok = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

func stack(origins []string) http.Handler {
	return Chain(ok, slog.New(slog.NewTextHandler(io.Discard, nil)), origins, time.Second, 16)
}

func TestSecurityHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	stack(nil).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	for _, h := range []string{"X-Content-Type-Options", "Content-Security-Policy", "Strict-Transport-Security", "Referrer-Policy"} {
		if rec.Header().Get(h) == "" {
			t.Errorf("missing %s", h)
		}
	}
}

func TestCORSAllowListOnly(t *testing.T) {
	s := stack([]string{"https://app.example"})
	for origin, want := range map[string]string{"https://app.example": "https://app.example", "https://evil.example": ""} {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != want {
			t.Errorf("origin %s: got %q want %q", origin, got, want)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	read := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		}
	})
	h := MaxBody(8)(read)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/", strings.NewReader(strings.Repeat("x", 100))))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d", rec.Code)
	}
}
