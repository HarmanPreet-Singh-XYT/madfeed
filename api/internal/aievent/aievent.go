// Package aievent persists one ai_event row per model call so cost, latency
// and outcomes are always inspectable per workspace.
package aievent

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/ai"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

type Recorder struct {
	Pool *pgxpool.Pool
	Log  *slog.Logger
}

var _ ai.Recorder = (*Recorder)(nil)

// Record needs the tenant on ctx (store.WithContext). A missing tenant is
// logged, not guessed: an event must never be written to the wrong workspace.
func (r *Recorder) Record(ctx context.Context, e ai.Event) {
	log := r.Log
	if log == nil {
		log = slog.Default()
	}
	t, ok := store.FromContext(ctx)
	if !ok {
		log.Warn("ai event dropped: no tenant in context", "task", e.Task)
		return
	}
	// Detached: a cancelled request must not lose the record of money already spent.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()

	outcome, class := "ok", pgtype.Text{}
	if e.Err != nil {
		outcome, class = "error", pgtype.Text{String: errorClass(e.Err), Valid: true}
	}
	var cost pgtype.Numeric
	_ = cost.Scan(formatCost(e.CostUSD))

	err := store.WithTenant(wctx, r.Pool, t, func(q *dbgen.Queries) error {
		return q.InsertAIEvent(wctx, dbgen.InsertAIEventParams{
			WorkspaceID: t.WorkspaceID, Task: e.Task, Tier: e.Tier, Provider: e.Provider, Model: e.Model,
			PromptVersion: e.PromptVersion, InputTokens: int32(e.Usage.InputTokens), OutputTokens: int32(e.Usage.OutputTokens),
			CachedInputTokens: int32(e.Usage.CachedInputTokens), CostUsd: cost, LatencyMs: int32(e.Latency.Milliseconds()),
			Outcome: outcome, ErrorClass: class,
		})
	})
	if err != nil {
		log.Error("ai event write failed", "error", err, "task", e.Task)
	}
}

func errorClass(err error) string {
	for _, c := range []struct {
		e error
		s string
	}{
		{ai.ErrUnavailable, "unavailable"}, {ai.ErrRateLimited, "rate_limited"}, {ai.ErrAuth, "auth"},
		{ai.ErrBadRequest, "bad_request"}, {ai.ErrRefused, "refused"}, {ai.ErrInvalidOutput, "invalid_output"},
		{ai.ErrNoRoute, "no_route"}, {context.Canceled, "canceled"}, {context.DeadlineExceeded, "timeout"},
	} {
		if errors.Is(err, c.e) {
			return c.s
		}
	}
	return "other" // never store error text: it can echo prompt content
}
