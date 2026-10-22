package workflow_test

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/outreach"
	"product/api/internal/store"
)

func TestShippingStartsOneBatchOfPersonalDrafts(t *testing.T) {
	e := setup(t)
	sc := e.seedRequest(t, "Single sign-on", standard, 1)

	ch := e.ship(t, sc.Request)
	s := ch.Outreach
	if !ch.Shipped || s.WillContact != 2 || s.NoEmail != 1 || s.AnonymousQuotes != 1 || s.Suppressed != 0 || s.BatchID == uuid.Nil {
		t.Fatalf("%+v", ch)
	}
	var queued int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job WHERE kind='draft_outreach_message' AND args->>'workspace_id'=$1`, e.ten.WorkspaceID.String()).Scan(&queued)
	if queued != 2 {
		t.Fatalf("draft jobs queued: %d", queued)
	}
	if _, st := e.batchOf(t, sc.Request); st != "drafting" {
		t.Fatalf("batch state %s", st)
	}

	e.runDrafts(t, sc.Request)
	_, st := e.batchOf(t, sc.Request)
	if st != "review" {
		t.Fatalf("after drafting the batch must wait for review, got %s", st)
	}
	view, err := e.out.Get(ctx, e.ten, s.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Messages) != 2 || view.NoEmail != 1 || view.Anonymous != 1 || view.ReadyToSend != 2 || view.RequestTitle != "Single sign-on" {
		t.Fatalf("%+v", view)
	}
	for _, m := range view.Messages {
		first := strings.Fields(m.PersonName)[0]
		if !strings.HasPrefix(m.Body, "Hi "+first+",") || !strings.HasSuffix(m.Body, "Acme Software") || m.State != "draft" || m.DraftedBy != "model" || m.Edited {
			t.Errorf("%s: %+v", m.PersonName, m)
		}
		// The draft is based on the recipient's own quotes, and only theirs.
		want := map[string]int{"Dana Lee": 2, "Raj Patel": 1}[m.PersonName]
		if len(m.Quotes) != want {
			t.Errorf("%s: %d quotes, want %d", m.PersonName, len(m.Quotes), want)
		}
	}
	// Dana's account is shown with her, so the reviewer sees the grouping.
	if view.Messages[0].AccountName != "Acme Inc" {
		t.Fatalf("%+v", view.Messages[0])
	}
	var events int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM ai_event WHERE workspace_id=$1 AND task='outreach_draft' AND outcome='ok'`, e.ten.WorkspaceID).Scan(&events)
	if events != 2 {
		t.Fatalf("ai events: %d", events)
	}
}

func TestReplayingShippedNeverDuplicatesAnything(t *testing.T) {
	e := setup(t)
	sc := e.seedRequest(t, "Dark mode", standard, 0)
	e.ship(t, sc.Request)
	if ch, err := e.wf.SetRequestStatus(ctx, e.ten, sc.Request, e.shipped); err != nil || ch.Shipped {
		t.Fatalf("the same status again must be a no-op: %+v %v", ch, err)
	}

	// Many callers at once on a fresh request: exactly one batch, one message per person, one job each.
	sc2 := e.seedRequest(t, "Export to CSV", standard, 0)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = e.wf.SetRequestStatus(ctx, e.ten, sc2.Request, e.shipped)
		}()
	}
	wg.Wait()
	var batches, msgs, jobs int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outreach_batch WHERE request_id=$1`, sc2.Request).Scan(&batches)
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outreach_message WHERE request_id=$1`, sc2.Request).Scan(&msgs)
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job j JOIN outreach_message m ON m.id = (j.args->>'message_id')::uuid WHERE j.kind='draft_outreach_message' AND m.request_id=$1`, sc2.Request).Scan(&jobs)
	if batches != 1 || msgs != 2 || jobs != 2 {
		t.Fatalf("batches=%d messages=%d jobs=%d", batches, msgs, jobs)
	}
}

func TestMovingBackOutOfShippedWithdrawsAnUnapprovedBatchAndShippingAgainRedrafts(t *testing.T) {
	e := setup(t)
	sc := e.seedRequest(t, "Webhooks", standard, 0)
	e.ship(t, sc.Request)
	e.runDrafts(t, sc.Request)
	first, _ := e.batchOf(t, sc.Request)

	if _, err := e.wf.SetRequestStatus(ctx, e.ten, sc.Request, e.planned); err != nil {
		t.Fatal(err)
	}
	if _, st := e.batchOf(t, sc.Request); st != "cancelled" {
		t.Fatalf("batch %s", st)
	}
	var left int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outreach_message WHERE request_id=$1`, sc.Request).Scan(&left)
	if left != 0 {
		t.Fatalf("%d unsent drafts survived", left)
	}

	ch := e.ship(t, sc.Request)
	if ch.Outreach.WillContact != 2 || ch.Outreach.BatchID == first {
		t.Fatalf("shipping again must create a fresh batch: %+v", ch)
	}

	// Once a batch is approved it cannot be recalled by changing the status.
	e.runDrafts(t, sc.Request)
	if _, err := e.out.Approve(ctx, e.ten, ch.Outreach.BatchID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.wf.SetRequestStatus(ctx, e.ten, sc.Request, e.planned); err != nil {
		t.Fatal(err)
	}
	if _, st := e.batchOf(t, sc.Request); st != "approved" {
		t.Fatalf("an approved batch must stay approved, got %s", st)
	}
}

