package billing

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"product/api/internal/cache"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

func TestThePlanIsRememberedAndAWriteThroughTheServiceForgetsIt(t *testing.T) {
	ctx := context.Background()
	db := testdb.New(t)
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })

	ws := uuid.New()
	ten := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: store.RoleAdmin}
	err = store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ws, Name: "billing"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: ten.UserID, Role: "admin"})
	})
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{Pool: db.Backend, Cache: rc}
	set := func(plan string) {
		t.Helper()
		err := store.WithTenant(ctx, db.Backend, system(ws), func(q *dbgen.Queries) error {
			if err := q.EnsureBillingAccount(ctx, ws); err != nil {
				return err
			}
			return q.SetBillingSubscription(ctx, dbgen.SetBillingSubscriptionParams{WorkspaceID: ws, PlanID: plan, Status: "active", LastEventAt: time.Now()})
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	set("team")
	if a, err := s.account(ctx, ws); err != nil || a.PlanID != "team" {
		t.Fatalf("first read: %+v %v", a, err)
	}
	set("scale") // behind the cache's back
	if a, _ := s.account(ctx, ws); a.PlanID != "team" {
		t.Fatalf("the account was not served from the cache: %s", a.PlanID)
	}
	s.forget(ctx, ws)
	if a, _ := s.account(ctx, ws); a.PlanID != "scale" {
		t.Fatalf("after forgetting, still %s", a.PlanID)
	}
	other := uuid.New()
	if a, _ := s.account(ctx, other); a.PlanID != "free" || a.Status != "none" {
		t.Fatalf("another workspace saw %+v", a)
	}
}
