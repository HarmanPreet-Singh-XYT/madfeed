package store_test

import (
	"context"
	"errors"
	"strings"
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
	if len(mine) != 1 || mine[0].WorkspaceID != a.WorkspaceID || mine[0].Name != "A" || mine[0].Role != "admin" {
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
	exempt := map[string]bool{"goose_db_version": true, "rate_limit": true, "stripe_event": true, "oauth_client": true, "account_deletion_request": true} // account_deletion_request belongs to a person, not a workspace (forced RLS on app.user_id); schema bookkeeping, request counters and payment-event ids: no tenant data, closed to all but their own functions
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

// --- Phase 1: evidence integrity enforced by the database itself ---

func newSource(t *testing.T, db *testdb.DB, ten store.Tenant, text string) dbgen.SourceItem {
	t.Helper()
	var si dbgen.SourceItem
	err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) (err error) {
		si, err = q.InsertSourceItem(ctx, dbgen.InsertSourceItemParams{
			WorkspaceID: ten.WorkspaceID, Kind: "paste", RawText: text, ContentHash: uuid.NewString(), CreatedBy: ten.UserID})
		return
	})
	if err != nil {
		t.Fatal(err)
	}
	return si
}

func TestDatabaseRejectsQuotesThatAreNotInTheSource(t *testing.T) {
	db := testdb.New(t)
	a := workspace(t, db, "A")
	text := "Hello. We need SSO badly. Café ☕ too."
	si := newSource(t, db, a, text)

	insert := func(quote string, start, end int) error {
		return store.WithTenant(ctx, db.Backend, a, func(q *dbgen.Queries) error {
			ch, err := q.InsertChunk(ctx, dbgen.InsertChunkParams{WorkspaceID: a.WorkspaceID, SourceItemID: si.ID, Ordinal: int32(time.Now().Nanosecond() % 1e6), StartOffset: 0, EndOffset: int32(len(text)), Text: text})
			if err != nil {
				return err
			}
			req, err := q.CreateMachineRequest(ctx, dbgen.CreateMachineRequestParams{WorkspaceID: a.WorkspaceID, Title: "t"})
			if err != nil {
				return err
			}
			_, err = q.InsertEvidence(ctx, dbgen.InsertEvidenceParams{WorkspaceID: a.WorkspaceID, RequestID: req.ID, SourceItemID: si.ID, ChunkID: ch.ID,
				QuoteText: quote, SpanStart: int32(start), SpanEnd: int32(end), CreatedBy: a.UserID})
			return err
		})
	}
	q1 := "We need SSO badly"
	s1 := strings.Index(text, q1)
	cafe := strings.Index(text, "Café ☕")
	if err := insert(q1, s1, s1+len(q1)); err != nil {
		t.Fatalf("valid quote rejected: %v", err)
	}
	if err := insert("Café ☕", cafe, cafe+len("Café ☕")); err != nil {
		t.Fatalf("valid unicode quote rejected (byte offsets): %v", err)
	}
	for name, c := range map[string]struct {
		quote      string
		start, end int
	}{
		"paraphrase":     {"They need single sign-on", s1, s1 + len(q1)},
		"wrong offsets":  {q1, s1 + 1, s1 + 1 + len(q1)},
		"case changed":   {"we need sso badly", s1, s1 + len(q1)},
		"past the end":   {q1, len(text) - 3, len(text) + 10},
		"zero length":    {"x", 5, 5},
		"negative start": {q1, -1, 4},
	} {
		if err := insert(c.quote, c.start, c.end); err == nil {
			t.Errorf("%s: database accepted a quote that is not in the source", name)
		}
	}
}

func TestSourceTextIsImmutableAndCrossTenantLinksAreRejected(t *testing.T) {
	db := testdb.New(t)
	a, b := workspace(t, db, "A"), workspace(t, db, "B")
	si := newSource(t, db, a, "original text")

	// Update inside a tenant transaction: the text must be immutable.
	err := store.WithTenant(ctx, db.Backend, a, func(q *dbgen.Queries) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Backend.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.workspace_id', $1, true)`, a.WorkspaceID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE source_item SET raw_text = 'tampered' WHERE id = $1`, si.ID); err == nil {
		t.Error("source text was modified")
	}

	// A source item in B cannot reference a person that belongs to A.
	var pa dbgen.Person
	_ = store.WithTenant(ctx, db.Backend, a, func(q *dbgen.Queries) (err error) {
		pa, err = q.CreatePerson(ctx, dbgen.CreatePersonParams{WorkspaceID: a.WorkspaceID, Name: "Dana"})
		return
	})
	err = store.WithTenant(ctx, db.Backend, b, func(q *dbgen.Queries) error {
		_, err := q.InsertSourceItem(ctx, dbgen.InsertSourceItemParams{WorkspaceID: b.WorkspaceID, Kind: "paste", RawText: "x",
			ContentHash: uuid.NewString(), PersonID: uuid.NullUUID{UUID: pa.ID, Valid: true}, CreatedBy: b.UserID})
		return err
	})
	if err == nil {
		t.Error("cross-tenant person reference accepted")
	}
}

