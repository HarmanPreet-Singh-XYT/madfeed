package publicsignal

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/store"
)

// AutoChecksPerDay caps what the automatic check may spend per workspace. A person pressing the
// button is not capped by this; a busy import is.
const AutoChecksPerDay = 20

// CheckArgs asks for the public check to run for one request, without a person pressing anything.
type CheckArgs struct {
	WorkspaceID uuid.UUID
	RequestID   uuid.UUID
	UserID      uuid.UUID
}

func (CheckArgs) Kind() string { return "check_public_signal" }

// Worker runs the check after a request is created. Failures are logged by River and cost nothing
// else: the request simply has no market context until someone asks for it.
type Worker struct {
	river.WorkerDefaults[CheckArgs]
	Pool      *pgxpool.Pool
	Search    Search
	Completer Completer
}

func (w *Worker) Work(ctx context.Context, job *river.Job[CheckArgs]) error {
	if w.Search == nil || w.Completer == nil {
		return nil // no web search configured on this worker: nothing to do, and no retries
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}

	// The automatic check is a convenience, not a bill. Count today's and stop at the cap.
	var done int
	if err := w.Pool.QueryRow(ctx, `
		SELECT count(*) FROM request
		WHERE workspace_id = $1
		  AND (public_signal->>'checkedAt')::timestamptz > now() - interval '24 hours'`, a.WorkspaceID).Scan(&done); err != nil {
		return fmt.Errorf("count public checks: %w", err)
	}
	if done >= AutoChecksPerDay {
		return nil
	}

	svc := &Service{Pool: w.Pool, Search: w.Search, Completer: w.Completer, Now: time.Now}
	// The worker acts as a member; Check itself only requires write permission, which the role gives.
	if _, err := svc.Check(ctx, t, a.RequestID); err != nil {
		return nil // a missing result is not an outage: leave the request without context
	}
	return nil
}

// Ensure the worker satisfies River's interface.
var _ river.Worker[CheckArgs] = (*Worker)(nil)
