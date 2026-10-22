// Package store is the only way application code reaches the database. Every
// query that touches tenant data runs inside WithTenant so Postgres row level
// security sees the caller's workspace and user.
package store

import (
	"context"
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
}

// WithTenant runs fn in one transaction with the tenant context set. The
// settings are transaction-local (set_config(..., true)), so they vanish at
// commit or rollback and can never leak to the next user of a pooled
// connection.
func WithTenant(ctx context.Context, pool *pgxpool.Pool, t Tenant, fn func(*dbgen.Queries) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op after commit

	if err := setTenant(ctx, tx, t); err != nil {
		return err
	}
	if err := fn(dbgen.New(tx)); err != nil {
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
