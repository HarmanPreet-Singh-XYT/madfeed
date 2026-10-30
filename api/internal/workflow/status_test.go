package workflow_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/store"
	"product/api/internal/testdb"
	"product/api/internal/workflow"
)

var statusCtx = context.Background()

// A workspace with the default statuses and one admin.
func statusEnv(t *testing.T) (*testdb.DB, *workflow.Service, store.Tenant) {
	t.Helper()
	db := testdb.New(t)
	ws := uuid.New()
	admin := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: store.RoleAdmin}
	if _, err := db.Super.Exec(statusCtx, `INSERT INTO workspace (id, name) VALUES ($1,$2)`, ws, "Statuses"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Super.Exec(statusCtx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, ws, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Super.Exec(statusCtx, `SELECT seed_default_statuses($1)`, ws); err != nil {
		t.Fatal(err)
	}
	return db, &workflow.Service{Pool: db.Backend}, admin
}

func TestStatusesCanChangeBucketAndOrderButNotDeleteWhatRequestsAreIn(t *testing.T) {
	db, svc, admin := statusEnv(t)
	list, err := svc.List(statusCtx, admin)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) < 3 {
		t.Fatalf("expected the default statuses, got %d", len(list))
	}
	planned := list[1]
	hasShipped := false
	for _, st := range list {
		if st.Bucket == "done" {
			hasShipped = true
		}
	}
	if !hasShipped {
		t.Fatalf("the defaults should include a shipped status: %+v", list)
	}

	// the bucket can change; the name stays
	bucket := "done"
	if err := svc.Update(statusCtx, admin, planned.ID, nil, &bucket, nil); err != nil {
		t.Fatal(err)
	}
	list, _ = svc.List(statusCtx, admin)
	if list[1].Bucket != "done" || list[1].Name != planned.Name {
		t.Errorf("bucket change: %+v", list[1])
	}
	// a change with nothing in it is refused rather than silently doing nothing
	var inv workflow.ErrInvalid
	if err := svc.Update(statusCtx, admin, planned.ID, nil, nil, nil); !errors.As(err, &inv) {
		t.Errorf("empty update: %v", err)
	}

	// reordering takes the whole list, in one statement
	ids := make([]uuid.UUID, len(list))
	for i := range list {
		ids[i] = list[len(list)-1-i].ID
	}
	if err := svc.Reorder(statusCtx, admin, ids); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.List(statusCtx, admin)
	if after[0].ID != ids[0] {
		t.Errorf("reorder did not take: first is %s, want %s", after[0].ID, ids[0])
	}
	// a list that is not the whole list is refused
	if err := svc.Reorder(statusCtx, admin, ids[:1]); !errors.As(err, &inv) {
		t.Errorf("partial reorder: %v", err)
	}

	// deleting a status a request is in is refused, in words that say what to do
	if _, err := db.Super.Exec(statusCtx, `INSERT INTO request (workspace_id, title, status_id) VALUES ($1,'Needs export',$2)`, admin.WorkspaceID, planned.ID); err != nil {
		t.Fatal(err)
	}
	var conflict workflow.ErrConflict
	if err := svc.Delete(statusCtx, admin, planned.ID); !errors.As(err, &conflict) {
		t.Errorf("deleting a used status: %v", err)
	}
	// an unused one goes
	unused := list[2]
	if unused.ID == planned.ID {
		unused = list[3]
	}
	if err := svc.Delete(statusCtx, admin, unused.ID); err != nil {
		t.Errorf("deleting an unused status: %v", err)
	}

	// a member cannot change any of it
	member := admin
	member.Role = store.RoleMember
	if err := svc.Delete(statusCtx, member, list[0].ID); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("member delete: %v", err)
	}
}
