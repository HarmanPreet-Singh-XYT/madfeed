// Package workflow manages request statuses. Moving a request to a "shipped"
// status is what starts the loop-closing flow: a batch of personal message
// drafts for the people who asked, which a person must review and approve.
package workflow

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/hooks"
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
	if !t.Can(store.PermManage) {
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
	if !t.Can(store.PermManage) {
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

// Update changes any of a status's name, bucket or place. Anything not given keeps its value.
func (s *Service) Update(ctx context.Context, t store.Tenant, id uuid.UUID, name, bucket *string, position *int) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	p := dbgen.UpdateStatusParams{WorkspaceID: t.WorkspaceID, ID: id}
	if name != nil {
		n := strings.TrimSpace(*name)
		if n == "" || utf8.RuneCountInString(n) > 60 {
			return ErrInvalid("a status name must be 1 to 60 characters")
		}
		p.Name = pgtype.Text{String: n, Valid: true}
	}
	if bucket != nil {
		switch *bucket {
		case "open", "active", "done", "closed":
			p.Bucket = pgtype.Text{String: *bucket, Valid: true}
		default:
			return ErrInvalid("the status must be open, active, done or closed")
		}
	}
	if position != nil {
		if *position < 0 {
			return ErrInvalid("the place in the list cannot be negative")
		}
		p.Position = pgtype.Int4{Int32: int32(*position), Valid: true}
	}
	if !p.Name.Valid && !p.Bucket.Valid && !p.Position.Valid {
		return ErrInvalid("nothing to change")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateStatus(ctx, p)
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

// Reorder sets every status's place from one list, in one statement, so the
// list cannot be left half-sorted.
func (s *Service) Reorder(ctx context.Context, t store.Tenant, ids []uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	if len(ids) == 0 || len(ids) > 100 {
		return ErrInvalid("send the whole list of statuses")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.CountStatuses(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if int(n) != len(ids) {
			return ErrInvalid("the list must name every status exactly once")
		}
		return q.ReorderStatuses(ctx, dbgen.ReorderStatusesParams{WorkspaceID: t.WorkspaceID, Ids: ids})
	})
}

// Delete removes a status that nothing is in. Requests are never moved behind
// anyone's back: if the status is in use, the answer is to move them first.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.CountRequestsForStatus(ctx, dbgen.CountRequestsForStatusParams{WorkspaceID: t.WorkspaceID, StatusID: id})
		if err != nil {
			return err
		}
		if n > 0 {
			count := int(n)
			return ErrConflict(fmt.Sprintf("%d %s still in this status; move %s first", count, plural(count, "request"), them(count)))
		}
		total, err := q.CountStatuses(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if total <= 1 {
			return ErrConflict("a workspace needs at least one status")
		}
		rows, err := q.DeleteStatus(ctx, dbgen.DeleteStatusParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err == nil && rows == 0 {
			return ErrNotFound
		}
		return err
	})
}

func plural(n int, word string) string {
	if n == 1 {
		return word
	}
	return word + "s"
}

func them(n int) string {
	if n == 1 {
		return "it"
	}
	return "them"
}

type Change struct {
	Shipped  bool // the request just moved into a shipped status
	Outreach outreach.Summary
}

// ChangeStatusIn is SetRequestStatus inside a transaction the caller already holds, for changes that happen as part
// of something else (an issue closing in the tracker). The same rules apply: moving into "done" starts the
// loop-closing batch (drafts only; nothing is sent until a person approves), moving out withdraws an unapproved one.
func (s *Service) ChangeStatusIn(ctx context.Context, tx pgx.Tx, q *dbgen.Queries, t store.Tenant, requestID, statusID uuid.UUID) error {
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
		_, err = s.Outreach.Start(ctx, tx, q, t, requestID)
	case cur.Bucket == "done" && next.Bucket != "done":
		err = s.Outreach.CancelOpenForRequest(ctx, q, t, requestID)
	}
	if err != nil {
		return err
	}
	return emitStatusChange(ctx, tx, t, requestID, cur, next)
}

// emitStatusChange queues the outbound message for a status change (ids, names and the title; nothing a customer wrote).
func emitStatusChange(ctx context.Context, tx pgx.Tx, t store.Tenant, requestID uuid.UUID, cur dbgen.GetRequestForStatusChangeRow, next dbgen.Status) error {
	return hooks.Emit(ctx, tx, t.WorkspaceID, hooks.RequestStatusChanged, map[string]any{
		"requestId": requestID, "title": cur.Title,
		"fromStatusId": cur.StatusID, "fromBucket": cur.Bucket,
		"toStatusId": next.ID, "toStatusName": next.Name, "toBucket": next.Bucket,
	})
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
		if err != nil {
			return err
		}
		return emitStatusChange(ctx, tx, t, requestID, cur, next)
	})
	return ch, err
}
