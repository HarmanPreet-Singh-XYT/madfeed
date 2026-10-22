package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

// workspace creates a workspace with one admin and returns its tenant.
func workspace(t *testing.T, db *testdb.DB, name string) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New()}
	err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: name}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	})
	if err != nil {
		t.Fatal(err)
	}
	return ten
}

func newRequest(t *testing.T, db *testdb.DB, ten store.Tenant, title string) dbgen.Request {
	t.Helper()
	var r dbgen.Request
	err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) (err error) {
		r, err = q.CreateRequest(ctx, dbgen.CreateRequestParams{WorkspaceID: ten.WorkspaceID, Title: title})
		return
	})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestTenantCannotReadOrChangeAnotherTenantsRows(t *testing.T) {
	db := testdb.New(t)
	a, b := workspace(t, db, "A"), workspace(t, db, "B")
	secret := newRequest(t, db, a, "A's private request")

	// B asks for A's row by id, naming A's workspace explicitly.
	err := store.WithTenant(ctx, db.Backend, b, func(q *dbgen.Queries) error {
		_, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: a.WorkspaceID, ID: secret.ID})
		return err
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("read: want no rows, got %v", err)
	}

	// B lists with A's workspace id: still nothing.
	err = store.WithTenant(ctx, db.Backend, b, func(q *dbgen.Queries) error {
		rows, err := q.ListRequests(ctx, dbgen.ListRequestsParams{
			WorkspaceID: a.WorkspaceID, BeforeCreatedAt: time.Now().Add(24 * time.Hour), BeforeID: uuid.Max, PageSize: 50})
		if err == nil && len(rows) != 0 {
			t.Errorf("list leaked %d rows", len(rows))
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// B cannot update or delete A's row.
	_ = store.WithTenant(ctx, db.Backend, b, func(q *dbgen.Queries) error {
		n, err := q.UpdateRequestTitle(ctx, dbgen.UpdateRequestTitleParams{WorkspaceID: a.WorkspaceID, ID: secret.ID, Title: "hacked"})
		if err != nil || n != 0 {
			t.Errorf("update: rows=%d err=%v", n, err)
		}
		n, err = q.DeleteRequest(ctx, dbgen.DeleteRequestParams{WorkspaceID: a.WorkspaceID, ID: secret.ID})
		if err != nil || n != 0 {
			t.Errorf("delete: rows=%d err=%v", n, err)
		}
		return nil
	})

	// B cannot insert a row into A's workspace (WITH CHECK).
	err = store.WithTenant(ctx, db.Backend, b, func(q *dbgen.Queries) error {
		_, err := q.CreateRequest(ctx, dbgen.CreateRequestParams{WorkspaceID: a.WorkspaceID, Title: "planted"})
		return err
	})
	if err == nil {
		t.Fatal("cross-tenant insert succeeded")
	}

	// A still sees exactly its original row, unchanged.
	err = store.WithTenant(ctx, db.Backend, a, func(q *dbgen.Queries) error {
		r, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: a.WorkspaceID, ID: secret.ID})
		if err == nil && r.Title != "A's private request" {
			t.Errorf("row was modified: %q", r.Title)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestNoTenantContextSeesNothingAndWritesNothing(t *testing.T) {
	db := testdb.New(t)
	a := workspace(t, db, "A")
	newRequest(t, db, a, "x")

	var n int
	if err := db.Backend.QueryRow(ctx, `SELECT count(*) FROM request`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("saw %d rows without tenant context", n)
	}
	if _, err := db.Backend.Exec(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1, 'x')`, a.WorkspaceID); err == nil {
		t.Fatal("insert without tenant context succeeded")
	}
}

func TestTenantSettingDoesNotLeakToNextPoolUser(t *testing.T) {
	db := testdb.New(t)
	a := workspace(t, db, "A")
	newRequest(t, db, a, "x")
	// Force connection reuse, then read without a tenant.
	for i := 0; i < 20; i++ {
		var n int
		if err := db.Backend.QueryRow(ctx, `SELECT count(*) FROM request`).Scan(&n); err != nil || n != 0 {
			t.Fatalf("iteration %d: count=%d err=%v", i, n, err)
		}
	}
}

func TestMembershipLookupByUserWithoutWorkspace(t *testing.T) {
	db := testdb.New(t)
	a := workspace(t, db, "A")
	other := workspace(t, db, "B")

	// Sign-in time: only the user id is known.
	tx, err := db.Backend.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id', $1, true)`, a.UserID.String()); err != nil {
		t.Fatal(err)
	}
	mine, err := dbgen.New(tx).ListMyWorkspaces(ctx, a.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 1 || mine[0].WorkspaceID != a.WorkspaceID {
		t.Fatalf("got %+v", mine)
	}
	// ...and cannot see someone else's memberships.
	others, _ := dbgen.New(tx).ListMyWorkspaces(ctx, other.UserID)
	if len(others) != 0 {
		t.Fatalf("saw another user's memberships: %+v", others)
	}
}

func TestBackendRoleIsRestricted(t *testing.T) {
	db := testdb.New(t)
	var super, bypass bool
	err := db.Backend.QueryRow(ctx,
		`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`).Scan(&super, &bypass)
	if err != nil {
		t.Fatal(err)
	}
	if super || bypass {
		t.Fatalf("backend role is too powerful: super=%v bypassrls=%v", super, bypass)
	}
	var owned int
	if err := db.Backend.QueryRow(ctx,
		`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner = current_user`).Scan(&owned); err != nil {
		t.Fatal(err)
	}
	if owned != 0 {
		t.Fatalf("backend role owns %d tables (owners bypass RLS unless forced)", owned)
	}
}

// Fails when anyone adds a table without tenant columns, forced RLS and a policy.
func TestEveryTableIsTenantScopedWithForcedRLS(t *testing.T) {
	db := testdb.New(t)
	exempt := map[string]bool{"goose_db_version": true} // schema bookkeeping, not tenant data
	rows, err := db.Super.Query(ctx, `
		SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
		       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid),
		       EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped)
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var name string
		var rls, forced, hasWS bool
		var policies int
		if err := rows.Scan(&name, &rls, &forced, &policies, &hasWS); err != nil {
			t.Fatal(err)
		}
		if exempt[name] {
			continue
		}
		seen++
		if !rls || !forced || policies == 0 {
			t.Errorf("table %s: rls=%v forced=%v policies=%d", name, rls, forced, policies)
		}
		if name != "workspace" && !hasWS {
			t.Errorf("table %s has no workspace_id column", name)
		}
	}
	if seen < 3 {
		t.Fatalf("expected at least 3 tenant tables, saw %d", seen)
	}
}
