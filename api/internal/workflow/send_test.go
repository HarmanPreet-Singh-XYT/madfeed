package workflow_test

import (
	"encoding/base64"
	"errors"
	"math/rand"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/email"
	"product/api/internal/outreach"
)

// approvedBatch ships a request, drafts, approves everything, and returns the message ids.
func (e *env) approvedBatch(t *testing.T, title string) (batch uuid.UUID, req uuid.UUID, msgs map[string]uuid.UUID) {
	t.Helper()
	sc := e.seedRequest(t, title, standard, 0)
	ch := e.ship(t, sc.Request)
	e.runDrafts(t, sc.Request)
	if _, err := e.out.Approve(ctx, e.ten, ch.Outreach.BatchID); err != nil {
		t.Fatal(err)
	}
	return ch.Outreach.BatchID, sc.Request, e.messageIDs(t, sc.Request)
}

func TestNothingUnapprovedIsEverSent(t *testing.T) {
	e := setup(t)
	sc := e.seedRequest(t, "Single sign-on", standard, 0)
	ch := e.ship(t, sc.Request)
	msgs := e.messageIDs(t, sc.Request)
	dana, raj := msgs["Dana Lee"], msgs["Raj Patel"]

	// Still being written, then ready for review: a send job for either must do nothing.
	for _, stage := range []string{"drafting", "draft"} {
		if stage == "draft" {
			e.runDrafts(t, sc.Request)
		}
		for _, id := range []uuid.UUID{dana, raj} {
			if err := e.runSend(t, id, 1); err != nil {
				t.Fatalf("%s: %v", stage, err)
			}
			if got := e.state(t, id); got != stage {
				t.Fatalf("a send job changed a %s message into %s", stage, got)
			}
		}
	}
	// Excluded, suppressed, failed, already sent: all refused.
	set := func(id uuid.UUID, state string) {
		t.Helper()
		// Setting states directly needs the columns the database requires for them.
		q := `UPDATE outreach_message SET state=$2 WHERE id=$1`
		if state == "failed" || state == "sent" {
			q = `UPDATE outreach_message SET state=$2, approved_by=$3, approved_at=now(), sent_at=now() WHERE id=$1`
			if _, err := e.db.Super.Exec(ctx, q, id, state, e.ten.UserID); err != nil {
				t.Fatal(err)
			}
			return
		}
		if _, err := e.db.Super.Exec(ctx, q, id, state); err != nil {
			t.Fatal(err)
		}
	}
	for _, state := range []string{"excluded", "suppressed", "failed", "sent"} {
		set(dana, state)
		if err := e.runSend(t, dana, 1); err != nil {
			t.Fatalf("%s: %v", state, err)
		}
		if got := e.state(t, dana); got != state {
			t.Fatalf("a send job changed a %s message into %s", state, got)
		}
	}
	// A message another worker claimed moments ago is not touched either.
	set(raj, "draft")
	if _, err := e.db.Super.Exec(ctx, `UPDATE outreach_message SET state='sending', approved_by=$2, approved_at=now() WHERE id=$1`, raj, e.ten.UserID); err != nil {
		t.Fatal(err)
	}
	if err := e.runSend(t, raj, 1); err != nil || e.state(t, raj) != "sending" {
		t.Fatalf("fresh claim must be left alone: %v %s", err, e.state(t, raj))
	}
	if n := e.mail.attemptCount(); n != 0 {
		t.Fatalf("%d emails were attempted before anyone approved anything", n)
	}
	_ = ch

	// The database itself refuses an approved, sending or sent message without an approver.
	sc2 := e.seedRequest(t, "Dark mode", standard, 0)
	e.ship(t, sc2.Request)
	e.runDrafts(t, sc2.Request)
	fresh := e.messageIDs(t, sc2.Request)["Dana Lee"] // a draft nobody has approved
	for _, state := range []string{"approved", "sending", "sent"} {
		if _, err := e.db.Super.Exec(ctx, `UPDATE outreach_message SET state=$2 WHERE id=$1`, fresh, state); err == nil {
			t.Errorf("the database accepted state %q with no approver", state)
		}
	}
}

