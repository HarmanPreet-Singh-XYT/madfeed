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

func TestOnlyImportRoutesGetALargeBodyLimit(t *testing.T) {
	read := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		}
	})
	h := MaxBody(1024)(read)
	big := strings.Repeat("x", 4096)
	for path, want := range map[string]int{
		"/v1/workspaces/w/people/import":         http.StatusOK,
		"/v1/workspaces/w/people/import/preview": http.StatusOK,
		"/v1/workspaces/w/sources/paste":         http.StatusRequestEntityTooLarge,
		"/v1/workspaces/w/people":                http.StatusRequestEntityTooLarge,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", path, strings.NewReader(big)))
		if rec.Code != want {
			t.Errorf("%s: got %d want %d", path, rec.Code, want)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/workspaces/w/people/import", strings.NewReader(strings.Repeat("x", UploadBodyBytes+10))))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("even imports have a cap: %d", rec.Code)
	}
}
