package audit_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/audit"
	"product/api/internal/brief"
	"product/api/internal/research"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type fixture struct {
	db     *testdb.DB
	svc    *audit.Service
	admin  store.Tenant
	member store.Tenant
	other  store.Tenant
}

func tenant(t *testing.T, db *testdb.DB, ws uuid.UUID, role store.Role) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: role}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if role == store.RoleAdmin {
			if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ws, Name: "W"}); err != nil {
				return err
			}
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: ten.UserID, Role: string(role)})
	}); err != nil {
		t.Fatal(err)
	}
	return ten
}

func setup(t *testing.T) *fixture {
	t.Helper()
	db := testdb.New(t)
	ws := uuid.New()
	f := &fixture{db: db}
	f.admin = tenant(t, db, ws, store.RoleAdmin)
	f.member = tenant(t, db, ws, store.RoleMember)
	f.other = tenant(t, db, uuid.New(), store.RoleAdmin)
	rs := &research.Service{Pool: db.Backend}
	f.svc = &audit.Service{Pool: db.Backend, QA: &research.QA{Pool: rs}, Brief: &brief.Service{Pool: db.Backend}}
	return f
}

// answered makes n answered questions with one cited quote each, in the workspace.
func (f *fixture) answered(t *testing.T, ten store.Tenant, n int) []uuid.UUID {
	t.Helper()
	var req uuid.UUID
	if err := f.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'R') RETURNING id`, ten.WorkspaceID).Scan(&req); err != nil {
		t.Fatal(err)
	}
	var ids []uuid.UUID
	for i := 0; i < n; i++ {
		text := "We really need single sign-on today."
		var src, chunk, ev, ans uuid.UUID
		must := func(err error) {
			t.Helper()
			if err != nil {
				t.Fatal(err)
			}
		}
		must(f.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ten.WorkspaceID, text, uuid.NewString(), ten.UserID).Scan(&src))
		must(f.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ten.WorkspaceID, src, len(text), text).Scan(&chunk))
		must(f.db.Super.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,'single sign-on',15,29,$5) RETURNING id`, ten.WorkspaceID, req, src, chunk, ten.UserID).Scan(&ev))
		must(f.db.Super.QueryRow(ctx, `INSERT INTO qa_answer (workspace_id, asked_by, question, outcome, answer) VALUES ($1,$2,'Why SSO?','answered','They need it [1].') RETURNING id`, ten.WorkspaceID, ten.UserID).Scan(&ans))
		_, err := f.db.Super.Exec(ctx, `INSERT INTO qa_citation (workspace_id, answer_id, ordinal, evidence_id) VALUES ($1,$2,1,$3)`, ten.WorkspaceID, ans, ev)
		must(err)
		ids = append(ids, ans)
	}
	return ids
}