func TestApprovedMessagesAreSentOnceWithTheRightContent(t *testing.T) {
	e := setup(t)
	_, req, msgs := e.approvedBatch(t, "Single sign-on")
	dana := msgs["Dana Lee"]

	if err := e.runSend(t, dana, 1); err != nil {
		t.Fatal(err)
	}
	if e.state(t, dana) != "sent" || e.mail.deliveredTo("dana@acme.com") != 1 {
		t.Fatalf("state=%s delivered=%d", e.state(t, dana), e.mail.deliveredTo("dana@acme.com"))
	}
	var m email.Message
	for _, d := range e.mail.delivered {
		m = d
	}
	var subject, body string
	_ = e.db.Super.QueryRow(ctx, `SELECT subject, body FROM outreach_message WHERE id=$1`, dana).Scan(&subject, &body)
	if len(m.To) != 1 || m.To[0] != "dana@acme.com" || m.From != "Acme Software <updates@mail.example.com>" || m.Subject != subject {
		t.Fatalf("%+v", m)
	}
	if !strings.HasPrefix(m.Text, body) || m.IdempotencyKey != "outreach-"+dana.String() {
		t.Fatalf("body or key wrong: %q key=%s", m.Text, m.IdempotencyKey)
	}
	// Nobody else is on the message, and the unsubscribe link is for exactly this person here.
	if strings.Contains(m.Text, "raj@acme.com") || strings.Contains(m.Text, "Globex") {
		t.Fatalf("content mentions someone else: %q", m.Text)
	}
	i := strings.Index(m.Text, "unsubscribe: ")
	url := strings.TrimSpace(m.Text[i+len("unsubscribe: "):])
	token := strings.TrimPrefix(url, "https://app.example/unsubscribe/")
	ws, msgID, err := e.unsub.Verify(token)
	if err != nil || ws != e.ten.WorkspaceID || msgID != dana {
		t.Fatalf("unsubscribe link: %v %v %v", ws, msgID, err)
	}
	// The address is looked up on our side; the link itself does not contain it, or anything personal.
	if _, addr, err := e.out.AddressFor(ctx, e.unsub, token); err != nil || addr != "dana@acme.com" {
		t.Fatalf("lookup: %q %v", addr, err)
	}
	if strings.Contains(url, "dana") || strings.Contains(url, "acme") {
		t.Fatalf("the link carries personal data: %s", url)
	}
	raw, _ := base64.RawURLEncoding.DecodeString(token)
	if len(raw) != 48 || strings.Contains(string(raw), "dana") || strings.Contains(string(raw), "acme") {
		t.Fatalf("the token is not just two ids and a signature (%d bytes)", len(raw))
	}
	if m.Headers["List-Unsubscribe"] != "<"+url+">" || m.Headers["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Fatalf("headers %v", m.Headers)
	}
	for _, bad := range []string{"\r", "Bcc", "Cc:"} {
		if strings.Contains(m.Subject, bad) || strings.Contains(m.From, bad) {
			t.Fatalf("header injection via %q", bad)
		}
	}

	// Both approved messages sent: the batch is done and the people are marked as informed.
	if err := e.runSend(t, msgs["Raj Patel"], 1); err != nil {
		t.Fatal(err)
	}
	if _, st := e.batchOf(t, req); st != "done" {
		t.Fatalf("batch %s", st)
	}
	var informed int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outreach_message WHERE request_id=$1 AND state='sent' AND sent_at IS NOT NULL AND approved_by IS NOT NULL`, req).Scan(&informed)
	if informed != 2 {
		t.Fatalf("informed %d", informed)
	}
}

func TestNoMessageIsEverSentTwice(t *testing.T) {
	e := setup(t)
	_, _, msgs := e.approvedBatch(t, "Single sign-on")
	dana := msgs["Dana Lee"]

	// The same job run twice, and ten workers racing for it: one email.
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = e.runSend(t, dana, 1) }()
	}
	wg.Wait()
	_ = e.runSend(t, dana, 2)
	if e.mail.deliveredTo("dana@acme.com") != 1 || e.mail.attemptCount() != 1 {
		t.Fatalf("delivered=%d attempts=%d", e.mail.deliveredTo("dana@acme.com"), e.mail.attemptCount())
	}

	// A temporary failure: retried, and the retry carries the same key, so the provider cannot deliver twice.
	raj := msgs["Raj Patel"]
	e.mail.errs = []error{email.ErrTransient}
	if err := e.runSend(t, raj, 1); err == nil || e.state(t, raj) != "approved" {
		t.Fatalf("transient failure must release the message for retry: %v %s", err, e.state(t, raj))
	}
	if err := e.runSend(t, raj, 2); err != nil || e.state(t, raj) != "sent" {
		t.Fatalf("retry: %v %s", err, e.state(t, raj))
	}
	keys := map[string]int{}
	for _, a := range e.mail.attempts {
		keys[a.IdempotencyKey]++
	}
	if keys["outreach-"+raj.String()] != 2 || e.mail.deliveredTo("raj@acme.com") != 1 {
		t.Fatalf("keys=%v delivered=%d", keys, e.mail.deliveredTo("raj@acme.com"))
	}

	// A worker that died after sending left the message "sending": once stale it is claimed again with the same key.
	sc := e.seedRequest(t, "Dark mode", standard, 0)
	ch := e.ship(t, sc.Request)
	e.runDrafts(t, sc.Request)
	_, _ = e.out.Approve(ctx, e.ten, ch.Outreach.BatchID)
	d2 := e.messageIDs(t, sc.Request)["Dana Lee"]
	_ = e.runSend(t, d2, 1)
	if _, err := e.db.Super.Exec(ctx, `UPDATE outreach_message SET state='sending', sent_at=NULL, updated_at=now() - interval '10 minutes' WHERE id=$1`, d2); err != nil {
		t.Fatal(err)
	}
	if err := e.runSend(t, d2, 2); err != nil {
		t.Fatal(err)
	}
	if e.state(t, d2) != "sent" || e.mail.deliveredTo("dana@acme.com") != 2 { // one per request, never two for the same request
		t.Fatalf("%s %d", e.state(t, d2), e.mail.deliveredTo("dana@acme.com"))
	}
	n := 0
	for _, a := range e.mail.attempts {
		if a.IdempotencyKey == "outreach-"+d2.String() {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("a recovered send must reuse its key: %d attempts", n)
	}

	// Approving again, or shipping again, queues nothing new.
	if _, err := e.out.Approve(ctx, e.ten, ch.Outreach.BatchID); !errors.Is(err, outreach.ErrConflict) {
		t.Fatalf("second approve: %v", err)
	}
	if ch, _ := e.wf.SetRequestStatus(ctx, e.ten, sc.Request, e.shipped); ch.Shipped {
		t.Fatal("re-shipping must not start another batch")
	}
	var perPair int
	_ = e.db.Super.QueryRow(ctx, `SELECT coalesce(max(c),0) FROM (SELECT count(*) c FROM outreach_message GROUP BY request_id, person_id) x`).Scan(&perPair)
	if perPair != 1 {
		t.Fatalf("a person has %d messages for one request", perPair)
	}
}

func TestFailuresAreVisibleAndRetryable(t *testing.T) {
	e := setup(t)
	batch, req, msgs := e.approvedBatch(t, "Single sign-on")
	raj := msgs["Raj Patel"]
	e.mail.errs = []error{email.ErrPermanent}
	if err := e.runSend(t, raj, 1); err != nil {
		t.Fatalf("a rejected address is recorded, not retried forever: %v", err)
	}
	if e.state(t, raj) != "failed" {
		t.Fatalf("state %s", e.state(t, raj))
	}
	_ = e.runSend(t, msgs["Dana Lee"], 1)
	if _, st := e.batchOf(t, req); st != "done" {
		t.Fatalf("a failure must not hold the batch open forever: %s", st)
	}
	_ = batch
	view, _ := e.out.Get(ctx, e.ten, batch)
	for _, m := range view.Messages {
		if m.PersonName == "Raj Patel" && (m.State != "failed" || m.Error == "") {
			t.Fatalf("%+v", m)
		}
	}
	// A person can try again; it then goes out once.
	if err := e.out.RetryFailed(ctx, e.ten, raj); err != nil {
		t.Fatal(err)
	}
	if err := e.runSend(t, raj, 1); err != nil || e.state(t, raj) != "sent" || e.mail.deliveredTo("raj@acme.com") != 1 {
		t.Fatalf("%v %s", err, e.state(t, raj))
	}
	if err := e.out.RetryFailed(ctx, e.ten, raj); !errors.Is(err, outreach.ErrConflict) {
		t.Fatalf("retrying something that was sent: %v", err)
	}
}

func TestSuppressedPeopleAreNeverEmailed(t *testing.T) {
	e := setup(t)
	sc := e.seedRequest(t, "Single sign-on", standard, 0)
	ch := e.ship(t, sc.Request)
	e.runDrafts(t, sc.Request)
	msgs := e.messageIDs(t, sc.Request)

	// Unsubscribing while a draft waits for review withdraws it.
	tok := e.unsub.Token(e.ten.WorkspaceID, msgs["Raj Patel"])
	if err := e.out.Unsubscribe(ctx, e.unsub, tok); err != nil {
		t.Fatal(err)
	}
	if e.state(t, msgs["Raj Patel"]) != "suppressed" {
		t.Fatalf("raj is %s", e.state(t, msgs["Raj Patel"]))
	}
	if err := e.out.Unsubscribe(ctx, e.unsub, tok); err != nil {
		t.Fatalf("unsubscribing twice must be harmless: %v", err)
	}
	n, err := e.out.Approve(ctx, e.ten, ch.Outreach.BatchID)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}

	// Unsubscribing after approval but before sending: the send itself refuses.
	if err := e.out.RecordSuppression(ctx, e.ten.WorkspaceID, "DANA@acme.com", "complained"); err != nil {
		t.Fatal(err)
	}
	if err := e.runSend(t, msgs["Dana Lee"], 1); err != nil {
		t.Fatal(err)
	}
	if e.state(t, msgs["Dana Lee"]) != "suppressed" || e.mail.attemptCount() != 0 {
		t.Fatalf("state=%s attempts=%d", e.state(t, msgs["Dana Lee"]), e.mail.attemptCount())
	}
	if _, st := e.batchOf(t, sc.Request); st != "done" {
		t.Fatalf("batch %s", st)
	}

	// Later requests respect it from the start: no draft is even written.
	sc2 := e.seedRequest(t, "Dark mode", standard, 0)
	ch2 := e.ship(t, sc2.Request)
	if ch2.Outreach.Suppressed != 2 || ch2.Outreach.WillContact != 0 {
		t.Fatalf("%+v", ch2.Outreach)
	}
	if e.model.calls != 2 {
		t.Fatalf("the model was asked to write to people who opted out (%d calls)", e.model.calls)
	}

	// Tokens only work for the message they were made for: edited, forged and unknown ones do nothing.
	good := e.unsub.Token(e.ten.WorkspaceID, msgs["Dana Lee"])
	for name, bad := range map[string]string{
		"edited":          good[:len(good)-1] + flipped(good),
		"unknown message": e.unsub.Token(e.ten.WorkspaceID, uuid.New()),
		"other workspace": e.unsub.Token(uuid.New(), msgs["Dana Lee"]),
		"other secret":    outreach.Unsubscriber{Secret: []byte("another-secret-of-some-length!!")}.Token(e.ten.WorkspaceID, msgs["Dana Lee"]),
	} {
		if err := e.out.Unsubscribe(ctx, e.unsub, bad); !errors.Is(err, outreach.ErrBadToken) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	var sup int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM suppression WHERE workspace_id=$1 AND email IN ('dana@acme.com')`, e.ten.WorkspaceID).Scan(&sup)
	if sup != 1 { // Dana's own opt-out from the earlier complaint, not from a forged link
		t.Fatalf("suppression rows for dana: %d", sup)
	}
}

