package workspaces_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"product/api/internal/cache"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
	"product/api/internal/workspaces"
)

func TestDeletingAWorkspaceDropsEveryMembersRememberedRole(t *testing.T) {
	ctx := context.Background()
	db := testdb.New(t)
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })

	admin := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	mate := uuid.New()
	err = store.WithTenant(ctx, db.Backend, admin, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: admin.WorkspaceID, Name: "gone"}); err != nil {
			return err
		}
		if err := q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: admin.WorkspaceID, UserID: admin.UserID, Role: "admin"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: admin.WorkspaceID, UserID: mate, Role: "member"})
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []uuid.UUID{admin.UserID, mate} {
		if _, err := store.ResolveTenantCached(ctx, db.Backend, rc, u, admin.WorkspaceID); err != nil {
			t.Fatal(err)
		}
	}
	if err := (&workspaces.Service{Pool: db.Backend, Cache: rc}).Delete(ctx, admin, "gone"); err != nil {
		t.Fatal(err)
	}
	for _, u := range []uuid.UUID{admin.UserID, mate} {
		if _, err := store.ResolveTenantCached(ctx, db.Backend, rc, u, admin.WorkspaceID); !errors.Is(err, store.ErrNotMember) {
			t.Fatalf("a member of a deleted workspace still resolves: %v", err)
		}
	}
}

func TestDeletingAWorkspaceEndsItsRememberedKeysAndPlanToo(t *testing.T) {
	ctx := context.Background()
	db := testdb.New(t)
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })

	admin := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	err = store.WithTenant(ctx, db.Backend, admin, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: admin.WorkspaceID, Name: "gone2"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: admin.WorkspaceID, UserID: admin.UserID, Role: "admin"})
	})
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("c", 64)
	if _, err := db.Super.Exec(ctx, `INSERT INTO api_key (workspace_id, name, prefix, key_hash, created_by, scopes, allowed_cidrs) VALUES ($1,'k','fk_xxxxxxx',$2,$3,ARRAY['requests'],ARRAY[]::text[])`, admin.WorkspaceID, hash, admin.UserID); err != nil {
		t.Fatal(err)
	}
	_ = rc.Set(ctx, cache.APIKeyKey(hash), []byte("remembered"), time.Minute)
	_ = rc.Set(ctx, cache.PlanKey(admin.WorkspaceID), []byte("remembered"), time.Minute)

	if err := (&workspaces.Service{Pool: db.Backend, Cache: rc}).Delete(ctx, admin, "gone2"); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{cache.APIKeyKey(hash), cache.PlanKey(admin.WorkspaceID)} {
		if _, ok, _ := rc.Get(ctx, k); ok {
			t.Errorf("%s survived the workspace", strings.SplitN(k, ":", 2)[0])
		}
	}
}
