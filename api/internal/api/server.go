package api

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	"product/api/internal/brief"
	"product/api/internal/directory"
	"product/api/internal/intake"
	"product/api/internal/outreach"
	"product/api/internal/portability"
	"product/api/internal/quality"
	"product/api/internal/release"
	"product/api/internal/review"
	"product/api/internal/workflow"
	"product/api/internal/workspaces"
)

// Check reports whether one dependency (database, queue, ...) is usable.
type Check func(ctx context.Context) error

// Server implements the generated StrictServerInterface. Add one method per
// operation in openapi.yaml; the compiler fails until you do.
type Server struct {
	Version string
	Checks  map[string]Check

	// Auth is required. The services below may be nil in development, in which
	// case business routes answer 503 "not configured" and only health works.
	Auth        TokenVerifier
	Pool        *pgxpool.Pool
	Workspaces  *workspaces.Service
	Intake      *intake.Service
	Review      *review.Service
	Directory   *directory.Service
	Brief       *brief.Service
	Quality     *quality.Service
	Portability *portability.Service
	Workflow    *workflow.Service
	Outreach    *outreach.Service
	Release     *release.Service
	Unsub       outreach.Unsubscriber
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

// NewHandler mounts the generated routes on a chi router. Order matters:
// authentication first (nothing but health is reachable without a valid
// token), then validation of the request against openapi.yaml, so malformed
// requests never reach a handler.
func NewHandler(s *Server) (http.Handler, error) {
	if s.Auth == nil {
		return nil, errNoAuth
	}
	spec, err := GetSwagger()
	if err != nil {
		return nil, err
	}
	spec.Servers = nil // match on path only, not on host

	validate := nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		// Authentication is enforced by our middleware, which runs first; the
		// validator must not try to authenticate on its own.
		Options: openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc},
		ErrorHandlerWithOpts: func(_ context.Context, _ error, w http.ResponseWriter, r *http.Request, opts nethttpmiddleware.ErrorHandlerOpts) {
			// Generic body: validator messages can echo client input.
			writeError(w, r, &APIError{Status: opts.StatusCode, Code: "invalid_request", Message: "The request is not valid."})
		},
	})

	r := chi.NewRouter()
	r.Use(authenticate(s.Auth))
	r.Use(validate)
	strict := NewStrictHandlerWithOptions(s, nil, StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
			writeError(w, r, badRequest("The request is not valid."))
		},
		ResponseErrorHandlerFunc: writeError,
	})
	return HandlerFromMux(strict, r), nil
}
