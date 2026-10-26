package api

import (
	"context"
	"testing"
)

func TestDeletingAWorkspaceRemovesEverythingInItAndNothingElse(t *testing.T) {
	h := newHarness(t)
	ws, key := h.formWorkspace("doomed")
	other := h.workspace(h.alice, "Keeper")
	h.post("doomed", key, siteOrigin, "some feedback", "pat@example.com")
	h.db.Super.Exec(context.Background(), `INSERT INTO conversation (workspace_id, channel, customer_email, ref) VALUES ($1,'chat','pat@example.com','abcdef')`, ws)

	// a stranger, a wrong name and a missing confirmation all leave it alone
	if code, _, _ := h.do(h.bob, "POST", "/v1/workspaces/"+ws+"/delete", map[string]any{"confirmName": "x"}); code != 404 {
		t.Errorf("a stranger: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/delete", map[string]any{"confirmName": "not its name"}); code != 400 {
		t.Errorf("wrong name: %d", code)
	}
	var name string
	h.db.Super.QueryRow(context.Background(), `SELECT name FROM workspace WHERE id=$1`, ws).Scan(&name)
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/delete", map[string]any{"confirmName": name}); code != 204 {
		t.Fatalf("delete: %d", code)
	}

	// no table keeps a row that belongs to it
	rows, err := h.db.Super.Query(context.Background(), `SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='workspace_id' AND table_name NOT IN (SELECT table_name FROM information_schema.views WHERE table_schema='public')`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var n string
		rows.Scan(&n)
		tables = append(tables, n)
	}
	rows.Close()
	if len(tables) < 20 {
		t.Fatalf("found only %d tables with a workspace_id; the check is broken", len(tables))
	}
	for _, tb := range tables {
		var n int
		if err := h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM `+tb+` WHERE workspace_id=$1`, ws).Scan(&n); err != nil {
			t.Fatalf("%s: %v", tb, err)
		}
		if n != 0 {
			t.Errorf("%s still has %d rows for the deleted workspace", tb, n)
		}
	}
	var keeper int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM workspace WHERE id=$1`, other).Scan(&keeper)
	if keeper != 1 {
		t.Error("another workspace was removed")
	}
	// and it is really gone for its former admin
	if code, _, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/settings", nil); code != 404 {
		t.Errorf("settings of a deleted workspace: %d", code)
	}
}

func TestAWorkspaceWithALiveSubscriptionCannotBeDeleted(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Paying")
	h.db.Super.Exec(context.Background(), `INSERT INTO billing_account (workspace_id, stripe_customer_id, stripe_subscription_id, plan_id, status) VALUES ($1,'cus_x','sub_x','team','active')`, ws)
	if code, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/delete", map[string]any{"confirmName": "Paying"}); code != 400 {
		t.Errorf("deleting while subscribed: %d", code)
	}
	var n int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM workspace WHERE id=$1`, ws).Scan(&n)
	if n != 1 {
		t.Error("the workspace was deleted anyway")
	}
}
