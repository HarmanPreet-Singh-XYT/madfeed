package quality_test

import (
	"context"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/quality"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func tenant(t *testing.T, db *testdb.DB) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: "w"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	return ten
}

// seed inserts n proposals in a state, optionally edited, created daysAgo days ago.
func seed(t *testing.T, db *testdb.DB, ten store.Tenant, src, chunk uuid.UUID, state string, edited bool, n, daysAgo, startWord int) {
	t.Helper()
	for i := 0; i < n; i++ {
		k := startWord + i
		_, err := db.Super.Exec(ctx, `INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence, state, edited, created_at)
			VALUES ($1,$2,$3,'new_request','need','t',$4,$5,$6,0.9,$7,$8,$9)`, ten.WorkspaceID, src, chunk, fmt.Sprintf("w%04d", k), k*6, k*6+5, state, edited, time.Now().AddDate(0, 0, -daysAgo))
		if err != nil {
			t.Fatal(err)
		}
	}
}

func approx(a *float64, want float64) bool { return a != nil && math.Abs(*a-want) < 1e-9 }

func TestRatesMatchHandCountedValues(t *testing.T) {
	db := testdb.New(t)
	svc := &quality.Service{Pool: db.Backend}
	ten := tenant(t, db)
	text := ""
	for k := 0; k < 200; k++ {
		text += fmt.Sprintf("w%04d ", k)
	}
	var src, chunk uuid.UUID
	if err := db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ten.WorkspaceID, text, uuid.NewString(), ten.UserID).Scan(&src); err != nil {
		t.Fatal(err)
	}
	if err := db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ten.WorkspaceID, src, len(text), text).Scan(&chunk); err != nil {
		t.Fatal(err)
	}

	// Before anything is decided: no rates, not enough data.
	v, err := svc.Get(ctx, ten, 30)
	if err != nil || v.EnoughData || v.Rates.Accepted != nil || len(v.BySource) != 0 {
		t.Fatalf("%+v %v", v, err)
	}

	// This week: 12 accepted as-is, 6 accepted after edits, 4 dismissed, 5 still open.
	// 10 days ago: 3 accepted as-is, 0 edited, 6 dismissed.
	seed(t, db, ten, src, chunk, "accepted", false, 12, 0, 0)
	seed(t, db, ten, src, chunk, "accepted", true, 6, 0, 12)
	seed(t, db, ten, src, chunk, "dismissed", false, 4, 0, 18)
	seed(t, db, ten, src, chunk, "suggested", false, 5, 0, 22)
	seed(t, db, ten, src, chunk, "accepted", false, 3, 10, 27)
	seed(t, db, ten, src, chunk, "dismissed", false, 6, 10, 30)
	// Older than the window: ignored.
	seed(t, db, ten, src, chunk, "dismissed", false, 5, 90, 36)

	v, err = svc.Get(ctx, ten, 30)
	if err != nil {
		t.Fatal(err)
	}
	// Total: accepted 21 (6 edited), dismissed 10, open 5; decided 31.
	if v.Total != (quality.Counts{Accepted: 21, AcceptedEdited: 6, Dismissed: 10, StillOpen: 5}) {
		t.Fatalf("%+v", v.Total)
	}
	if !v.EnoughData {
		t.Fatal("31 decisions is enough")
	}
	if !approx(v.Rates.Accepted, 21.0/31) || !approx(v.Rates.AcceptedAsIs, 15.0/31) || !approx(v.Rates.EditedOfAccepted, 6.0/21) || !approx(v.Rates.Dismissed, 10.0/31) {
		t.Fatalf("%+v", v.Rates)
	}
	if len(v.BySource) != 1 || v.BySource[0].Kind != "paste" || v.BySource[0].Counts != v.Total {
		t.Fatalf("%+v", v.BySource)
	}
	if len(v.ByWeek) != 2 {
		t.Fatalf("weeks: %+v", v.ByWeek)
	}
	older, newer := v.ByWeek[0], v.ByWeek[1]
	if !older.WeekStart.Before(newer.WeekStart) || older.Counts != (quality.Counts{Accepted: 3, Dismissed: 6}) || newer.Counts != (quality.Counts{Accepted: 18, AcceptedEdited: 6, Dismissed: 4, StillOpen: 5}) {
		t.Fatalf("older %+v newer %+v", older, newer)
	}
	if !approx(older.Rates.Accepted, 3.0/9) {
		t.Fatalf("%+v", older.Rates)
	}

	// A wider window brings the old rows in.
	wide, _ := svc.Get(ctx, ten, 365)
	if wide.Total.Dismissed != 15 {
		t.Fatalf("%+v", wide.Total)
	}

	// AI cost: two calls for one task (one failed), one for another.
	for _, e := range []struct {
		task, outcome string
		cost          float64
	}{{"extraction", "ok", 0.0125}, {"extraction", "error", 0}, {"brief", "ok", 0.05}} {
		if _, err := db.Super.Exec(ctx, `INSERT INTO ai_event (workspace_id, task, tier, provider, model, prompt_version, input_tokens, output_tokens, cost_usd, outcome) VALUES ($1,$2,'mid','p','m','v',1000,100,$3,$4)`, ten.WorkspaceID, e.task, e.cost, e.outcome); err != nil {
			t.Fatal(err)
		}
	}
	v, _ = svc.Get(ctx, ten, 30)
	if len(v.AI) != 2 || v.AI[0].Task != "brief" || v.AI[0].CostUSD != "0.050000" || v.AI[1].Task != "extraction" || v.AI[1].Calls != 2 || v.AI[1].Errors != 1 || v.AI[1].CostUSD != "0.012500" || v.AI[1].InputTokens != 2000 {
		t.Fatalf("%+v", v.AI)
	}

	// Another workspace sees none of it.
	other := tenant(t, db)
	if ov, _ := svc.Get(ctx, other, 30); ov.Total.Decided() != 0 || len(ov.AI) != 0 {
		t.Fatalf("leak: %+v", ov)
	}
}
