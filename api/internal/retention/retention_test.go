package retention_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/retention"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func TestWorkingDataExpiresButCustomerRecordsNeverDo(t *testing.T) {
	db := testdb.New(t)
	ws, user := uuid.New(), uuid.New()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	exec := func(q string, args ...any) {
		t.Helper()
		_, err := db.Super.Exec(ctx, q, args...)
		must(err)
	}
	exec(`INSERT INTO workspace (id, name) VALUES ($1,'R')`, ws)
	exec(`INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, ws, user)
	var src, chunk, req, person uuid.UUID
	text := "We really need single sign-on today."
	must(db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, text, uuid.NewString(), user).Scan(&src))
	must(db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(text), text).Scan(&chunk))
	must(db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'SSO') RETURNING id`, ws).Scan(&req))
	must(db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email) VALUES ($1,'P','p@x.co') RETURNING id`, ws).Scan(&person))
	exec(`INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,'single sign-on',15,29,$6)`, ws, req, src, chunk, person, user)
	exec(`INSERT INTO suppression (workspace_id, email, reason, created_at) VALUES ($1,'gone@x.co','unsubscribed', now() - interval '5 years')`, ws)

	old, fresh := "now() - interval '3 years'", "now() - interval '2 days'"
	for i, at := range []string{old, fresh} {
		exec(`INSERT INTO qa_answer (workspace_id, asked_by, question, outcome, reason, created_at) VALUES ($1,$2,'q','no_evidence','r',`+at+`)`, ws, user)
		exec(`INSERT INTO ai_event (workspace_id, task, tier, provider, model, prompt_version, cost_usd, latency_ms, outcome, created_at) VALUES ($1,'t','mid','p','m','v',0.01,5,'ok',`+at+`)`, ws)
		exec(`INSERT INTO notice (workspace_id, kind, message, created_on, created_at) VALUES ($1,'ai_budget','m', (`+at+`)::date,`+at+`)`, ws)
		exec(`INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence, state, created_at) VALUES ($1,$2,$3,'new_request','need','T',$4,$5,$6,0.9,'dismissed',`+at+`)`, ws, src, chunk, text[[]int{3, 10}[i]:[]int{9, 14}[i]], []int{3, 10}[i], []int{9, 14}[i])
	}
	// Something recent that is not dismissed must never be touched, whatever its age.
	exec(`INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence, state, created_at) VALUES ($1,$2,$3,'new_request','need','Old but waiting','We really need',0,14,0.9,'suggested', now() - interval '3 years')`, ws, src, chunk)

	p := &retention.Purger{Pool: db.Backend}
	got, err := p.Run(ctx)
	must(err)
	for kind, want := range map[string]int64{"questions and answers": 1, "ai call records": 1, "notices": 1, "dismissed suggestions": 1} {
		if got[kind] != want {
			t.Errorf("%s: removed %d, want %d (all: %v)", kind, got[kind], want, got)
		}
	}
	count := func(q string) (n int) {
		must(db.Super.QueryRow(ctx, q, ws).Scan(&n))
		return
	}
	for table, want := range map[string]int{"qa_answer": 1, "ai_event": 1, "notice": 1} {
		if n := count(`SELECT count(*) FROM ` + table + ` WHERE workspace_id=$1`); n != want {
			t.Errorf("%s: %d rows left, want %d", table, n, want)
		}
	}
	if n := count(`SELECT count(*) FROM proposal WHERE workspace_id=$1`); n != 2 {
		t.Errorf("proposals left: %d (a fresh dismissed one and an old waiting one)", n)
	}
	// The customer's own records, however old, stay.
	for table, want := range map[string]int{"source_item": 1, "chunk": 1, "request": 1, "person": 1, "evidence": 1, "suppression": 1} {
		if n := count(`SELECT count(*) FROM ` + table + ` WHERE workspace_id=$1`); n != want {
			t.Errorf("%s: %d rows, want %d: retention must not delete customer records", table, n, want)
		}
	}
	// A second run finds nothing more.
	again, _ := p.Run(ctx)
	for kind, n := range again {
		if n != 0 {
			t.Errorf("second run removed %d %s", n, kind)
		}
	}
	// Silly settings are refused by the database, not honoured.
	bad := &retention.Purger{Pool: db.Backend, Policy: retention.Policy{QuestionsDays: 0, AICallDays: 1, NoticeDays: 1, DismissedDays: 1}}
	if _, err := bad.Run(ctx); err == nil || !strings.Contains(err.Error(), "safe minimums") {
		t.Errorf("unsafe policy accepted: %v", err)
	}
	if n := count(`SELECT count(*) FROM qa_answer WHERE workspace_id=$1`); n != 1 {
		t.Error("an unsafe policy deleted data")
	}
}
