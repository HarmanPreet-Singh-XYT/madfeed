// Package store is the only way application code reaches the database. Every
// query that touches tenant data runs inside WithTenant so Postgres row level
// security sees the caller's workspace and user.
package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store/dbgen"
)

// Tenant identifies who is acting inside which workspace. Both values come
// from a verified token and a membership lookup, never from request bodies.
type Tenant struct {
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Role        Role // from the membership lookup, never from the client
}

type Role string

const (
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
	RoleViewer Role = "viewer"
)

// CanWrite is true for roles allowed to change data. Services check it before
// any mutation; viewers read only.
func (t Tenant) CanWrite() bool { return t.Role == RoleAdmin || t.Role == RoleMember }

// ErrForbidden is returned when the caller's role does not allow an action.
var ErrForbidden = errors.New("forbidden")

type ctxKey struct{}

// WithContext attaches the tenant to ctx so code that has no tenant argument
// (for example the AI event recorder) can still write tenant-scoped rows.
func WithContext(ctx context.Context, t Tenant) context.Context {
	return context.WithValue(ctx, ctxKey{}, t)
}

// FromContext returns the tenant attached by WithContext.
func FromContext(ctx context.Context) (Tenant, bool) {
	t, ok := ctx.Value(ctxKey{}).(Tenant)
	return t, ok
}

// WithTenant runs fn in one transaction with the tenant context set. The
// settings are transaction-local (set_config(..., true)), so they vanish at
// commit or rollback and can never leak to the next user of a pooled
// connection.
func WithTenant(ctx context.Context, pool *pgxpool.Pool, t Tenant, fn func(*dbgen.Queries) error) error {
	return WithTenantTx(ctx, pool, t, func(_ pgx.Tx, q *dbgen.Queries) error { return fn(q) })
}

// WithTenantTx is WithTenant for callers that also need the transaction, for
// example to enqueue a job in the same commit as the data it belongs to.
func WithTenantTx(ctx context.Context, pool *pgxpool.Pool, t Tenant, fn func(pgx.Tx, *dbgen.Queries) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op after commit

	if err := setTenant(ctx, tx, t); err != nil {
		return err
	}
	if err := fn(tx, dbgen.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func setTenant(ctx context.Context, tx pgx.Tx, t Tenant) error {
	_, err := tx.Exec(ctx,
		`SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)`,
		t.WorkspaceID.String(), t.UserID.String())
	if err != nil {
		return fmt.Errorf("set tenant: %w", err)
	}
	return nil
}

// ErrNotMember is returned when the user has no membership in the workspace.
// Callers should answer "not found", never "forbidden", so workspace ids
// cannot be probed.
var ErrNotMember = errors.New("not a member of this workspace")

// ResolveTenant turns a verified user id and a workspace id from the URL into
// a Tenant, with the role read from our own tables.
func ResolveTenant(ctx context.Context, pool *pgxpool.Pool, userID, workspaceID uuid.UUID) (Tenant, error) {
	t := Tenant{WorkspaceID: workspaceID, UserID: userID}
	var role string
	err := WithTenant(ctx, pool, t, func(q *dbgen.Queries) (err error) {
		role, err = q.GetMemberRole(ctx, dbgen.GetMemberRoleParams{WorkspaceID: workspaceID, UserID: userID})
		return
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Tenant{}, ErrNotMember
	}
	if err != nil {
		return Tenant{}, err
	}
	t.Role = Role(role)
	return t, nil
}

// WithUser runs fn with only the user set (no workspace). The only data
// visible this way is the user's own memberships and the names of their
// workspaces, which is what sign-in needs to offer a choice.
func WithUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, fn func(*dbgen.Queries) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id', $1, true)`, userID.String()); err != nil {
		return fmt.Errorf("set user: %w", err)
	}
	if err := fn(dbgen.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// WithTenantSnapshot runs fn in a read-only, repeatable-read transaction so a
// long read (an export) sees one consistent moment even while others write.
func WithTenantSnapshot(ctx context.Context, pool *pgxpool.Pool, t Tenant, fn func(pgx.Tx, *dbgen.Queries) error) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := setTenant(ctx, tx, t); err != nil {
		return err
	}
	if err := fn(tx, dbgen.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
