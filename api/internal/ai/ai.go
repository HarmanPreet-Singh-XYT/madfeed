// Package ai is the only place application code talks to model providers.
// Features ask for a Tier ("small", "mid", "large"); configuration maps each
// tier to an ordered list of (provider, model) routes. Swapping or adding a
// provider is a config change plus one adapter that implements Provider.
// Provider SDK types never leave their adapter package.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Tier string

const (
	TierSmall Tier = "small" // routing, classification
	TierMid   Tier = "mid"   // extraction, drafts
	TierLarge Tier = "large" // briefs, hard questions
)

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

type Message struct {
	Role Role
	Text string
}

// Request is provider-neutral. Model is filled in by the router from config.
type Request struct {
	Task          string // e.g. "extraction"; recorded on every event
	PromptVersion string // pinned per prompt; changed only through the eval gate
	System        string
	Messages      []Message
	Schema        json.RawMessage // JSON Schema for structured output; nil for free text
	MaxTokens     int
	// ContainsCustomerData must be true whenever the prompt includes customer
	// conversation text or personal data. The router then only uses routes
	// that are explicitly allowed to receive it.
	ContainsCustomerData bool
	Model                string // set by Router
}

type Usage struct {
	InputTokens, OutputTokens, CachedInputTokens int
}

type Response struct {
	Text         string
	JSON         json.RawMessage // set when Schema was given and output validated
	Usage        Usage
	Provider     string
	Model        string
	FinishReason string
}

// Provider is implemented once per vendor, in its own sub-package.
type Provider interface {
	Name() string
	Complete(ctx context.Context, req Request) (Response, error)
}

// Embedder is the equivalent for embedding models.
type Embedder interface {
	Name() string
	Embed(ctx context.Context, model string, inputs []string) ([][]float32, Usage, error)
}

// Errors adapters must map vendor failures onto. The router falls back to the
// next route only for ErrUnavailable, ErrRateLimited and ErrAuth (a bad key on
// one vendor must not take the product down; the failed attempt is recorded so
// the misconfiguration is visible). Everything else is the caller's problem and
// retrying elsewhere would not help or would repeat a bad request.
var (
	ErrUnavailable   = errors.New("ai: provider unavailable")
	ErrRateLimited   = errors.New("ai: rate limited")
	ErrAuth          = errors.New("ai: provider authentication failed")
	ErrBadRequest    = errors.New("ai: bad request")
	ErrRefused       = errors.New("ai: model refused")
	ErrInvalidOutput = errors.New("ai: output did not match the requested schema")
	ErrNoRoute       = errors.New("ai: no eligible route for this request")
)

// Price is USD per million tokens for one model, supplied by config.
type Price struct{ InputPerM, OutputPerM, CachedInputPerM float64 }

func (p Price) Cost(u Usage) float64 {
	uncached := u.InputTokens - u.CachedInputTokens
	if uncached < 0 {
		uncached = 0
	}
	return (float64(uncached)*p.InputPerM + float64(u.CachedInputTokens)*p.CachedInputPerM + float64(u.OutputTokens)*p.OutputPerM) / 1e6
}

// Route is one provider+model choice for a tier.
type Route struct {
	Provider string
	Model    string
	Price    Price
	// AllowCustomerData says this vendor has been approved (terms, DPA,
	// retention) to receive customer conversation content.
	AllowCustomerData bool
}

// Event is what gets written to ai_event for every attempt.
type Event struct {
	Task, PromptVersion, Tier string
	Provider, Model           string
	Usage                     Usage
	CostUSD                   float64
	Latency                   time.Duration
	Err                       error
}

// Recorder persists events (the ai_event table). Must not block the request.
type Recorder interface {
	Record(ctx context.Context, e Event)
}

type Router struct {
	providers map[string]Provider
	tiers     map[Tier][]Route
	rec       Recorder
}

// NewRouter validates that every route points at a registered provider, so a
// typo in config fails at startup, not on the first customer request.
func NewRouter(providers []Provider, tiers map[Tier][]Route, rec Recorder) (*Router, error) {
	r := &Router{providers: map[string]Provider{}, tiers: tiers, rec: rec}
	for _, p := range providers {
		r.providers[p.Name()] = p
	}
	for t, routes := range tiers {
		if len(routes) == 0 {
			return nil, fmt.Errorf("ai: tier %q has no routes", t)
		}
		for _, rt := range routes {
			if _, ok := r.providers[rt.Provider]; !ok {
				return nil, fmt.Errorf("ai: tier %q routes to unknown provider %q", t, rt.Provider)
			}
		}
	}
	return r, nil
}

// Complete runs req on the first route of the tier, falling back on outages
// and rate limits. Every attempt is recorded.
func (r *Router) Complete(ctx context.Context, tier Tier, req Request) (Response, error) {
	routes, ok := r.tiers[tier]
	if !ok {
		return Response{}, fmt.Errorf("ai: unknown tier %q", tier)
	}
	var last error
	tried := 0
	for _, rt := range routes {
		if req.ContainsCustomerData && !rt.AllowCustomerData {
			continue
		}
		tried++
		call := req
		call.Model = rt.Model
		start := time.Now()
		resp, err := r.providers[rt.Provider].Complete(ctx, call)
		ev := Event{Task: req.Task, PromptVersion: req.PromptVersion, Tier: string(tier),
			Provider: rt.Provider, Model: rt.Model, Latency: time.Since(start), Err: err}
		if err == nil {
			ev.Usage, ev.CostUSD = resp.Usage, rt.Price.Cost(resp.Usage)
			resp.Provider, resp.Model = rt.Provider, rt.Model
		}
		if r.rec != nil {
			r.rec.Record(ctx, ev)
		}
		if err == nil {
			return resp, nil
		}
		last = err
		if !errors.Is(err, ErrUnavailable) && !errors.Is(err, ErrRateLimited) && !errors.Is(err, ErrAuth) {
			return Response{}, err
		}
		if ctx.Err() != nil {
			return Response{}, ctx.Err()
		}
	}
	if tried == 0 {
		return Response{}, fmt.Errorf("%w: tier %q has no route approved for customer data", ErrNoRoute, tier)
	}
	return Response{}, fmt.Errorf("ai: all routes failed for tier %q: %w", tier, last)
}