func TestResolveTenantReadsRoleFromOurTablesAndHidesOtherWorkspaces(t *testing.T) {
	db := testdb.New(t)
	a, b := workspace(t, db, "A"), workspace(t, db, "B")

	got, err := store.ResolveTenant(ctx, db.Backend, a.UserID, a.WorkspaceID)
	if err != nil || got.Role != store.RoleAdmin || got.WorkspaceID != a.WorkspaceID {
		t.Fatalf("%+v %v", got, err)
	}
	// A real user, a real workspace, but not a member: indistinguishable from a missing workspace.
	if _, err := store.ResolveTenant(ctx, db.Backend, a.UserID, b.WorkspaceID); !errors.Is(err, store.ErrNotMember) {
		t.Errorf("non-member: %v", err)
	}
	if _, err := store.ResolveTenant(ctx, db.Backend, a.UserID, uuid.New()); !errors.Is(err, store.ErrNotMember) {
		t.Errorf("missing workspace: %v", err)
	}
	// Name listing under user-only context sees own workspaces only.
	tx, _ := db.Backend.Begin(ctx)
	defer tx.Rollback(ctx)
	_, _ = tx.Exec(ctx, `SELECT set_config('app.user_id', $1, true)`, a.UserID.String())
	var n int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM workspace`).Scan(&n)
	if n != 1 {
		t.Errorf("user sees %d workspaces, want 1", n)
	}
	// The listing policy is read-only.
	if _, err := tx.Exec(ctx, `UPDATE workspace SET name = 'x'`); err != nil {
		t.Fatal(err)
	}
	var name string
	_ = tx.QueryRow(ctx, `SELECT name FROM workspace`).Scan(&name)
	if name != "A" {
		t.Errorf("user-only context modified a workspace: %q", name)
	}
}

// Every policy must really compare workspace_id with the transaction's
// workspace, for reads and for writes. A policy that merely exists (say,
// USING (true)) would pass the check above and leak everything.
func TestEveryPolicyBindsRowsToTheTransactionsWorkspace(t *testing.T) {
	db := testdb.New(t)
	rows, err := db.Super.Query(ctx, `
		SELECT c.relname, p.polname, p.polcmd, coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
		FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type cover struct{ read, write bool }
	tables := map[string]*cover{}
	for rows.Next() {
		var table, name, cmd, using, check string
		if err := rows.Scan(&table, &name, &cmd, &using, &check); err != nil {
			t.Fatal(err)
		}
		c := tables[table]
		if c == nil {
			c = &cover{}
			tables[table] = c
		}
		bound := func(expr string) bool {
			return strings.Contains(expr, "app_workspace_id()") || strings.Contains(expr, "app_user_id()")
		}
		// own_memberships and the listing policy are the two deliberate exceptions: they bind to the user.
		switch cmd {
		case "*": // ALL
			if !bound(using) || !bound(check) {
				t.Errorf("%s.%s: ALL policy does not use the tenant functions (USING %q, CHECK %q)", table, name, using, check)
			}
			c.read, c.write = true, true
		case "r":
			if !bound(using) {
				t.Errorf("%s.%s: SELECT policy is not tenant-bound: %q", table, name, using)
			}
			c.read = true
		default:
			t.Errorf("%s.%s: unexpected policy command %q", table, name, cmd)
		}
	}
	for table, c := range tables {
		if !c.read {
			t.Errorf("%s has no read policy", table)
		}
		_ = c.write // read-only tables (the membership listing) are allowed
	}
}

// The public-facing Supabase roles must hold no privilege on anything we own.
func TestPublicRolesHoldNoPrivileges(t *testing.T) {
	db := testdb.New(t)
	var roles []string
	rows, _ := db.Super.Query(ctx, `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`)
	for rows.Next() {
		var r string
		_ = rows.Scan(&r)
		roles = append(roles, r)
	}
	rows.Close()
	if len(roles) == 0 {
		// The test database has no Supabase roles; create them the way Supabase does and re-run the migrations' effect.
		for _, r := range []string{"anon", "authenticated"} {
			_, _ = db.Super.Exec(ctx, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='"+r+"') THEN CREATE ROLE "+r+" NOLOGIN; END IF; END $$")
		}
		t.Skip("no Supabase roles in the test database; covered by the hosted check in docs/gates/gate-0.md")
	}
	for _, r := range roles {
		var n int
		if err := db.Super.QueryRow(ctx, `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = $1`, r).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%s holds %d table privileges", r, n)
		}
	}
}
