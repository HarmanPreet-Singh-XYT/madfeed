package team_test

import (
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"product/api/internal/cache"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/team"
	"product/api/internal/testdb"
)

// A role change or removal must take effect at once, not when the remembered role runs out.
func TestChangingARoleOrRemovingSomeoneIsFeltImmediately(t *testing.T) {
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
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: admin.WorkspaceID, Name: "team"}); err != nil {
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
	svc := &team.Service{Pool: db.Backend, Cache: rc}
	role := func() (store.Role, error) {
		got, err := store.ResolveTenantCached(ctx, db.Backend, rc, mate, admin.WorkspaceID)
		return got.Role, err
	}

	if r, err := role(); err != nil || r != store.RoleMember {
		t.Fatalf("start: %s %v", r, err)
	}
	if err := svc.SetRole(ctx, admin, mate, "viewer"); err != nil {
		t.Fatal(err)
	}
	if r, err := role(); err != nil || r != store.RoleViewer {
		t.Fatalf("after demotion a stale role was served: %s %v", r, err)
	}
	if err := svc.Remove(ctx, admin, mate); err != nil {
		t.Fatal(err)
	}
	if _, err := role(); !errors.Is(err, store.ErrNotMember) {
		t.Fatalf("a removed person still resolves: %v", err)
	}
}
