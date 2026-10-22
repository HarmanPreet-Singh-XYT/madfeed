// Package workflow manages request statuses. Moving a request to a "shipped"
// status is what starts the loop-closing flow: a batch of personal message
// drafts for the people who asked, which a person must review and approve.
package workflow

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/outreach"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var ErrNotFound = errors.New("workflow: not found")

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

type Status struct {
	ID       uuid.UUID
	Name     string
	Bucket   string
	Position int
}

type Service struct {
	Pool     *pgxpool.Pool
	Outreach *outreach.Service
}

func (s *Service) List(ctx context.Context, t store.Tenant) ([]Status, error) {
	var out []Status
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListStatuses(ctx, t.WorkspaceID)
		for _, r := range rows {
			out = append(out, Status{ID: r.ID, Name: r.Name, Bucket: r.Bucket, Position: int(r.Position)})
		}
		return err
	})
	return out, err
}

func (s *Service) Create(ctx context.Context, t store.Tenant, name, bucket string) (uuid.UUID, error) {
	if t.Role != store.RoleAdmin {
		return uuid.Nil, store.ErrForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 60 {
		return uuid.Nil, ErrInvalid("a status name must be 1 to 60 characters")
	}
	switch bucket {
	case "open", "active", "done", "closed":
	default:
		return uuid.Nil, ErrInvalid("the status must be open, active, done or closed")
	}
	var id uuid.UUID
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		st, err := q.CreateStatus(ctx, dbgen.CreateStatusParams{WorkspaceID: t.WorkspaceID, Name: name, Bucket: bucket})
		id = st.ID
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return uuid.Nil, ErrConflict("a status with that name already exists")
	}
	return id, err
}

func (s *Service) Rename(ctx context.Context, t store.Tenant, id uuid.UUID, name string) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 60 {
		return ErrInvalid("a status name must be 1 to 60 characters")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.RenameStatus(ctx, dbgen.RenameStatusParams{WorkspaceID: t.WorkspaceID, ID: id, Name: name})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return ErrConflict("a status with that name already exists")
	}
	return err
}

type Change struct {
	Shipped  bool // the request just moved into a shipped status
	Outreach outreach.Summary
}

// SetRequestStatus changes a request's status. Moving into "done" starts the
// loop-closing batch; moving back out withdraws a batch nobody has approved.
// All of it happens in one transaction, so a status never changes without its
// batch and jobs, or the other way round.
func (s *Service) SetRequestStatus(ctx context.Context, t store.Tenant, requestID, statusID uuid.UUID) (Change, error) {
	var ch Change
	if !t.CanWrite() {
		return ch, store.ErrForbidden
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		cur, err := q.GetRequestForStatusChange(ctx, dbgen.GetRequestForStatusChangeParams{WorkspaceID: t.WorkspaceID, ID: requestID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		next, err := q.GetStatus(ctx, dbgen.GetStatusParams{WorkspaceID: t.WorkspaceID, ID: statusID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if cur.StatusID == next.ID {
			return nil
		}
		if err := q.SetRequestStatus(ctx, dbgen.SetRequestStatusParams{WorkspaceID: t.WorkspaceID, ID: requestID, StatusID: next.ID}); err != nil {
			return err
		}
		switch {
		case next.Bucket == "done" && cur.Bucket != "done":
			ch.Shipped = true
			ch.Outreach, err = s.Outreach.Start(ctx, tx, q, t, requestID)
		case cur.Bucket == "done" && next.Bucket != "done":
			err = s.Outreach.CancelOpenForRequest(ctx, q, t, requestID)
		}
		return err
	})
	return ch, err
}
