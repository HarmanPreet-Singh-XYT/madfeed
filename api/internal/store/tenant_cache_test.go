package store_test

import (
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"product/api/internal/cache"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

func newCache(t *testing.T) (*cache.Redis, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })
	return rc, mr
}

func TestARoleIsRememberedUntilItIsForgotten(t *testing.T) {
	db := testdb.New(t)
	rc, _ := newCache(t)
	ten := workspace(t, db, "cached")

	got, err := store.ResolveTenantCached(ctx, db.Backend, rc, ten.UserID, ten.WorkspaceID)
	if err != nil || got.Role != store.RoleAdmin {
		t.Fatalf("first lookup: %+v %v", got, err)
	}
	// Change the role behind the cache's back: the remembered one is served, which proves the database was skipped.
	if _, err := db.Super.Exec(ctx, `UPDATE member SET role = 'viewer' WHERE workspace_id = $1 AND user_id = $2`, ten.WorkspaceID, ten.UserID); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.ResolveTenantCached(ctx, db.Backend, rc, ten.UserID, ten.WorkspaceID); got.Role != store.RoleAdmin {
		t.Fatalf("the role was not served from the cache: %s", got.Role)
	}
	cache.ForgetTenant(ctx, rc, ten.WorkspaceID, ten.UserID)
	if got, _ := store.ResolveTenantCached(ctx, db.Backend, rc, ten.UserID, ten.WorkspaceID); got.Role != store.RoleViewer {
		t.Fatalf("after forgetting, still %s", got.Role)
	}
}

func TestNotBeingAMemberIsNeverRememberedAndOneWorkspaceCannotAnswerForAnother(t *testing.T) {
	db := testdb.New(t)
	rc, mr := newCache(t)
	a, b := workspace(t, db, "A"), workspace(t, db, "B")

	if _, err := store.ResolveTenantCached(ctx, db.Backend, rc, a.UserID, b.WorkspaceID); !errors.Is(err, store.ErrNotMember) {
		t.Fatalf("a stranger resolved: %v", err)
	}
	if len(mr.Keys()) != 0 {
		t.Fatalf("a refusal was cached: %v", mr.Keys())
	}
	// Joining right after a refusal works at once.
	err := store.WithTenant(ctx, db.Backend, b, func(q *dbgen.Queries) error {
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: b.WorkspaceID, UserID: a.UserID, Role: "member"})
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, err := store.ResolveTenantCached(ctx, db.Backend, rc, a.UserID, b.WorkspaceID); err != nil || got.Role != store.RoleMember {
		t.Fatalf("after joining: %+v %v", got, err)
	}
	// A's admin entry never answers for B, nor B's for A.
	if _, err := store.ResolveTenantCached(ctx, db.Backend, rc, a.UserID, a.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveTenantCached(ctx, db.Backend, rc, uuid.New(), a.WorkspaceID); !errors.Is(err, store.ErrNotMember) {
		t.Fatalf("another person resolved through A's entry: %v", err)
	}
}

func TestACacheThatIsDownChangesNothing(t *testing.T) {
	db := testdb.New(t)
	rc, mr := newCache(t)
	ten := workspace(t, db, "down")
	mr.Close()
	got, err := store.ResolveTenantCached(ctx, db.Backend, rc, ten.UserID, ten.WorkspaceID)
	if err != nil || got.Role != store.RoleAdmin {
		t.Fatalf("with the cache down: %+v %v", got, err)
	}
}

func TestAGarbledEntryIsIgnored(t *testing.T) {
	db := testdb.New(t)
	rc, mr := newCache(t)
	ten := workspace(t, db, "garbled")
	_ = mr.Set("t:"+cache.TenantKey(ten.WorkspaceID, ten.UserID), "superuser")
	if got, err := store.ResolveTenantCached(ctx, db.Backend, rc, ten.UserID, ten.WorkspaceID); err != nil || got.Role != store.RoleAdmin {
		t.Fatalf("a bad entry was trusted: %+v %v", got, err)
	}
}
