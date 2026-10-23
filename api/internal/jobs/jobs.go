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
	"github.com/riverqueue/river/rivertype"
)

// Schema is the Postgres schema holding River's tables.
const Schema = "river"

// QueueResearch carries the slow, heavy jobs: transcribing recordings and
// suggesting highlights. A worker process can serve only this queue (or
// everything except it), so audio work never delays sending an email.
const QueueResearch = "research"

// AllQueues is what a worker serves when it is not told otherwise.
var AllQueues = []string{river.QueueDefault, QueueResearch}

// NewClient builds a River client. Pass a nil retry policy for River's default
// exponential backoff. Call Start only in worker mode; the API process uses
// the client to enqueue (with InsertTx) and never starts it.
func NewClient(pool *pgxpool.Pool, workers *river.Workers, retry river.ClientRetryPolicy) (*river.Client[pgx.Tx], error) {
	return NewClientFor(pool, workers, retry, AllQueues)
}

// NewClientFor is NewClient serving only the named queues.
func NewClientFor(pool *pgxpool.Pool, workers *river.Workers, retry river.ClientRetryPolicy, queues []string) (*river.Client[pgx.Tx], error) {
	return NewClientWith(pool, workers, retry, queues, Extras{})
}

// Extras are the optional parts of a client: hooks that run as jobs are
// created, and what happens when a job fails.
type Extras struct {
	Plugins      []rivertype.Plugin
	ErrorHandler river.ErrorHandler
}

// NewClientWith is NewClientFor with Extras.
func NewClientWith(pool *pgxpool.Pool, workers *river.Workers, retry river.ClientRetryPolicy, queues []string, x Extras) (*river.Client[pgx.Tx], error) {
	qs := map[string]river.QueueConfig{}
	for _, q := range queues {
		n := 10
		if q == QueueResearch {
			n = 2 // each job holds a long vendor call; keep the vendor and our memory calm
		}
		qs[q] = river.QueueConfig{MaxWorkers: n}
	}
	return river.NewClient(riverpgxv5.New(pool), &river.Config{
		Schema:       Schema,
		Workers:      workers,
		RetryPolicy:  retry,
		Queues:       qs,
		Plugins:      x.Plugins,
		ErrorHandler: x.ErrorHandler,
	})
}