func TestDraftsNeverMentionOtherCustomers(t *testing.T) {
	e := setup(t)
	// 25 people across 5 companies, all asking for the same thing, each with revenue.
	var people []who
	for a := 0; a < 5; a++ {
		for p := 0; p < 5; p++ {
			people = append(people, who{
				Name: fmt.Sprintf("Person%c Surname%c%d", 'A'+a, 'A'+a, p), Email: fmt.Sprintf("p%d.%d@company%d.example", a, p, a),
				Account: fmt.Sprintf("Company%c Holdings", 'A'+a), Revenue: fmt.Sprint(11111 * (a + 1)), Quotes: 1})
		}
	}
	sc := e.seedRequest(t, "Bulk edit", people, 3)
	ch := e.ship(t, sc.Request)
	if ch.Outreach.WillContact != 25 {
		t.Fatalf("%+v", ch)
	}
	e.runDrafts(t, sc.Request)
	view, _ := e.out.Get(ctx, e.ten, ch.Outreach.BatchID)
	if len(view.Messages) != 25 {
		t.Fatalf("%d messages", len(view.Messages))
	}
	for _, m := range view.Messages {
		text := m.Subject + "\n" + m.Body
		for _, other := range people {
			if other.Name == m.PersonName {
				continue
			}
			if contains(text, other.Name, other.Email) || (other.Account != "" && other.Account != accountOf(people, m.PersonName) && contains(text, other.Account)) {
				t.Fatalf("%s's draft mentions %s / %s:\n%s", m.PersonName, other.Name, other.Account, text)
			}
		}
		for _, rev := range []string{"11111", "22222", "33333", "44444", "55555", "revenue", "$"} {
			if contains(text, rev) {
				t.Fatalf("%s's draft contains %q:\n%s", m.PersonName, rev, text)
			}
		}
		if contains(text, "w0") { // another person's quote text
			for _, q := range m.Quotes {
				_ = q
			}
		}
	}
}

func accountOf(people []who, name string) string {
	for _, p := range people {
		if p.Name == name {
			return p.Account
		}
	}
	return ""
}