func TestEmailIsNotSentUnlessConfigured(t *testing.T) {
	e := setup(t)
	e.send.Sender = nil
	_, _, msgs := e.approvedBatch(t, "Single sign-on")
	if err := e.runSend(t, msgs["Dana Lee"], 1); err == nil {
		t.Fatal("an unconfigured sender must report an error so the job is retried later")
	}
	var attempts int
	_ = e.db.Super.QueryRow(ctx, `SELECT attempts FROM outreach_message WHERE id=$1`, msgs["Dana Lee"]).Scan(&attempts)
	if e.state(t, msgs["Dana Lee"]) != "approved" || attempts != 0 {
		t.Fatalf("an unconfigured send must leave the message untouched: %s attempts=%d", e.state(t, msgs["Dana Lee"]), attempts)
	}
	e.send.Sender, e.send.FromAddress = e.mail, ""
	if err := e.runSend(t, msgs["Dana Lee"], 1); err == nil {
		t.Fatal("no sender address must also refuse")
	}
	e.send.FromAddress, e.send.Unsub = "updates@mail.example.com", outreach.Unsubscriber{}
	if err := e.runSend(t, msgs["Dana Lee"], 1); err == nil {
		t.Fatal("no unsubscribe secret must also refuse: every email needs a working opt-out")
	}
	if e.mail.attemptCount() != 0 {
		t.Fatal("something was sent")
	}
}