func TestEachWorkspaceGetsAWeeklyHandfulOfItsOwnAnswers(t *testing.T) {
	f := setup(t)
	mine := f.answered(t, f.admin, 10)
	theirs := f.answered(t, f.other, 2)
	_, _ = mine, theirs
	// An unanswered question (a refusal) is never sampled: there is nothing to check.
	if _, err := f.db.Super.Exec(ctx, `INSERT INTO qa_answer (workspace_id, asked_by, question, outcome, reason) VALUES ($1,$2,'?','no_evidence','none')`, f.admin.WorkspaceID, f.admin.UserID); err != nil {
		t.Fatal(err)
	}
	n, err := f.svc.SampleAll(ctx)
	if err != nil || n < audit.PerWeek+2 {
		t.Fatalf("added %d (%v); expected %d for the big workspace and 2 for the small one at least", n, err, audit.PerWeek)
	}
	var mineN, theirN, refusals int
	_ = f.db.Super.QueryRow(ctx, `SELECT count(*) FROM audit_sample WHERE workspace_id=$1`, f.admin.WorkspaceID).Scan(&mineN)
	_ = f.db.Super.QueryRow(ctx, `SELECT count(*) FROM audit_sample WHERE workspace_id=$1`, f.other.WorkspaceID).Scan(&theirN)
	_ = f.db.Super.QueryRow(ctx, `SELECT count(*) FROM audit_sample s JOIN qa_answer a ON a.id=s.ref_id WHERE s.workspace_id=$1 AND a.outcome <> 'answered'`, f.admin.WorkspaceID).Scan(&refusals)
	if mineN != audit.PerWeek || theirN != 2 || refusals != 0 {
		t.Errorf("mine=%d theirs=%d refusals=%d", mineN, theirN, refusals)
	}
	// Running again the same week adds nothing; a sample from another workspace never shows up here.
	again, _ := f.svc.SampleAll(ctx)
	var after int
	_ = f.db.Super.QueryRow(ctx, `SELECT count(*) FROM audit_sample WHERE workspace_id=$1`, f.admin.WorkspaceID).Scan(&after)
	if after != audit.PerWeek {
		t.Errorf("a second run in the same week changed the count to %d (added %d)", after, again)
	}
	var crossed int
	_ = f.db.Super.QueryRow(ctx, `SELECT count(*) FROM audit_sample s WHERE NOT EXISTS (SELECT 1 FROM qa_answer a WHERE a.id=s.ref_id AND a.workspace_id=s.workspace_id)`).Scan(&crossed)
	if crossed != 0 {
		t.Errorf("%d samples point at another workspace's answers", crossed)
	}
	// Next week: old samples fall out of the window and it tops up again.
	if _, err := f.db.Super.Exec(ctx, `UPDATE audit_sample SET sampled_at = now() - interval '8 days' WHERE workspace_id=$1`, f.admin.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SampleAll(ctx); err != nil {
		t.Fatal(err)
	}
	_ = f.db.Super.QueryRow(ctx, `SELECT count(*) FROM audit_sample WHERE workspace_id=$1`, f.admin.WorkspaceID).Scan(&after)
	if after != 2*audit.PerWeek {
		t.Errorf("after a week the workspace should have %d samples in total, has %d", 2*audit.PerWeek, after)
	}
}

func TestAnAdminChecksAnAnswerAgainstItsQuotesOnce(t *testing.T) {
	f := setup(t)
	f.answered(t, f.admin, 1)
	if _, err := f.svc.SampleAll(ctx); err != nil {
		t.Fatal(err)
	}
	items, sum, err := f.svc.List(ctx, f.admin)
	if err != nil || len(items) != 1 || sum.Waiting != 1 || sum.Reviewed != 0 {
		t.Fatalf("%v %+v %+v", err, items, sum)
	}
	it := items[0]
	if it.Kind != "answer" || it.Heading != "Why SSO?" || it.Text != "They need it [1]." || len(it.Quotes) != 1 || it.Quotes[0].Text != "single sign-on" || it.Verdict != "" {
		t.Fatalf("%+v", it)
	}
	// Members and strangers cannot see or judge it.
	if _, _, err := f.svc.List(ctx, f.member); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("member listed: %v", err)
	}
	if err := f.svc.Review(ctx, f.member, it.ID, "supported", ""); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("member reviewed: %v", err)
	}
	if err := f.svc.Review(ctx, f.other, it.ID, "supported", ""); !errors.Is(err, audit.ErrNotFound) {
		t.Errorf("other workspace reviewed: %v", err)
	}
	if err := f.svc.Review(ctx, f.admin, it.ID, "maybe", ""); !errors.As(err, new(audit.ErrInvalid)) {
		t.Errorf("odd verdict: %v", err)
	}
	if err := f.svc.Review(ctx, f.admin, it.ID, "not_supported", "The quote says nothing about price. Key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Review(ctx, f.admin, it.ID, "supported", ""); !errors.As(err, new(audit.ErrConflict)) {
		t.Errorf("judged twice: %v", err)
	}
	items, sum, _ = f.svc.List(ctx, f.admin)
	if sum.Reviewed != 1 || sum.Supported != 0 || sum.Waiting != 0 || items[0].Verdict != "not_supported" || items[0].Reviewed == nil {
		t.Errorf("%+v %+v", sum, items)
	}
	if n := items[0].Note; len(n) == 0 || contains(n, "sk-proj") {
		t.Errorf("note kept a secret: %q", n)
	}
	// If what was sampled is deleted, the item says so instead of failing.
	if _, err := f.db.Super.Exec(ctx, `DELETE FROM qa_answer WHERE workspace_id=$1`, f.admin.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	items, _, err = f.svc.List(ctx, f.admin)
	if err != nil || !items[0].Gone {
		t.Errorf("%v %+v", err, items)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
