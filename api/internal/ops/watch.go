package ops

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Watchers look for the failures that make no noise: work that is waiting and
// not being picked up, a model that answers with errors. Loop runs them on a timer.
type Watchers struct {
	Pool   *pgxpool.Pool
	Alerts *Alerter
	Log    *slog.Logger

	StuckAfter   time.Duration // 0 means 10 minutes
	AIWindowMins int           // 0 means 10
	AIMinCalls   int           // 0 means 10
	AIErrorRatio float64       // 0 means 0.5
}

// CheckQueues alerts when jobs have been ready for a long time and nothing has taken them.
// Jobs waiting because of the AI allowance or a missing key are "scheduled" (snoozed), not "available", so they do not trip it.
func (w *Watchers) CheckQueues(ctx context.Context) error {
	after := w.StuckAfter
	if after <= 0 {
		after = 10 * time.Minute
	}
	rows, err := w.Pool.Query(ctx, `SELECT queue, kind, count(*), floor(extract(epoch FROM now() - min(scheduled_at)) / 60)::int
		FROM river.river_job WHERE state = 'available' AND scheduled_at < now() - make_interval(secs => $1) GROUP BY queue, kind`, after.Seconds())
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var queue, kind string
		var n, minutes int
		if err := rows.Scan(&queue, &kind, &n, &minutes); err != nil {
			return err
		}
		w.Alerts.Fire(ctx, Alert{
			Name: "queue_stuck", Severity: Critical,
			Summary: fmt.Sprintf("%d %s job(s) have been waiting for %d minutes and no worker has taken them.", n, kind, minutes),
			Details: map[string]string{"queue": queue, "kind": kind, "waiting": fmt.Sprint(n), "oldest_minutes": fmt.Sprint(minutes)},
		}, queue+"/"+kind)
	}
	return rows.Err()
}

// CheckAI alerts when most recent model calls are failing.
func (w *Watchers) CheckAI(ctx context.Context) error {
	win, minCalls, ratio := w.AIWindowMins, w.AIMinCalls, w.AIErrorRatio
	if win <= 0 {
		win = 10
	}
	if minCalls <= 0 {
		minCalls = 10
	}
	if ratio <= 0 {
		ratio = 0.5
	}
	var calls, errs int64
	if err := w.Pool.QueryRow(ctx, `SELECT calls, errors FROM ops_ai_error_rate($1)`, win).Scan(&calls, &errs); err != nil {
		return err
	}
	if calls >= int64(minCalls) && float64(errs)/float64(calls) >= ratio {
		w.Alerts.Fire(ctx, Alert{
			Name: "ai_failing", Severity: Critical,
			Summary: fmt.Sprintf("%d of the last %d AI calls failed in the past %d minutes.", errs, calls, win),
			Details: map[string]string{"calls": fmt.Sprint(calls), "errors": fmt.Sprint(errs), "window_minutes": fmt.Sprint(win)},
		}, "ai")
	}
	return nil
}

// Loop runs the checks every interval until ctx ends.
func (w *Watchers) Loop(ctx context.Context, every time.Duration) {
	log := w.Log
	if log == nil {
		log = slog.Default()
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if err := w.CheckQueues(ctx); err != nil && ctx.Err() == nil {
			log.Error("watcher could not run", "watcher", "queues", "error", err.Error())
		}
		if err := w.CheckAI(ctx); err != nil && ctx.Err() == nil {
			log.Error("watcher could not run", "watcher", "ai", "error", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Check is one health check, such as "database".
type Check func(ctx context.Context) error

// WatchDependencies runs the checks every interval and alerts after two
// failures in a row (one blip is not an outage). It logs when they recover.
func WatchDependencies(ctx context.Context, checks map[string]Check, a *Alerter, log *slog.Logger, every time.Duration) {
	if log == nil {
		log = slog.Default()
	}
	failing := map[string]int{}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		for name, check := range checks {
			cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := check(cctx)
			cancel()
			switch {
			case err != nil:
				failing[name]++
				if failing[name] == 2 {
					a.Fire(ctx, Alert{Name: "dependency_down", Severity: Critical,
						Summary: fmt.Sprintf("%s has failed its health check twice in a row.", name),
						Details: map[string]string{"dependency": name}}, name)
				}
			case failing[name] > 0:
				if failing[name] >= 2 {
					log.Info("dependency recovered", "dependency", name)
				}
				failing[name] = 0
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