// Whatever order things happen in, mail only leaves for approved messages, once, and never after an opt-out.
func TestRandomSequencesOfActionsNeverBreakTheSendRules(t *testing.T) {
	for seed := int64(1); seed <= 12; seed++ {
		seed := seed
		t.Run("", func(t *testing.T) {
			rng := rand.New(rand.NewSource(seed))
			e := setup(t)
			people := []who{
				{Name: "Ann One", Email: "ann@a.example", Account: "A Co"}, {Name: "Bob Two", Email: "bob@b.example", Account: "B Co"},
				{Name: "Cy Three", Email: "cy@c.example", Account: "C Co"}, {Name: "Di Four", Email: "di@d.example", Account: "D Co"},
			}
			sc := e.seedRequest(t, "Randomised", people, 0)
			ch := e.ship(t, sc.Request)
			batch := ch.Outreach.BatchID
			ids := e.messageIDs(t, sc.Request)
			var all []uuid.UUID
			for _, id := range ids {
				all = append(all, id)
			}
			addrs := []string{"ann@a.example", "bob@b.example", "cy@c.example", "di@d.example"}
			optedOutAt := map[string]int{} // address -> deliveries at the moment they opted out

			for step := 0; step < 40; step++ {
				id := all[rng.Intn(len(all))]
				switch rng.Intn(9) {
				case 0:
					e.runDrafts(t, sc.Request)
				case 1:
					_ = e.out.EditMessage(ctx, e.ten, id, "Edited subject", "Hi,\n\nEdited body.\n\nAcme")
				case 2:
					_ = e.out.Exclude(ctx, e.ten, id)
				case 3:
					_ = e.out.Include(ctx, e.ten, id)
				case 4:
					_, _ = e.out.Approve(ctx, e.ten, batch)
				case 5:
					_ = e.out.Cancel(ctx, e.ten, batch)
				case 6, 7:
					_ = e.runSend(t, id, 1) // including messages nobody approved
				case 8:
					a := addrs[rng.Intn(len(addrs))]
					if _, done := optedOutAt[a]; !done {
						optedOutAt[a] = e.mail.deliveredTo(a)
					}
					_ = e.out.RecordSuppression(ctx, e.ten.WorkspaceID, a, "unsubscribed")
				}
				// Invariants, checked after every step.
				for key, m := range e.mail.delivered {
					msgID := strings.TrimPrefix(key, "outreach-")
					var state string
					var approver *uuid.UUID
					var approvedAt any
					if err := e.db.Super.QueryRow(ctx, `SELECT state, approved_by, approved_at FROM outreach_message WHERE id=$1`, msgID).Scan(&state, &approver, &approvedAt); err != nil {
						t.Fatalf("seed %d step %d: a delivered email has no message row: %v", seed, step, err)
					}
					if approver == nil || approvedAt == nil {
						t.Fatalf("seed %d step %d: an email to %s left without an approver", seed, step, m.To[0])
					}
				}
				for _, a := range addrs {
					if n := e.mail.deliveredTo(a); n > 1 {
						t.Fatalf("seed %d step %d: %s was emailed %d times for one request", seed, step, a, n)
					}
					if at, opted := optedOutAt[a]; opted && e.mail.deliveredTo(a) > at {
						t.Fatalf("seed %d step %d: %s was emailed after opting out", seed, step, a)
					}
				}
				if e.mail.attemptCount() != e.mail.deliveredCount() {
					t.Fatalf("seed %d step %d: an attempt was made that did not deliver (no failures were injected)", seed, step)
				}
			}
		})
	}
}

