package api

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestRenameAndDeleteRequestOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Request edit")
	wsID := uuid.MustParse(ws)
	base := "/v1/workspaces/" + ws

	var id uuid.UUID
	if err := h.db.Super.QueryRow(context.Background(), `INSERT INTO request (workspace_id, title) VALUES ($1,$2) RETURNING id`, wsID, "Old title").Scan(&id); err != nil {
		t.Fatal(err)
	}
	path := base + "/requests/" + id.String()

	// An editor can rename it, and the title is trimmed.
	if code, body, _ := h.do(h.alice, "PATCH", path, map[string]any{"title": "  New   title "}); code != 204 {
		t.Fatalf("rename: %d %v", code, body)
	}
	if code, got, _ := h.do(h.alice, "GET", path, nil); code != 200 || got["title"] != "New title" {
		t.Fatalf("after rename: %d %v", code, got)
	}
	// An empty title and an unknown request are refused.
	if code, _, _ := h.do(h.alice, "PATCH", path, map[string]any{"title": "   "}); code != 400 {
		t.Fatalf("empty title: %d", code)
	}
	if code, _, _ := h.do(h.alice, "PATCH", base+"/requests/"+uuid.NewString(), map[string]any{"title": "x"}); code != 404 {
		t.Fatalf("unknown request: %d", code)
	}

	// A viewer can do neither.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, wsID, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "PATCH", path, map[string]any{"title": "viewer"}); code != 403 {
		t.Fatalf("viewer rename: %d", code)
	}
	if code, _, _ := h.do(h.bob, "DELETE", path, nil); code != 403 {
		t.Fatalf("viewer delete: %d", code)
	}

	// A member may rename but not delete.
	member := uuid.New()
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, wsID, member); err != nil {
		t.Fatal(err)
	}
	memberToken := "t:" + member.String()
	if code, _, _ := h.do(memberToken, "PATCH", path, map[string]any{"title": "Member title"}); code != 204 {
		t.Fatalf("member rename: %d", code)
	}
	if code, _, _ := h.do(memberToken, "DELETE", path, nil); code != 403 {
		t.Fatalf("member delete: %d", code)
	}

	// An admin deletes it; it is gone from the detail and the list.
	if code, body, _ := h.do(h.alice, "DELETE", path, nil); code != 204 {
		t.Fatalf("delete: %d %v", code, body)
	}
	if code, _, _ := h.do(h.alice, "GET", path, nil); code != 404 {
		t.Fatalf("after delete: %d", code)
	}
	if titles, _ := h.titles(h.alice, base+"/requests"); len(titles) != 0 {
		t.Fatalf("deleted request still listed: %v", titles)
	}
}

func TestReorderRoadmapOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Roadmap order")
	wsID := uuid.MustParse(ws)
	base := "/v1/workspaces/" + ws

	ids := make([]uuid.UUID, 3)
	for i := range ids {
		if err := h.db.Super.QueryRow(context.Background(),
			`INSERT INTO request (workspace_id, title) VALUES ($1,$2) RETURNING id`,
			wsID, fmt.Sprintf("Item %d", i)).Scan(&ids[i]); err != nil {
			t.Fatal(err)
		}
	}

	// The order sent is the order stored: 3, 1, 2.
	order := []string{ids[2].String(), ids[0].String(), ids[1].String()}
	if code, body, _ := h.do(h.alice, "PUT", base+"/roadmap/order", map[string]any{"ids": order}); code != 204 {
		t.Fatalf("reorder: %d %v", code, body)
	}
	_, list, _ := h.do(h.alice, "GET", base+"/requests?limit=10", nil)
	pos := map[string]float64{}
	for _, raw := range list["requests"].([]any) {
		r := raw.(map[string]any)
		if p, ok := r["roadmapPosition"].(float64); ok {
			pos[r["id"].(string)] = p
		}
	}
	for i, id := range ids {
		want := map[uuid.UUID]float64{ids[2]: 0, ids[0]: 1, ids[1]: 2}[id]
		if pos[id.String()] != want {
			t.Errorf("%v: position %v, want %v (all %v)", id, pos[id.String()], want, pos)
		}
		_ = i
	}

	// A viewer cannot reorder; an unknown id is a 404.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, wsID, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "PUT", base+"/roadmap/order", map[string]any{"ids": order}); code != 403 {
		t.Fatalf("viewer reorder: %d", code)
	}
	if code, _, _ := h.do(h.alice, "PUT", base+"/roadmap/order", map[string]any{"ids": []string{uuid.NewString()}}); code != 404 {
		t.Fatalf("unknown id: %d", code)
	}
}
