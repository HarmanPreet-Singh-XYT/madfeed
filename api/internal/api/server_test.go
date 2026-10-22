package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

func handler(t *testing.T, s *Server) http.Handler {
	t.Helper()
	h, err := NewHandler(s)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestReadinessNamesButNeverErrorText(t *testing.T) {
	s := &Server{Checks: map[string]Check{
		"db": func(context.Context) error { return errors.New("password=secret host=10.0.0.1") },
	}}
	rec := httptest.NewRecorder()
	handler(t, s).ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatal(rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "db") || strings.Contains(body, "secret") {
		t.Fatalf("unsafe or wrong body: %s", body)
	}
}

func TestUnknownPathsAndMethodsAreRejectedBySpec(t *testing.T) {
	h := handler(t, &Server{})
	for _, c := range []struct{ method, path string }{
		{"GET", "/nope"}, {"POST", "/healthz"}, {"DELETE", "/readyz"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		if rec.Code < 400 || rec.Code >= 500 {
			t.Errorf("%s %s: status %d", c.method, c.path, rec.Code)
		}
	}
}

// Contract test: every live response must satisfy the response schema in
// openapi.yaml, for success and failure paths alike.
func TestLiveResponsesMatchSpec(t *testing.T) {
	spec, err := GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	spec.Servers = openapi3.Servers{{URL: "http://localhost"}}
	router, err := gorillamux.NewRouter(spec)
	if err != nil {
		t.Fatal(err)
	}

	servers := map[string]*Server{
		"healthy":   {Version: "t", Checks: map[string]Check{"db": func(context.Context) error { return nil }}},
		"unhealthy": {Version: "t", Checks: map[string]Check{"db": func(context.Context) error { return errors.New("x") }}},
	}
	for name, s := range servers {
		for _, path := range []string{"/healthz", "/readyz"} {
			req := httptest.NewRequest("GET", "http://localhost"+path, nil)
			rec := httptest.NewRecorder()
			handler(t, s).ServeHTTP(rec, req)

			route, params, err := router.FindRoute(req)
			if err != nil {
				t.Fatalf("%s %s: %v", name, path, err)
			}
			in := &openapi3filter.ResponseValidationInput{
				RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route},
				Status:                 rec.Code,
				Header:                 rec.Header(),
			}
			in.SetBodyBytes(rec.Body.Bytes())
			if err := openapi3filter.ValidateResponse(context.Background(), in); err != nil {
				t.Errorf("%s %s (status %d) violates the contract: %v", name, path, rec.Code, err)
			}
		}
	}
}
