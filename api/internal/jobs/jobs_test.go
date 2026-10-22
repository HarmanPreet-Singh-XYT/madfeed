package jobs_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/jobs"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type flakyArgs struct {
	Key string `json:"key"`
}

func (flakyArgs) Kind() string { return "flaky" }

// flakyWorker fails its first two attempts, then succeeds. effects counts how
// many times the "side effect" (the success path) ran.
type flakyWorker struct {
	river.WorkerDefaults[flakyArgs]
	attempts, effects atomic.Int32
}

func (w *flakyWorker) Work(_ context.Context, _ *river.Job[flakyArgs]) error {
	if w.attempts.Add(1) <= 2 {
		return errors.New("transient failure")
	}
	w.effects.Add(1)
	return nil
}

type fastRetry struct{}

func (fastRetry) NextRetry(*rivertype.JobRow) time.Time { return time.Now().Add(20 * time.Millisecond) }

func setup(t *testing.T) (*testdb.DB, *river.Client[pgx.Tx], *flakyWorker) {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	w := &flakyWorker{}
	workers := river.NewWorkers()
	river.AddWorker(workers, w)
	c, err := jobs.NewClient(db.Backend, workers, fastRetry{})
	if err != nil {
		t.Fatal(err)
	}
	return db, c, w
}

func TestJobRetriesThenSucceedsExactlyOnce(t *testing.T) {
	db, c, w := setup(t)
	if err := c.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Stop(ctx) })

	tx, err := db.Backend.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.InsertTx(ctx, tx, flakyArgs{Key: "k1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		job, err := c.JobGet(ctx, res.Job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if job.State == rivertype.JobStateCompleted {
			if got := w.attempts.Load(); got != 3 {
				t.Errorf("attempts = %d, want 3", got)
			}
			if got := w.effects.Load(); got != 1 {
				t.Errorf("side effect ran %d times, want exactly 1", got)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("job did not complete in time")
}

func TestRolledBackTransactionLeavesNoJob(t *testing.T) {
	db, c, _ := setup(t)
	tx, err := db.Backend.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.InsertTx(ctx, tx, flakyArgs{Key: "rolled-back"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.JobGet(ctx, res.Job.ID); !errors.Is(err, river.ErrNotFound) {
		t.Fatalf("job survived rollback: err=%v", err)
	}
}
