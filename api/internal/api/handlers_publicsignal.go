package api

import (
	"context"
	"errors"
	"net/http"

	"product/api/internal/publicsignal"
)

var errSearchFailed = &APIError{http.StatusBadGateway, "search_failed", "The web search did not answer. Try again in a moment."}

func publicSignalOf(sig publicsignal.Signal) PublicSignal {
	out := PublicSignal{Verdict: sig.Verdict, Summary: sig.Summary, Query: sig.Query, CheckedAt: sig.CheckedAt, Sources: make([]PublicSignalSource, 0, len(sig.Sources)), Patterns: make([]PublicSignalPattern, 0, len(sig.Patterns))}
	for _, s := range sig.Sources {
		out.Sources = append(out.Sources, PublicSignalSource{Title: s.Title, Url: s.URL, Snippet: s.Snippet})
	}
	for _, p := range sig.Patterns {
		out.Patterns = append(out.Patterns, PublicSignalPattern{Approach: p.Approach, Title: p.Title, Url: p.URL})
	}
	return out
}

func (s *Server) CheckPublicSignal(ctx context.Context, req CheckPublicSignalRequestObject) (CheckPublicSignalResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if s.PublicSignal == nil {
		return nil, errNotConfigured
	}
	// Two searches and a model call per press: cap it per workspace per day so a button cannot
	// become a bill. The daily AI allowance covers the model side; this covers the search side.
	if s.Limiter != nil {
		if d := s.Limiter.Allow(ctx, "public_signal", t.WorkspaceID.String(), 100, 86400); !d.Allowed {
			return nil, &APIError{http.StatusTooManyRequests, "too_many_checks", "That is enough public-source checks for today. Try again tomorrow."}
		}
	}
	sig, err := s.PublicSignal.Check(ctx, t, req.RequestId)
	if err != nil {
		switch {
		case errors.Is(err, publicsignal.ErrForbidden):
			return nil, errForbidden
		case errors.Is(err, publicsignal.ErrNotFound):
			return nil, errNotFound
		case errors.Is(err, publicsignal.ErrNoTitle):
			return nil, badRequest("Give the request a title first: the search uses it.")
		case errors.Is(err, publicsignal.ErrUnconfigured):
			return nil, errNotConfigured
		case errors.Is(err, publicsignal.ErrSearchFailure):
			return nil, errSearchFailed
		}
		return nil, err
	}
	return CheckPublicSignal200JSONResponse(publicSignalOf(sig)), nil
}