func TestAMisbehavingModelNeverGetsAnUnsafeDraftThrough(t *testing.T) {
	for name, tc := range map[string]struct{ mode, other string }{
		"names another customer": {"names-others", "Raj Patel"},
		"names another company":  {"names-others", "Globex Corp"},
		"inserts a link":         {"unsafe-link", ""},
	} {
		e := setup(t)
		e.model.mode, e.model.other = tc.mode, tc.other
		sc := e.seedRequest(t, "Single sign-on", standard, 0)
		ch := e.ship(t, sc.Request)
		e.runDrafts(t, sc.Request)
		view, _ := e.out.Get(ctx, e.ten, ch.Outreach.BatchID)
		for _, m := range view.Messages {
			if m.PersonName == tc.other {
				continue // naming yourself is fine; the rule is about everyone else
			}
			if m.DraftedBy != "fallback" || contains(m.Body, "Globex", "Raj Patel", "evil.example", "http") || !strings.Contains(m.Body, "shipped it") {
				t.Errorf("%s: %s got %+v", name, m.PersonName, m)
			}
		}
	}

	// Provider trouble is retried; on the last attempt a plain template is used instead of leaving nothing.
	e := setup(t)
	e.model.mode = "outage"
	sc := e.seedRequest(t, "Single sign-on", standard, 0)
	ch := e.ship(t, sc.Request)
	var id uuid.UUID
	for _, m := range e.messageIDs(t, sc.Request) {
		id = m
	}
	args := outreach.DraftArgs{WorkspaceID: e.ten.WorkspaceID, MessageID: id, UserID: e.ten.UserID}
	if err := workDraft(e, args, 1); err == nil {
		t.Fatal("an outage on an early attempt must retry")
	}
	if e.state(t, id) != "drafting" {
		t.Fatal("the message must still be waiting")
	}
	if err := workDraft(e, args, 3); err != nil {
		t.Fatal(err)
	}
	if e.state(t, id) != "draft" {
		t.Fatalf("last attempt must fall back to the plain template, got %s", e.state(t, id))
	}
	_ = ch

	// No AI configured at all: always the plain template.
	e2 := setup(t)
	e2.draft.Completer = nil
	sc2 := e2.seedRequest(t, "Dark mode", standard, 0)
	ch2 := e2.ship(t, sc2.Request)
	e2.runDrafts(t, sc2.Request)
	v2, _ := e2.out.Get(ctx, e2.ten, ch2.Outreach.BatchID)
	for _, m := range v2.Messages {
		if m.DraftedBy != "fallback" || m.State != "draft" {
			t.Errorf("%+v", m)
		}
	}
}

