// Package jobs wires the Postgres-backed River queue. Jobs are enqueued in the
// same transaction as the data they belong to, so a job exists if and only if
// that data was committed. River's tables live in their own schema so they
// stay out of the tenant tables and out of any auto-generated API.
package jobs

import (
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// Schema is the Postgres schema holding River's tables.
const Schema = "river"

// NewClient builds a River client. Pass a nil retry policy for River's default
// exponential backoff. Call Start only in worker mode; the API process uses
// the client to enqueue (with InsertTx) and never starts it.
func NewClient(pool *pgxpool.Pool, workers *river.Workers, retry river.ClientRetryPolicy) (*river.Client[pgx.Tx], error) {
	return river.NewClient(riverpgxv5.New(pool), &river.Config{
		Schema:      Schema,
		Workers:     workers,
		RetryPolicy: retry,
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 10},
		},
	})
}
