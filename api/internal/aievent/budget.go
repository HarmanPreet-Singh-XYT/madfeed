package aievent

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/ai"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// Budget caps what one workspace may spend on AI in any 24 hours. The spend is
// read from the ai_event table, so the cap holds across instances and restarts.
// The check happens before each call, so a burst can overshoot by at most the
// calls already in flight.
type Budget struct {
	Pool       *pgxpool.Pool
	DefaultUSD float64 // used when the workspace has no override; 0 switches the cap off
	Log        *slog.Logger
}

var _ ai.Budget = (*Budget)(nil)

func (b *Budget) Check(ctx context.Context) error {
	t, ok := store.FromContext(ctx)
	if !ok {
		return nil // nothing to attribute the spend to; the recorder drops such events too
	}
	var spent, limit float64
	var over bool
	err := store.WithTenant(ctx, b.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.GetAISpend(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		limit = b.DefaultUSD
		if row.LimitUsd >= 0 { // -1 means no override for this workspace
			limit = row.LimitUsd
		}
		spent = row.Spent
		if limit <= 0 || spent < limit {
			return nil
		}
		over = true
		msg := fmt.Sprintf("Your workspace has used its AI allowance for today ($%.2f). Reading new conversations, writing briefs and answering questions are paused, and pick up again by themselves as the last 24 hours roll over.", limit)
		return q.InsertNotice(ctx, dbgen.InsertNoticeParams{WorkspaceID: t.WorkspaceID, Kind: "ai_budget", Message: msg})
	})
	if err != nil {
		// If we cannot tell, do not block work, but say so: money matters, so this is loud.
		log := b.Log
		if log == nil {
			log = slog.Default()
		}
		log.Error("ai budget check failed; allowing the call", "error", err)
		return nil
	}
	if over {
		return fmt.Errorf("%w ($%.2f of $%.2f)", ai.ErrBudgetExceeded, spent, limit)
	}
	return nil
}