func TestReviewRulesRolesAndIsolation(t *testing.T) {
	e := setup(t)
	sc := e.seedRequest(t, "Single sign-on", standard, 0)
	ch := e.ship(t, sc.Request)
	batch := ch.Outreach.BatchID
	msgs := e.messageIDs(t, sc.Request)
	dana, raj := msgs["Dana Lee"], msgs["Raj Patel"]

	// Approval waits for drafts to exist.
	if _, err := e.out.Approve(ctx, e.ten, batch); !errors.Is(err, outreach.ErrStillDrafting) {
		t.Fatalf("approve while drafting: %v", err)
	}
	e.runDrafts(t, sc.Request)

	// Viewers read but never change; strangers see nothing.
	v := e.viewer()
	if _, err := e.out.Get(ctx, v, batch); err != nil {
		t.Fatalf("viewer read: %v", err)
	}
	for name, err := range map[string]error{
		"edit":    e.out.EditMessage(ctx, v, dana, "s", "b"),
		"exclude": e.out.Exclude(ctx, v, dana),
		"cancel":  e.out.Cancel(ctx, v, batch),
		"retry":   e.out.RetryFailed(ctx, v, dana),
	} {
		if !errors.Is(err, store.ErrForbidden) {
			t.Errorf("viewer %s: %v", name, err)
		}
	}
	if _, err := e.out.Approve(ctx, v, batch); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer approve: %v", err)
	}
	if _, err := e.wf.SetRequestStatus(ctx, v, sc.Request, e.planned); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer status: %v", err)
	}
	stranger := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if _, err := e.out.Get(ctx, stranger, batch); !errors.Is(err, outreach.ErrNotFound) {
		t.Errorf("stranger get: %v", err)
	}
	if _, err := e.out.Approve(ctx, stranger, batch); !errors.Is(err, outreach.ErrNotFound) {
		t.Errorf("stranger approve: %v", err)
	}
	if err := e.out.EditMessage(ctx, stranger, dana, "s", "b"); !errors.Is(err, outreach.ErrConflict) {
		t.Errorf("stranger edit: %v", err)
	}

	// Edits are validated, and only drafts can be edited.
	for name, c := range map[string][2]string{"empty subject": {"", "body"}, "multi-line subject": {"a\nBcc: x@y.z", "body"}, "empty body": {"s", "  "}, "huge body": {"s", strings.Repeat("x", 4001)}} {
		if err := e.out.EditMessage(ctx, e.ten, dana, c[0], c[1]); !errors.As(err, new(outreach.ErrInvalid)) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := e.out.EditMessage(ctx, e.ten, dana, "Our SSO is live", "Hi Dana,\n\nIt is live.\n\nAcme Software"); err != nil {
		t.Fatal(err)
	}
	view, _ := e.out.Get(ctx, e.ten, batch)
	for _, m := range view.Messages {
		if m.PersonName == "Dana Lee" && (!m.Edited || m.Subject != "Our SSO is live") {
			t.Fatalf("edit not recorded: %+v", m)
		}
	}

	// Excluding someone keeps them out; including brings them back.
	if err := e.out.Exclude(ctx, e.ten, raj); err != nil {
		t.Fatal(err)
	}
	if err := e.out.Exclude(ctx, e.ten, raj); !errors.Is(err, outreach.ErrConflict) {
		t.Fatalf("exclude twice: %v", err)
	}
	if err := e.out.EditMessage(ctx, e.ten, raj, "s", "b"); !errors.Is(err, outreach.ErrConflict) {
		t.Fatalf("edit an excluded message: %v", err)
	}
	if err := e.out.Include(ctx, e.ten, raj); err != nil {
		t.Fatal(err)
	}
	if err := e.out.Exclude(ctx, e.ten, raj); err != nil {
		t.Fatal(err)
	}

	n, err := e.out.Approve(ctx, e.ten, batch)
	if err != nil || n != 1 {
		t.Fatalf("only the included draft goes out: n=%d err=%v", n, err)
	}
	if e.state(t, dana) != "approved" || e.state(t, raj) != "excluded" {
		t.Fatalf("dana=%s raj=%s", e.state(t, dana), e.state(t, raj))
	}
	var by *uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `SELECT approved_by FROM outreach_message WHERE id=$1`, dana).Scan(&by)
	if by == nil || *by != e.ten.UserID {
		t.Fatalf("the approver must be recorded: %v", by)
	}
	if _, err := e.out.Approve(ctx, e.ten, batch); !errors.Is(err, outreach.ErrConflict) {
		t.Fatalf("approve twice: %v", err)
	}
	if err := e.out.Cancel(ctx, e.ten, batch); !errors.Is(err, outreach.ErrConflict) {
		t.Fatalf("cancel after approval: %v", err)
	}

	// Nothing to send is its own error.
	sc2 := e.seedRequest(t, "Webhooks", standard, 0)
	ch2 := e.ship(t, sc2.Request)
	e.runDrafts(t, sc2.Request)
	for _, id := range e.messageIDs(t, sc2.Request) {
		_ = e.out.Exclude(ctx, e.ten, id)
	}
	if _, err := e.out.Approve(ctx, e.ten, ch2.Outreach.BatchID); !errors.Is(err, outreach.ErrNothingToSend) {
		t.Fatalf("approve with everyone excluded: %v", err)
	}
}

func TestDraftsFinishingAtTheSameTimeStillMoveTheBatchToReview(t *testing.T) {
	e := setup(t)
	for round := 0; round < 8; round++ {
		sc := e.seedRequest(t, fmt.Sprintf("Request %d", round), standard, 0)
		e.ship(t, sc.Request)
		var wg sync.WaitGroup
		for _, id := range e.messageIDs(t, sc.Request) {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if err := workDraft(e, outreach.DraftArgs{WorkspaceID: e.ten.WorkspaceID, MessageID: id, UserID: e.ten.UserID}, 1); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if _, st := e.batchOf(t, sc.Request); st != "review" {
			t.Fatalf("round %d: batch is %s, want review", round, st)
		}
	}
}
