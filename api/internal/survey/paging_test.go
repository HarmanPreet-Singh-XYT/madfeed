package survey_test

import (
	"testing"

	"product/api/internal/survey"
)

func TestSurveysComeBackOnePageAtATime(t *testing.T) {
	e := setup(t)
	ids := make([]string, 0, 5)
	for i := 0; i < 5; i++ {
		id, err := e.svc.Create(ctx, e.member, survey.Basics{Title: "Survey " + string(rune('1'+i)), Delivery: "open"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id.String())
		// One minute apart, newest first, so the keyset order is deterministic.
		e.exec(t, `UPDATE survey SET created_at = now() - make_interval(mins => $2) WHERE workspace_id=$1 AND id=$3`, e.ws, i, id)
	}

	page1, next, err := e.svc.ListPage(ctx, e.member, survey.PageOptions{Limit: 2})
	if err != nil || next == nil {
		t.Fatalf("%v next=%v", err, next)
	}
	if len(page1) != 2 || page1[0].ID.String() != ids[0] || page1[1].ID.String() != ids[1] {
		t.Fatalf("page 1: %+v", page1)
	}
	page2, next2, err := e.svc.ListPage(ctx, e.member, survey.PageOptions{Limit: 2, Cursor: next})
	if err != nil || len(page2) != 2 || page2[0].ID.String() != ids[2] || page2[1].ID.String() != ids[3] {
		t.Fatalf("page 2: %v %+v", err, page2)
	}
	page3, next3, err := e.svc.ListPage(ctx, e.member, survey.PageOptions{Limit: 2, Cursor: next2})
	if err != nil || len(page3) != 1 || page3[0].ID.String() != ids[4] || next3 != nil {
		t.Fatalf("page 3: %v %+v next=%v", err, page3, next3)
	}

	// A viewer reads the same list; a silly limit is clamped, not refused.
	if rows, _, err := e.svc.ListPage(ctx, e.viewer, survey.PageOptions{Limit: 500}); err != nil || len(rows) != 5 {
		t.Fatalf("viewer: %v %+v", err, rows)
	}
	if rows, _, err := e.svc.ListPage(ctx, e.member, survey.PageOptions{}); err != nil || len(rows) != 5 {
		t.Fatalf("default limit: %v %+v", err, rows)
	}
}
