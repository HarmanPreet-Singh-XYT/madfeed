package survey

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Scheduler closes surveys whose chosen close time has passed. It runs outside
// any workspace; the database function does the update (see 00065).
type Scheduler struct {
	Pool *pgxpool.Pool
	Log  *slog.Logger
}

func (s *Scheduler) Run(ctx context.Context) (int64, error) {
	var n int64
	err := s.Pool.QueryRow(ctx, `SELECT close_due_surveys()`).Scan(&n)
	return n, err
}

// Loop runs once at start and then every `every` until ctx ends.
func (s *Scheduler) Loop(ctx context.Context, every time.Duration) {
	log := s.Log
	if log == nil {
		log = slog.Default()
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if n, err := s.Run(ctx); err != nil {
			log.Error("scheduled survey close", "error", err)
		} else if n > 0 {
			log.Info("closed surveys whose time was up", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