// The send itself re-checks the opt-out list, so an address added by any other
// path (a bounce notification, a manual import) is still honoured.
func TestSendRechecksTheOptOutListEvenWhenNothingWithdrewTheMessage(t *testing.T) {
	e := setup(t)
	batch, req, msgs := e.approvedBatch(t, "Single sign-on")
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO suppression (workspace_id, email, reason) VALUES ($1,'dana@acme.com','bounced')`, e.ten.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	if e.state(t, msgs["Dana Lee"]) != "approved" {
		t.Fatal("test premise: the message is still approved")
	}
	if err := e.runSend(t, msgs["Dana Lee"], 1); err != nil {
		t.Fatal(err)
	}
	if e.state(t, msgs["Dana Lee"]) != "suppressed" || e.mail.deliveredTo("dana@acme.com") != 0 {
		t.Fatalf("state=%s delivered=%d", e.state(t, msgs["Dana Lee"]), e.mail.deliveredTo("dana@acme.com"))
	}
	// The other recipient is unaffected, and the batch still finishes.
	if err := e.runSend(t, msgs["Raj Patel"], 1); err != nil || e.mail.deliveredTo("raj@acme.com") != 1 {
		t.Fatalf("%v", err)
	}
	if _, st := e.batchOf(t, req); st != "done" {
		t.Fatalf("batch %s", st)
	}
	_ = batch
}

// flipped is a last character different from the one s ends with, so tampering always changes the value.
func flipped(s string) string {
	if strings.HasSuffix(s, "A") {
		return "B"
	}
	return "A"
}
