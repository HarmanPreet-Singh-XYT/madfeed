package api

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"
)

// Check reports whether one dependency (database, queue, ...) is usable.
type Check func(ctx context.Context) error

// Server implements the generated StrictServerInterface. Add one method per
// operation in openapi.yaml; the compiler fails until you do.
type Server struct {
	Version string
	Checks  map[string]Check
}

var _ StrictServerInterface = (*Server)(nil)

// GetLiveness says the process is up. It must not touch dependencies.
func (s *Server) GetLiveness(context.Context, GetLivenessRequestObject) (GetLivenessResponseObject, error) {
	return GetLiveness200JSONResponse{Status: "ok", Version: s.Version}, nil
}

// GetReadiness runs every dependency check with a short deadline. Failures are
// reported by name only, never with error text that could leak internals.
func (s *Server) GetReadiness(ctx context.Context, _ GetReadinessRequestObject) (GetReadinessResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	failed := []string{}
	for name, c := range s.Checks {
		if err := c(ctx); err != nil {
			failed = append(failed, name)
		}
	}
	if len(failed) > 0 {
		sort.Strings(failed)
		return GetReadiness503JSONResponse{Status: "unavailable", Failed: failed}, nil
	}
	return GetReadiness200JSONResponse{Status: "ready"}, nil
}

// NewHandler mounts the generated routes on a chi router and rejects any request
// that does not match openapi.yaml (unknown path or method, bad parameters or
// body) before it reaches a handler.
func NewHandler(s *Server) (http.Handler, error) {
	spec, err := GetSwagger()
	if err != nil {
		return nil, err
	}
	spec.Servers = nil // match on path only, not on host

	validate := nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		ErrorHandlerWithOpts: func(_ context.Context, _ error, w http.ResponseWriter, _ *http.Request, opts nethttpmiddleware.ErrorHandlerOpts) {
			// Generic body: validator messages can echo client input.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(opts.StatusCode)
			_, _ = w.Write([]byte(`{"error":"invalid request"}`))
		},
	})

	r := chi.NewRouter()
	r.Use(validate)
	return HandlerFromMux(NewStrictHandler(s, nil), r), nil
}
