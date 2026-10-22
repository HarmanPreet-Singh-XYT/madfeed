package jobs_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
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
	// River's migrations run as the privileged role; the app role only gets DML.
	if _, err := db.Super.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+jobs.Schema); err != nil {
		t.Fatal(err)
	}
	m, err := rivermigrate.New(riverpgxv5.New(db.Super), &rivermigrate.Config{Schema: jobs.Schema})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`GRANT USAGE ON SCHEMA ` + jobs.Schema + ` TO app_backend`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
		`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
		`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
	} {
		if _, err := db.Super.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
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
