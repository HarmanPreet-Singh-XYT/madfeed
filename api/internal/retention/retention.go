// Package retention deletes working data once it is old enough. Customers'
// own records (sources, quotes, requests, highlights, people, the send log)
// are never touched here: they go only when the customer deletes them.
package retention

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Policy is how many days each kind of working data is kept.
type Policy struct {
	QuestionsDays int // questions asked and the answers given
	AICallDays    int // per-call cost and latency records
	NoticeDays    int // banners shown to admins
	DismissedDays int // suggestions a person threw away
}

// Default is what the product promises: see the privacy notes in docs/gates/gate-5.md.
var Default = Policy{QuestionsDays: 180, AICallDays: 400, NoticeDays: 30, DismissedDays: 90}

type Purger struct {
	Pool   *pgxpool.Pool
	Policy Policy
	Log    *slog.Logger
}

// Run deletes what is past its time and returns how much of each kind went.
func (p *Purger) Run(ctx context.Context) (map[string]int64, error) {
	pol := p.Policy
	if pol == (Policy{}) {
		pol = Default
	}
	rows, err := p.Pool.Query(ctx, `SELECT kind, removed FROM purge_expired($1, $2, $3, $4)`, pol.QuestionsDays, pol.AICallDays, pol.NoticeDays, pol.DismissedDays)
	if err != nil {
		return nil, fmt.Errorf("purge: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var kind string
		var n int64
		if err := rows.Scan(&kind, &n); err != nil {
			return nil, err
		}
		out[kind] = n
	}
	return out, rows.Err()
}

// Loop runs the purge once at start and then daily until ctx ends.
func (p *Purger) Loop(ctx context.Context) {
	log := p.Log
	if log == nil {
		log = slog.Default()
	}
	t := time.NewTicker(24 * time.Hour)
	defer t.Stop()
	for {
		if res, err := p.Run(ctx); err != nil {
			log.Error("retention purge failed", "error", err)
		} else {
			total := int64(0)
			for _, n := range res {
				total += n
			}
			if total > 0 {
				log.Info("retention purge", "removed", res)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
