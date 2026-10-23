package api

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSpotChecksOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Audit")
	base := "/v1/workspaces/" + ws
	ctx := context.Background()
	if code, body, _ := h.do(h.alice, "GET", base+"/audit", nil); code != 200 || len(body["items"].([]any)) != 0 {
		t.Fatalf("empty: %d %v", code, body)
	}
	var src, chunk, req, ev, ans uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	text := "We really need single sign-on today."
	must(h.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, text, uuid.NewString(), h.aliceID).Scan(&src))
	must(h.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(text), text).Scan(&chunk))
	must(h.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'R') RETURNING id`, ws).Scan(&req))
	must(h.db.Super.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,'single sign-on',15,29,$5) RETURNING id`, ws, req, src, chunk, h.aliceID).Scan(&ev))
	must(h.db.Super.QueryRow(ctx, `INSERT INTO qa_answer (workspace_id, asked_by, question, outcome, answer) VALUES ($1,$2,'Why SSO?','answered','They need it [1].') RETURNING id`, ws, h.aliceID).Scan(&ans))
	_, err := h.db.Super.Exec(ctx, `INSERT INTO qa_citation (workspace_id, answer_id, ordinal, evidence_id) VALUES ($1,$2,1,$3)`, ws, ans, ev)
	must(err)
	var n int
	must(h.db.Super.QueryRow(ctx, `SELECT sample_for_audit(3)`).Scan(&n))

	code, body, _ := h.do(h.alice, "GET", base+"/audit", nil)
	items, _ := body["items"].([]any)
	if code != 200 || len(items) < 1 {
		t.Fatalf("%d %v", code, body)
	}
	var mine map[string]any
	for _, x := range items {
		if m := x.(map[string]any); m["heading"] == "Why SSO?" {
			mine = m
		}
	}
	if mine == nil || mine["kind"] != "answer" || len(mine["quotes"].([]any)) != 1 || mine["quotes"].([]any)[0].(map[string]any)["text"] != "single sign-on" {
		t.Fatalf("%v", items)
	}
	id := mine["id"].(string)
	if code, _, _ := h.do(h.alice, "PUT", base+"/audit/"+id, map[string]any{"verdict": "supported", "note": "ok"}); code != 204 {
		t.Fatalf("review: %d", code)
	}
	if code, _, _ := h.do(h.alice, "PUT", base+"/audit/"+id, map[string]any{"verdict": "supported"}); code != 409 {
		t.Fatalf("twice: %d", code)
	}
	if code, _, _ := h.do(h.alice, "PUT", base+"/audit/"+id, map[string]any{"verdict": "great"}); code != 400 {
		t.Fatalf("bad verdict: %d", code)
	}
	_, after, _ := h.do(h.alice, "GET", base+"/audit", nil)
	if after["reviewed"].(float64) != 1 || after["supported"].(float64) != 1 {
		t.Fatalf("%v", after)
	}
	// Members cannot see it.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	_, err = h.db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID)
	must(err)
	if code, _, _ := h.do(h.bob, "GET", base+"/audit", nil); code != 403 {
		t.Fatalf("member: %d", code)
	}
}
