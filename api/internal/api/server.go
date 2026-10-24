package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	"product/api/internal/apikey"
	"product/api/internal/audit"
	"product/api/internal/billing"
	"product/api/internal/brief"
	"product/api/internal/digest"
	"product/api/internal/directory"
	"product/api/internal/intake"
	"product/api/internal/integrations"
	"product/api/internal/media"
	"product/api/internal/oauth"
	"product/api/internal/outreach"
	"product/api/internal/portability"
	"product/api/internal/publicsite"
	"product/api/internal/quality"
	"product/api/internal/ratelimit"
	"product/api/internal/release"
	"product/api/internal/research"
	"product/api/internal/review"
	"product/api/internal/views"
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
	Auth         TokenVerifier
	Pool         *pgxpool.Pool
	Workspaces   *workspaces.Service
	Intake       *intake.Service
	Review       *review.Service
	Directory    *directory.Service
	Brief        *brief.Service
	Quality      *quality.Service
	Portability  *portability.Service
	Workflow     *workflow.Service
	Outreach     *outreach.Service
	Release      *release.Service
	Research     *research.Service
	QA           *research.QA
	Media        *media.Service
	Views        *views.Service
	Audit        *audit.Service
	Site         *publicsite.Service
	Digest       *digest.Service
	APIKeys      *apikey.Service
	Integrations *integrations.Service
	Billing      *billing.Service
	OAuth        *oauth.Service
	// EmailConfigured says whether the worker has an email provider, so settings can warn when it has not.
	EmailConfigured bool
	// Webhook receives signed delivery reports from the email provider. It sits
	// outside the sign-in layer on purpose: the provider has no account, and the
	// handler authenticates every request by its signature instead.
	Webhook http.Handler
	// Metrics, when set, serves /metrics to a scraper holding its bearer token.
	Metrics http.Handler
	// Limiter, when set, throttles callers per address (public routes) and per
	// person (signed in), with the numbers in Limits.
	Limiter *ratelimit.Limiter
	Limits  Limits
	Unsub   outreach.Unsubscriber
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
		ErrorHandlerWithOpts: func(_ context.Context, err error, w http.ResponseWriter, r *http.Request, opts nethttpmiddleware.ErrorHandlerOpts) {
			var tooBig *http.MaxBytesError
			status := opts.StatusCode
			switch {
			case errors.As(err, &tooBig):
				writeError(w, r, &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "That is larger than allowed."})
				return
			case status == http.StatusUnauthorized:
				// Our own middleware already authenticated the caller, so a 401 here is a malformed request, not a sign-in problem.
				status = http.StatusBadRequest
			}
			// Generic body: validator messages can echo client input.
			writeError(w, r, &APIError{Status: status, Code: "invalid_request", Message: "The request is not valid."})
		},
	})

	r := chi.NewRouter()
	r.Use(authenticateExt(s))
	r.Use(authenticate(s.Auth))
	if s.Limiter != nil {
		r.Use(limitSignedIn(s.Limiter, func() Limits { return s.Limits }))
	}
	r.Use(validate)
	root := chi.NewRouter()
	if s.Limiter != nil {
		root.Use(limitAnonymous(s.Limiter, func() Limits { return s.Limits }))
	}
	root.Use(siteCORS(s.Site, func() Limits { return s.Limits }))
	if s.Metrics != nil {
		root.Handle("/metrics", s.Metrics)
	}
	root.Handle("/mcp", s.mcpEndpoint(root))
	root.Handle("/v1/integrations/slack/events", s.slackEvents())
	root.Handle("/v1/integrations/github/{workspaceId}/events", s.githubEvents())
	root.Handle("/v1/webhooks/stripe", s.stripeWebhook())
	root.Handle("/.well-known/oauth-protected-resource", s.oauthWellKnown())
	root.Handle("/.well-known/oauth-protected-resource/mcp", s.oauthWellKnown())
	root.Handle("/.well-known/oauth-authorization-server", s.oauthWellKnown())
	root.Handle("/oauth/register", s.oauthRegister())
	root.Handle("/oauth/token", s.oauthToken())
	if s.Webhook != nil {
		root.Handle("/v1/webhooks/resend", s.Webhook)
	}
	root.Mount("/", r)
	strict := NewStrictHandlerWithOptions(s, nil, StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
			writeError(w, r, badRequest("The request is not valid."))
		},
		ResponseErrorHandlerFunc: writeError,
	})
	HandlerFromMux(strict, r)
	return root, nil
}

// Validate fails fast when the server is wired incompletely, so a missing or
// mis-ordered service shows up at startup, not as a crash on the first request
// that needs it. Optional parts (media, webhook, rate limiter) are not checked.
func (s *Server) Validate() error {
	if s.Pool == nil {
		return nil // development without a database: only health routes work, on purpose
	}
	var missing []string
	need := func(name string, ok bool) {
		if !ok {
			missing = append(missing, name)
		}
	}
	need("Workspaces", s.Workspaces != nil)
	need("Intake", s.Intake != nil)
	need("Review", s.Review != nil)
	need("Directory", s.Directory != nil)
	need("Brief", s.Brief != nil)
	need("Quality", s.Quality != nil)
	need("Portability", s.Portability != nil)
	need("Workflow", s.Workflow != nil)
	need("Outreach", s.Outreach != nil)
	need("Release", s.Release != nil)
	need("Research", s.Research != nil)
	need("QA", s.QA != nil)
	need("Views", s.Views != nil)
	need("Site", s.Site != nil)
	need("Digest", s.Digest != nil)
	need("APIKeys", s.APIKeys != nil)
	need("Integrations", s.Integrations != nil)
	need("Billing", s.Billing != nil)
	need("Audit", s.Audit != nil && s.Audit.QA != nil && s.Audit.Brief != nil)
	if len(missing) > 0 {
		return fmt.Errorf("server is not fully wired: missing %s", strings.Join(missing, ", "))
	}
	return nil
}
