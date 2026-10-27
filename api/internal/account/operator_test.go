package account_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/account"
	"product/api/internal/testdb"
)

func TestFinishingARequestRemovesThePersonButNeverStrandsAWorkspace(t *testing.T) {
	ctx := context.Background()
	db := testdb.New(t)
	user, other := uuid.New(), uuid.New()
	ws := func(name string) uuid.UUID {
		var id uuid.UUID
		if err := db.Super.QueryRow(ctx, `INSERT INTO workspace (name) VALUES ($1) RETURNING id`, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	join := func(w, u uuid.UUID, role string) {
		if _, err := db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,$3)`, w, u, role); err != nil {
			t.Fatal(err)
		}
	}
	shared := ws("Shared") // another admin exists: fine to leave
	crowd := ws("Crowd")   // the person is its only admin and others use it: blocks
	solo := ws("Solo")     // the person is alone in it: blocks unless allowed
	join(shared, user, "admin")
	join(shared, other, "admin")
	join(crowd, user, "admin")
	join(crowd, other, "member")
	join(solo, user, "admin")

	svc := &account.Service{Pool: db.Backend}
	if _, _, err := svc.Request(ctx, user, "Person@Example.com"); err != nil {
		t.Fatal(err)
	}
	list, err := account.ListOpen(ctx, db.Super)
	if err != nil || len(list) != 1 || list[0].Email != "person@example.com" || len(list[0].Workspaces) != 3 {
		t.Fatalf("list: %v %+v", err, list)
	}
	id := list[0].ID

	if _, err := account.Complete(ctx, db.Super, id, true); err == nil || !strings.Contains(err.Error(), "Crowd") {
		t.Fatalf("a last admin of a shared workspace was let go: %v", err)
	}
	join(crowd, uuid.New(), "admin") // someone else takes over
	if _, err := account.Complete(ctx, db.Super, id, false); err == nil || !strings.Contains(err.Error(), "Solo") {
		t.Fatalf("an only member was let go without being told: %v", err)
	}
	var still int
	db.Super.QueryRow(ctx, `SELECT count(*) FROM member WHERE user_id=$1`, user).Scan(&still)
	if still != 3 {
		t.Fatalf("a refused request still removed memberships (%d left)", still)
	}

	if _, err := account.Complete(ctx, db.Super, id, true); err != nil {
		t.Fatal(err)
	}
	db.Super.QueryRow(ctx, `SELECT count(*) FROM member WHERE user_id=$1`, user).Scan(&still)
	if still != 0 {
		t.Errorf("%d memberships left", still)
	}
	var others, workspaces int
	db.Super.QueryRow(ctx, `SELECT count(*) FROM member WHERE user_id=$1`, other).Scan(&others)
	db.Super.QueryRow(ctx, `SELECT count(*) FROM workspace WHERE id IN ($1,$2,$3)`, shared, crowd, solo).Scan(&workspaces)
	if others != 2 || workspaces != 3 {
		t.Errorf("other people or workspaces were touched: members %d, workspaces %d", others, workspaces)
	}
	var status, email string
	db.Super.QueryRow(ctx, `SELECT status, email FROM account_deletion_request WHERE id=$1`, id).Scan(&status, &email)
	if status != "done" || email != "" {
		t.Errorf("request left as %q with address %q", status, email)
	}
	if _, err := account.Complete(ctx, db.Super, id, true); err == nil {
		t.Error("a finished request was finished twice")
	}
}

func TestFinishingARequestReportsTheKeysItEndedSoTheCacheCanForgetThem(t *testing.T) {
	ctx := context.Background()
	db := testdb.New(t)
	user, other := uuid.New(), uuid.New()
	var w uuid.UUID
	if err := db.Super.QueryRow(ctx, `INSERT INTO workspace (name) VALUES ('Keys') RETURNING id`).Scan(&w); err != nil {
		t.Fatal(err)
	}
	for _, u := range []uuid.UUID{user, other} {
		if _, err := db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, w, u); err != nil {
			t.Fatal(err)
		}
	}
	add := func(by uuid.UUID, hash string) {
		if _, err := db.Super.Exec(ctx, `INSERT INTO api_key (workspace_id, name, prefix, key_hash, created_by, scopes, allowed_cidrs) VALUES ($1,'k','fk_xxxxxxx',$2,$3,ARRAY['requests'],ARRAY[]::text[])`, w, hash, by); err != nil {
			t.Fatal(err)
		}
	}
	theirs := strings.Repeat("a", 64)
	add(user, theirs)
	add(other, strings.Repeat("b", 64))
	if _, _, err := (&account.Service{Pool: db.Backend}).Request(ctx, user, "p@example.com"); err != nil {
		t.Fatal(err)
	}
	list, _ := account.ListOpen(ctx, db.Super)
	p, err := account.Complete(ctx, db.Super, list[0].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.KeyHashes) != 1 || p.KeyHashes[0] != theirs {
		t.Fatalf("the keys reported as ended: %v", p.KeyHashes)
	}
}
