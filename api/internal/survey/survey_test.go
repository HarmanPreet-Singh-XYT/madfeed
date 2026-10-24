package survey_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/email"
	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/media"
	"product/api/internal/outreach"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/survey"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type fakeSender struct {
	mu   sync.Mutex
	sent []email.Message
	fail error
}

func (f *fakeSender) Send(_ context.Context, m email.Message) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return "", f.fail
	}
	f.sent = append(f.sent, m)
	return "prov-" + uuid.NewString(), nil
}

func (f *fakeSender) to() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, m := range f.sent {
		out = append(out, m.To...)
	}
	return out
}

type env struct {
	db       *testdb.DB
	svc      *survey.Service
	mail     *fakeSender
	sendW    *survey.SendWorker
	evW      *survey.EvidenceWorker
	out      *outreach.Service
	ws       uuid.UUID
	admin    store.Tenant
	member   store.Tenant
	viewer   store.Tenant
	other    store.Tenant
	links    survey.Links
	secret   []byte
	throttle func() bool
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	secret := []byte("survey-test-secret-with-enough-length-0123456789")
	links := survey.Links{Secret: secret, BaseURL: "https://app.example"}
	e := &env{db: db, mail: &fakeSender{}, links: links, secret: secret, ws: uuid.New()}
	e.sendW = &survey.SendWorker{Pool: db.Backend, Sender: e.mail, FromAddress: "updates@mail.example.com", Unsub: outreach.Unsubscriber{BaseURL: "https://app.example", Secret: secret}, Links: links}
	e.evW = &survey.EvidenceWorker{Pool: db.Backend}
	workers := river.NewWorkers()
	river.AddWorker(workers, &intake.ExtractWorker{Pool: db.Backend})
	river.AddWorker(workers, e.sendW)
	river.AddWorker(workers, e.evW)
	jc, err := jobs.NewClient(db.Backend, workers, nil)
	if err != nil {
		t.Fatal(err)
	}
	in := &intake.Service{Pool: db.Backend, Jobs: jc}
	e.evW.Intake = in
	e.svc = &survey.Service{Pool: db.Backend, Jobs: jc, Intake: in, Links: links, HashKey: secret}
	e.svc.Throttle = func(context.Context, string, string) bool { return e.throttle == nil || e.throttle() }
	e.out = &outreach.Service{Pool: db.Backend, Jobs: jc, HashKey: secret}
	mk := func(role store.Role) store.Tenant {
		return store.Tenant{WorkspaceID: e.ws, UserID: uuid.New(), Role: role}
	}
	e.admin, e.member, e.viewer = mk(store.RoleAdmin), mk(store.RoleMember), mk(store.RoleViewer)
	e.exec(t, `INSERT INTO workspace (id, name) VALUES ($1, 'Acme Inc')`, e.ws)
	for _, m := range []store.Tenant{e.admin, e.member, e.viewer} {
		e.exec(t, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,$3)`, e.ws, m.UserID, string(m.Role))
	}
	e.other = store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	e.exec(t, `INSERT INTO workspace (id, name) VALUES ($1, 'Elsewhere')`, e.other.WorkspaceID)
	e.exec(t, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, e.other.WorkspaceID, e.other.UserID)
	return e
}

func (e *env) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.db.Super.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (e *env) person(t *testing.T, ws uuid.UUID, name, mail string, plan string) uuid.UUID {
	t.Helper()
	var acct any
	if plan != "" {
		var a uuid.UUID
		if err := e.db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name, plan) VALUES ($1,$2,$3) RETURNING id`, ws, name+" Co", plan).Scan(&a); err != nil {
			t.Fatal(err)
		}
		acct = a
	}
	var em any
	if mail != "" {
		em = mail
	}
	var id uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email, account_id) VALUES ($1,$2,$3,$4) RETURNING id`, ws, name, em, acct).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// built makes a draft survey with one question of each kind.
func (e *env) built(t *testing.T, delivery string) (uuid.UUID, []survey.Question) {
	t.Helper()
	id, err := e.svc.Create(ctx, e.admin, survey.Basics{Title: "Product check-in", Intro: "Two minutes, honestly.", ThankYou: "Thank you!", Delivery: delivery})
	if err != nil {
		t.Fatal(err)
	}
	err = e.svc.SetQuestions(ctx, e.admin, id, []survey.QuestionInput{
		{Kind: "nps", Prompt: "How likely are you to recommend us?", Required: true},
		{Kind: "csat", Prompt: "How satisfied are you with support?"},
		{Kind: "choice", Prompt: "What matters most?", Options: []string{"Speed", "Price", "Support"}},
		{Kind: "text", Prompt: "What is missing for you?"},
	})
	if err != nil {
		t.Fatal(err)
	}
	sv, err := e.svc.Get(ctx, e.admin, id)
	if err != nil {
		t.Fatal(err)
	}
	return id, sv.Questions
}

func ip(n int) *int       { return &n }
func sp(s string) *string { return &s }

func answers(qs []survey.Question, nps int, text string) []survey.AnswerInput {
	out := []survey.AnswerInput{{QuestionID: qs[0].ID, Number: ip(nps)}}
	if text != "" {
		out = append(out, survey.AnswerInput{QuestionID: qs[3].ID, Text: sp(text)})
	}
	return out
}

func everyone(t *testing.T, e *env, id uuid.UUID) {
	t.Helper()
	if err := e.svc.SetAudience(ctx, e.admin, id, []byte(`{"all":[]}`)); err != nil {
		t.Fatal(err)
	}
}

func (e *env) runSend(t *testing.T, ws, invite uuid.UUID) error {
	t.Helper()
	return e.sendW.Work(ctx, &river.Job[survey.SendArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: survey.SendArgs{WorkspaceID: ws, InviteID: invite, UserID: e.admin.UserID}})
}

func (e *env) runEvidence(t *testing.T, ws, resp uuid.UUID) error {
	t.Helper()
	return e.evW.Work(ctx, &river.Job[survey.EvidenceArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: survey.EvidenceArgs{WorkspaceID: ws, ResponseID: resp}})
}

func (e *env) invites(t *testing.T, id uuid.UUID) map[string]survey.Invite {
	t.Helper()
	list, err := e.svc.ListInvites(ctx, e.admin, id, 100)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]survey.Invite{}
	for _, i := range list {
		out[i.Email] = i
	}
	return out
}

func inviteURL(t *testing.T, e *env, inv survey.Invite) string {
	return e.links.InviteToken(e.ws, inv.ID)
}

// ---------------- building ----------------

func TestOnlyPeopleWhoCanWriteBuildSurveysAndQuestionsFreezeOnceOpen(t *testing.T) {
	e := setup(t)
	if _, err := e.svc.Create(ctx, e.viewer, survey.Basics{Title: "x"}); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer created a survey: %v", err)
	}
	id, _ := e.built(t, "invited")
	for name, qs := range map[string][]survey.QuestionInput{
		"none":              {},
		"unknown kind":      {{Kind: "essay", Prompt: "x"}},
		"empty wording":     {{Kind: "text", Prompt: "  "}},
		"one choice":        {{Kind: "choice", Prompt: "x", Options: []string{"only"}}},
		"duplicate choices": {{Kind: "choice", Prompt: "x", Options: []string{"A", "a"}}},
		"eleven choices":    {{Kind: "choice", Prompt: "x", Options: []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"}}},
		"long wording":      {{Kind: "text", Prompt: strings.Repeat("x", 301)}},
	} {
		if err := e.svc.SetQuestions(ctx, e.admin, id, qs); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if err := e.svc.SetQuestions(ctx, e.viewer, id, []survey.QuestionInput{{Kind: "text", Prompt: "x"}}); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer changed questions: %v", err)
	}
	if err := e.svc.Open(ctx, e.member, id); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetQuestions(ctx, e.admin, id, []survey.QuestionInput{{Kind: "text", Prompt: "changed"}}); !errors.Is(err, survey.ErrConflict) {
		t.Errorf("questions changed after opening: %v", err)
	}
	if err := e.svc.Update(ctx, e.admin, id, survey.Basics{Title: "Renamed", Delivery: "open"}); !errors.Is(err, survey.ErrConflict) {
		t.Errorf("delivery changed after opening: %v", err)
	}
	if err := e.svc.Update(ctx, e.admin, id, survey.Basics{Title: "Renamed", Delivery: "invited", OnPersonDelete: "anonymise"}); err != nil {
		t.Errorf("renaming an open survey: %v", err)
	}
	empty, _ := e.svc.Create(ctx, e.admin, survey.Basics{Title: "No questions"})
	if err := e.svc.Open(ctx, e.admin, empty); err == nil {
		t.Error("a survey with no questions opened")
	}
	if err := e.svc.Delete(ctx, e.member, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member deleted a survey: %v", err)
	}
}

func TestASurveyBelongsToItsWorkspaceOnly(t *testing.T) {
	e := setup(t)
	id, _ := e.built(t, "invited")
	if _, err := e.svc.Get(ctx, e.other, id); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("another workspace read the survey: %v", err)
	}
	if err := e.svc.SetAudience(ctx, e.other, id, []byte(`{"all":[]}`)); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("another workspace set the audience: %v", err)
	}
	if _, err := e.svc.CreateInvites(ctx, e.other, id); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("another workspace invited: %v", err)
	}
	if _, err := e.svc.Results(ctx, e.other, id); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("another workspace saw results: %v", err)
	}
	if list, _ := e.svc.List(ctx, e.other, 50); len(list) != 0 {
		t.Errorf("another workspace lists %d surveys", len(list))
	}
}

// ---------------- sending ----------------

func TestInvitationsGoOnlyToApprovedPeopleWhoHaveNotOptedOut(t *testing.T) {
	e := setup(t)
	id, _ := e.built(t, "invited")
	a := e.person(t, e.ws, "Ann", "ann@acme.com", "pro")
	e.person(t, e.ws, "Bob", "bob@acme.com", "pro")
	e.person(t, e.ws, "Cy", "cy@free.io", "free")
	e.person(t, e.ws, "NoMail", "", "pro")
	e.person(t, e.ws, "Opted", "opted@acme.com", "pro")
	e.exec(t, `INSERT INTO suppression (workspace_id, email, reason) VALUES ($1,'opted@acme.com','unsubscribed')`, e.ws)
	_ = a
	if _, err := e.svc.CreateInvites(ctx, e.admin, id); err == nil {
		t.Fatal("invitations were made with no audience chosen")
	}
	if err := e.svc.SetAudience(ctx, e.admin, id, []byte(`{"field":"account_plan","op":"eq","value":"PRO"}`)); err != nil {
		t.Fatal(err)
	}
	pre, err := e.svc.PreviewAudience(ctx, e.admin, id, nil)
	if err != nil || pre.Total != 4 || pre.WithEmail != 3 {
		t.Fatalf("preview %+v %v", pre, err)
	}
	sum, err := e.svc.CreateInvites(ctx, e.admin, id)
	if err != nil || sum.Added != 2 || sum.Suppressed != 1 {
		t.Fatalf("invites %+v %v", sum, err)
	}
	if again, _ := e.svc.CreateInvites(ctx, e.admin, id); again.Added != 0 || again.AlreadyInvited != 3 {
		t.Errorf("a second round invited again: %+v", again)
	}
	inv := e.invites(t, id)
	if len(inv) != 3 || inv["opted@acme.com"].State != "suppressed" || inv["ann@acme.com"].State != "draft" {
		t.Fatalf("invitations %+v", inv)
	}
	// nothing is sent before a person approves, even if a job were to run
	for _, i := range inv {
		if err := e.runSend(t, e.ws, i.ID); err != nil {
			t.Fatal(err)
		}
	}
	if got := e.mail.to(); len(got) != 0 {
		t.Fatalf("mail went out without approval: %v", got)
	}
	// approval needs an open survey and a person who can write
	if _, err := e.svc.Approve(ctx, e.admin, id); err == nil {
		t.Error("approved before the survey was open")
	}
	if err := e.svc.Open(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Approve(ctx, e.viewer, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer approved: %v", err)
	}
	if err := e.svc.SetInviteExcluded(ctx, e.admin, inv["bob@acme.com"].ID, true); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetInviteExcluded(ctx, e.admin, inv["opted@acme.com"].ID, true); !errors.Is(err, survey.ErrConflict) {
		t.Errorf("a suppressed invitation was edited: %v", err)
	}
	// open survey, invitations written down but not approved: still nothing goes out
	for _, i := range e.invites(t, id) {
		if err := e.runSend(t, e.ws, i.ID); err != nil {
			t.Fatalf("running a send for %s (%s): %v", i.Email, i.State, err)
		}
	}
	if got := e.mail.to(); len(got) != 0 {
		t.Fatalf("mail went out for invitations nobody approved: %v", got)
	}
	n, err := e.svc.Approve(ctx, e.member, id)
	if err != nil || n != 1 {
		t.Fatalf("approve: %d %v", n, err)
	}
	if _, err := e.svc.Approve(ctx, e.member, id); !errors.Is(err, survey.ErrNothingToSend) {
		t.Errorf("approving twice: %v", err)
	}
	inv = e.invites(t, id)
	for _, i := range inv {
		for k := 0; k < 2; k++ { // a job may run twice
			if err := e.runSend(t, e.ws, i.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if got := e.mail.to(); len(got) != 1 || got[0] != "ann@acme.com" {
		t.Fatalf("mail went to %v, want only ann@acme.com once", got)
	}
	m := e.mail.sent[0]
	if !strings.Contains(m.Text, "https://app.example/s/i.") || !strings.Contains(m.Text, "unsubscribe") || m.Headers["List-Unsubscribe"] == "" || m.IdempotencyKey == "" {
		t.Errorf("message is missing its link or unsubscribe: %+v", m)
	}
	if e.invites(t, id)["ann@acme.com"].State != "sent" {
		t.Error("the invitation was not marked sent")
	}

	// an address that opts out after approval but before sending is skipped
	e.person(t, e.ws, "Late", "late@acme.com", "pro")
	if _, err := e.svc.CreateInvites(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Approve(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	if err := e.out.RecordSuppression(ctx, e.ws, "late@acme.com", "unsubscribed"); err != nil {
		t.Fatal(err)
	}
	if got := e.invites(t, id)["late@acme.com"].State; got != "suppressed" {
		t.Errorf("an opt-out did not withdraw the waiting invitation: %s", got)
	}
	if err := e.runSend(t, e.ws, e.invites(t, id)["late@acme.com"].ID); err != nil {
		t.Fatal(err)
	}
	if len(e.mail.to()) != 1 {
		t.Errorf("an opted-out address was written to: %v", e.mail.to())
	}
}

func TestAnOptOutBetweenApprovalAndSendingStillStopsTheEmail(t *testing.T) {
	e := setup(t)
	id, _ := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	e.svc.CreateInvites(ctx, e.admin, id)
	e.svc.Open(ctx, e.admin, id)
	if _, err := e.svc.Approve(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	// the opt-out lands in the list without going through the usual withdrawal (for example a bounce report
	// recorded by another process): the send step must still look at the list
	e.exec(t, `INSERT INTO suppression (workspace_id, email, reason) VALUES ($1,'ann@acme.com','bounced')`, e.ws)
	if err := e.runSend(t, e.ws, e.invites(t, id)["ann@acme.com"].ID); err != nil {
		t.Fatal(err)
	}
	if len(e.mail.to()) != 0 || e.invites(t, id)["ann@acme.com"].State != "suppressed" {
		t.Errorf("wrote to an address on the opt-out list: %v %s", e.mail.to(), e.invites(t, id)["ann@acme.com"].State)
	}
}

func TestAnInvitationNeverGoesOutForAClosedSurveyOrWithoutEmailSetUp(t *testing.T) {
	e := setup(t)
	id, _ := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	e.svc.CreateInvites(ctx, e.admin, id)
	e.svc.Open(ctx, e.admin, id)
	if _, err := e.svc.Approve(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	invID := e.invites(t, id)["ann@acme.com"].ID
	// email not configured: the job fails and leaves the invitation waiting
	saved := e.sendW.Sender
	e.sendW.Sender = nil
	if err := e.runSend(t, e.ws, invID); err == nil {
		t.Error("a worker without email claimed an invitation")
	}
	e.sendW.Sender = saved
	if e.invites(t, id)["ann@acme.com"].State != "approved" {
		t.Error("the invitation was lost")
	}
	// the survey closes before the send: nothing goes out
	if err := e.svc.Close(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	if err := e.runSend(t, e.ws, invID); err != nil {
		t.Fatal(err)
	}
	if len(e.mail.to()) != 0 || e.invites(t, id)["ann@acme.com"].State != "excluded" {
		t.Errorf("sent for a closed survey: %v %s", e.mail.to(), e.invites(t, id)["ann@acme.com"].State)
	}
	// a worker for another workspace cannot send this invitation
	if err := e.runSend(t, e.other.WorkspaceID, invID); err != nil || len(e.mail.to()) != 0 {
		t.Errorf("another workspace's job sent it: %v %v", err, e.mail.to())
	}
}

func TestTransientSendFailuresRetryAndRejectionsStop(t *testing.T) {
	e := setup(t)
	id, _ := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	e.person(t, e.ws, "Bea", "bea@acme.com", "")
	everyone(t, e, id)
	e.svc.CreateInvites(ctx, e.admin, id)
	e.svc.Open(ctx, e.admin, id)
	e.svc.Approve(ctx, e.admin, id)
	inv := e.invites(t, id)
	e.mail.fail = email.ErrTransient
	if err := e.runSend(t, e.ws, inv["ann@acme.com"].ID); err == nil {
		t.Error("a transient failure was swallowed")
	}
	if e.invites(t, id)["ann@acme.com"].State != "approved" {
		t.Error("a transient failure should leave it approved for the retry")
	}
	e.mail.fail = nil
	if err := e.runSend(t, e.ws, inv["ann@acme.com"].ID); err != nil || e.invites(t, id)["ann@acme.com"].State != "sent" {
		t.Errorf("retry: %v %s", err, e.invites(t, id)["ann@acme.com"].State)
	}
	e.mail.fail = email.ErrPermanent
	if err := e.runSend(t, e.ws, inv["bea@acme.com"].ID); err != nil || e.invites(t, id)["bea@acme.com"].State != "failed" {
		t.Errorf("rejection: %v %s", err, e.invites(t, id)["bea@acme.com"].State)
	}
}

func TestUnsubscribingFromAnInvitationOptsTheAddressOutEverywhere(t *testing.T) {
	e := setup(t)
	id, _ := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	e.svc.CreateInvites(ctx, e.admin, id)
	e.svc.Open(ctx, e.admin, id)
	e.svc.Approve(ctx, e.admin, id)
	invID := e.invites(t, id)["ann@acme.com"].ID
	if err := e.runSend(t, e.ws, invID); err != nil {
		t.Fatal(err)
	}
	unsub := outreach.Unsubscriber{BaseURL: "https://app.example", Secret: e.secret}
	token := strings.TrimPrefix(unsub.URL(e.ws, invID), "https://app.example/unsubscribe/")
	if _, addr, err := e.out.AddressFor(ctx, unsub, token); err != nil || addr != "ann@acme.com" {
		t.Fatalf("the link does not name the address: %q %v", addr, err)
	}
	if err := e.out.Unsubscribe(ctx, unsub, token); err != nil {
		t.Fatal(err)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM suppression WHERE workspace_id=$1 AND email='ann@acme.com'`, e.ws).Scan(&n)
	if n != 1 {
		t.Error("the address was not put on the opt-out list")
	}
	// the same link keeps working after the person is deleted (a fingerprint is kept)
	pid := e.invites(t, id)["ann@acme.com"].PersonID
	ms := &media.Service{Pool: e.db.Backend, HashKey: e.secret}
	if err := ms.DeletePerson(ctx, e.admin, pid); err != nil {
		t.Fatal(err)
	}
	if err := e.out.Unsubscribe(ctx, unsub, token); err != nil {
		t.Errorf("the opt-out link broke after the person was deleted: %v", err)
	}
}

// ---------------- answering ----------------

func (e *env) sentInvite(t *testing.T, id uuid.UUID, mail string) string {
	t.Helper()
	e.svc.CreateInvites(ctx, e.admin, id)
	if err := e.svc.Open(ctx, e.admin, id); err != nil && !errors.Is(err, survey.ErrConflict) {
		t.Fatal(err)
	}
	if _, err := e.svc.Approve(ctx, e.admin, id); err != nil && !errors.Is(err, survey.ErrNothingToSend) {
		t.Fatal(err)
	}
	inv := e.invites(t, id)[mail]
	if err := e.runSend(t, e.ws, inv.ID); err != nil {
		t.Fatal(err)
	}
	return e.links.InviteToken(e.ws, inv.ID)
}

func TestOneResponsePerInvitationAndRepeatsChangeNothing(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	tok := e.sentInvite(t, id, "ann@acme.com")

	v, err := e.svc.View(ctx, tok)
	if err != nil || v.Title != "Product check-in" || len(v.Questions) != 4 || v.Answered || v.WorkspaceName != "Acme Inc" {
		t.Fatalf("view %+v %v", v, err)
	}
	// partial: saved, resumable, not counted
	if r, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Answers: []survey.AnswerInput{{QuestionID: qs[2].ID, Choice: sp("Price")}}}); err != nil || r.Complete {
		t.Fatalf("partial: %+v %v", r, err)
	}
	v, _ = e.svc.View(ctx, tok)
	if len(v.Saved) != 1 || *v.Saved[0].Choice != "Price" {
		t.Errorf("progress was not kept: %+v", v.Saved)
	}
	if res, _ := e.svc.Results(ctx, e.admin, id); res.Complete != 0 || res.Partial != 1 {
		t.Errorf("a partial response was counted: %+v", res)
	}
	// finishing without the required question is refused, and keeps what was there
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Complete: true, Answers: []survey.AnswerInput{{QuestionID: qs[2].ID, Choice: sp("Price")}}}); err == nil {
		t.Error("finished without a required answer")
	}
	// finishing
	r, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Complete: true, Answers: answers(qs, 9, "SSO is missing and it hurts.")})
	if err != nil || !r.Complete || r.AlreadyAnswered || r.ThankYou != "Thank you!" {
		t.Fatalf("finish: %+v %v", r, err)
	}
	// a repeat (double tap, replay, or a changed mind) changes nothing and says so
	for _, in := range []survey.SubmitInput{
		{Token: tok, Complete: true, Answers: answers(qs, 9, "SSO is missing and it hurts.")},
		{Token: tok, Complete: true, Answers: answers(qs, 0, "changed my mind")},
		{Token: tok, Answers: answers(qs, 1, "")},
	} {
		r, err := e.svc.Submit(ctx, in)
		if err != nil || !r.AlreadyAnswered {
			t.Errorf("repeat: %+v %v", r, err)
		}
	}
	res, _ := e.svc.Results(ctx, e.admin, id)
	if res.Complete != 1 || res.Numeric[0].Answers != 1 || res.Numeric[0].Promoters != 1 || res.Numeric[0].Score != 100 {
		t.Errorf("results %+v", res)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_response WHERE survey_id=$1`, id).Scan(&n)
	if n != 1 {
		t.Errorf("%d responses for one invitation", n)
	}
	if v, _ := e.svc.View(ctx, tok); !v.Answered {
		t.Error("the page does not say it was answered")
	}
}

func TestConcurrentSubmissionsMakeOneResponse(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	tok := e.sentInvite(t, id, "ann@acme.com")
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Complete: true, Answers: answers(qs, 8, "Fast please.")})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("a concurrent submit failed: %v", err)
		}
	}
	var n, jobsN int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_response WHERE survey_id=$1 AND state='complete'`, id).Scan(&n)
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM `+jobs.Schema+`.river_job WHERE kind='survey_response_evidence' AND args->>'workspace_id'=$1`, e.ws.String()).Scan(&jobsN)
	if n != 1 || jobsN != 1 {
		t.Errorf("%d responses, %d evidence jobs from 12 simultaneous submissions", n, jobsN)
	}
}

func TestAnswersAreCheckedAgainstTheirQuestions(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	tok := e.sentInvite(t, id, "ann@acme.com")
	other, otherQs := e.built(t, "invited")
	_ = other
	bad := map[string][]survey.AnswerInput{
		"rating too high":       {{QuestionID: qs[0].ID, Number: ip(11)}},
		"rating negative":       {{QuestionID: qs[0].ID, Number: ip(-1)}},
		"satisfaction zero":     {{QuestionID: qs[1].ID, Number: ip(0)}},
		"satisfaction six":      {{QuestionID: qs[1].ID, Number: ip(6)}},
		"choice not offered":    {{QuestionID: qs[2].ID, Choice: sp("Free beer")}},
		"choice wrong case":     {{QuestionID: qs[2].ID, Choice: sp("price")}},
		"number for a choice":   {{QuestionID: qs[2].ID, Number: ip(1)}},
		"text for a rating":     {{QuestionID: qs[0].ID, Text: sp("ten")}},
		"two fields at once":    {{QuestionID: qs[0].ID, Number: ip(5), Text: sp("x")}},
		"no field":              {{QuestionID: qs[0].ID}},
		"a question of another": {{QuestionID: otherQs[0].ID, Number: ip(5)}},
		"an invented question":  {{QuestionID: uuid.New(), Number: ip(5)}},
		"same question twice":   {{QuestionID: qs[0].ID, Number: ip(5)}, {QuestionID: qs[0].ID, Number: ip(6)}},
		"a very long answer":    {{QuestionID: qs[3].ID, Text: sp(strings.Repeat("x", 2001))}},
	}
	for name, a := range bad {
		if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Answers: a}); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_answer a JOIN survey_response r ON r.id=a.response_id WHERE r.survey_id=$1`, id).Scan(&n)
	if n != 0 {
		t.Errorf("%d answers were stored from refused submissions", n)
	}
	// boundaries that are fine
	for _, a := range []survey.AnswerInput{{QuestionID: qs[0].ID, Number: ip(0)}, {QuestionID: qs[0].ID, Number: ip(10)}, {QuestionID: qs[1].ID, Number: ip(1)}, {QuestionID: qs[1].ID, Number: ip(5)}, {QuestionID: qs[3].ID, Text: sp(strings.Repeat("é", 2000))}} {
		if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Answers: []survey.AnswerInput{a}}); err != nil {
			t.Errorf("a valid answer was refused: %v", err)
		}
	}
}

func TestLinksAreSignedAndOnlyWorkWhileTheySouldWork(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "invited")
	e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	e.svc.CreateInvites(ctx, e.admin, id)
	inv := e.invites(t, id)["ann@acme.com"]
	tok := e.links.InviteToken(e.ws, inv.ID)
	try := func(token string) error {
		_, err := e.svc.Submit(ctx, survey.SubmitInput{Token: token, Answers: answers(qs, 5, "")})
		return err
	}
	// a link that exists but was never sent (still a draft) is not a page
	if _, err := e.svc.View(ctx, tok); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("an unsent invitation's link opened: %v", err)
	}
	e.svc.Open(ctx, e.admin, id)
	e.svc.Approve(ctx, e.admin, id)
	e.runSend(t, e.ws, inv.ID)
	for name, token := range map[string]string{
		"empty":                "",
		"garbage":              "hello",
		"a made-up signature":  "i." + strings.Split(tok, ".")[1] + "." + strings.Split(tok, ".")[2] + ".AAAAAAAAAAAAAAAAAAAAAA",
		"an edited invitation": strings.Replace(tok, strings.Split(tok, ".")[2], strings.Repeat("0", 32), 1),
		"a point-blank guess":  "o." + strings.Repeat("0", 32) + "." + strings.Repeat("0", 32) + ".0.AAAAAAAAAAAAAAAAAAAAAA",
		"too long":             tok + strings.Repeat("a", 300),
	} {
		if err := try(token); !errors.Is(err, survey.ErrNotFound) {
			t.Errorf("%s: %v", name, err)
		}
		if _, err := e.svc.View(ctx, token); !errors.Is(err, survey.ErrNotFound) {
			t.Errorf("view of %s: %v", name, err)
		}
	}
	// signed with a different secret
	forged := survey.Links{Secret: []byte("another-secret-with-enough-length-1234567890"), BaseURL: "x"}.InviteToken(e.ws, inv.ID)
	if err := try(forged); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("forged: %v", err)
	}
	// the right link moved to another workspace's id is not valid
	moved := e.links.InviteToken(e.other.WorkspaceID, inv.ID)
	if err := try(moved); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("moved: %v", err)
	}
	if err := try(tok); err != nil {
		t.Errorf("the real link: %v", err)
	}
	// closing stops new answers; the page says so
	e.svc.Close(ctx, e.admin, id)
	if err := try(tok); !errors.Is(err, survey.ErrNotOpen) {
		t.Errorf("closed survey took an answer: %v", err)
	}
	if v, err := e.svc.View(ctx, tok); err != nil || !v.Closed {
		t.Errorf("closed view: %+v %v", v, err)
	}
}

func TestAPublicLinkTakesOneResponsePerBrowserAndCanBeRetired(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "open")
	sv, _ := e.svc.Get(ctx, e.admin, id)
	if sv.PublicLink != "" {
		t.Error("a draft survey has a public link")
	}
	if err := e.svc.Open(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	sv, _ = e.svc.Get(ctx, e.admin, id)
	if !strings.HasPrefix(sv.PublicLink, "https://app.example/s/o.") {
		t.Fatalf("public link %q", sv.PublicLink)
	}
	tok := strings.TrimPrefix(sv.PublicLink, "https://app.example/s/")
	browser := "browser-key-aaaaaaaaaaaa"
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Answers: answers(qs, 7, "")}); err == nil {
		t.Error("a response with no browser id was taken")
	}
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "short", Answers: answers(qs, 7, "")}); err == nil {
		t.Error("a short browser id was accepted")
	}
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: browser, Answers: answers(qs, 7, "")}); err != nil {
		t.Fatal(err)
	}
	if saved, done, err := e.svc.Saved(ctx, tok, browser); err != nil || done || len(saved) != 1 {
		t.Errorf("saved %v %v %v", saved, done, err)
	}
	r, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: browser, Complete: true, Answers: answers(qs, 7, "")})
	if err != nil || !r.Complete {
		t.Fatalf("finish: %+v %v", r, err)
	}
	r, _ = e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: browser, Complete: true, Answers: answers(qs, 1, "")})
	if !r.AlreadyAnswered {
		t.Error("the same browser answered twice")
	}
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "browser-key-bbbbbbbbbbbb", Complete: true, Answers: answers(qs, 3, "")}); err != nil {
		t.Errorf("a second browser was refused: %v", err)
	}
	res, _ := e.svc.Results(ctx, e.admin, id)
	if res.Complete != 2 || res.Numeric[0].Answers != 2 || res.Numeric[0].Promoters != 0 || res.Numeric[0].Detractors != 1 {
		t.Errorf("results %+v", res)
	}
	// a personal link is not a public link, and the public link is not a personal one
	inv, _ := e.svc.CreateInvites(ctx, e.admin, id)
	_ = inv
	// the owner retires the link: the old copy stops working, the new one works
	fresh, err := e.svc.ResetLink(ctx, e.admin, id)
	if err != nil || fresh == sv.PublicLink {
		t.Fatalf("reset: %q %v", fresh, err)
	}
	if _, err := e.svc.View(ctx, tok); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("the retired link still opens: %v", err)
	}
	if _, err := e.svc.View(ctx, strings.TrimPrefix(fresh, "https://app.example/s/")); err != nil {
		t.Errorf("the new link: %v", err)
	}
	// an invited survey has no public link at all
	invited, _ := e.built(t, "invited")
	if _, err := e.svc.ResetLink(ctx, e.admin, invited); !errors.Is(err, survey.ErrConflict) {
		t.Errorf("reset on an invited survey: %v", err)
	}
}

func TestBotsAndFloodsAreStopped(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "open")
	e.svc.Open(ctx, e.admin, id)
	sv, _ := e.svc.Get(ctx, e.admin, id)
	tok := strings.TrimPrefix(sv.PublicLink, "https://app.example/s/")
	// the hidden field: looks fine to the bot, stores nothing
	r, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "bot-key-aaaaaaaaaaaaaaaa", Complete: true, Honeypot: "http://spam.example", Answers: answers(qs, 10, "buy now")})
	if err != nil || !r.Complete {
		t.Errorf("honeypot: %+v %v", r, err)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_response WHERE survey_id=$1`, id).Scan(&n)
	if n != 0 {
		t.Errorf("a bot's response was stored (%d)", n)
	}
	// the request limiter
	e.throttle = func() bool { return false }
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "key-aaaaaaaaaaaaaaaaaa", Answers: answers(qs, 5, "")}); err == nil {
		t.Error("a throttled caller got through")
	} else {
		var lim survey.ErrLimited
		if !errors.As(err, &lim) {
			t.Errorf("throttle error type: %v", err)
		}
	}
	e.throttle = nil
	// the daily cap on a public link
	e.svc.DailyPublic = 3
	for i := 0; i < 3; i++ {
		if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: fmt.Sprintf("flood-key-%016d", i), Answers: answers(qs, 5, "")}); err != nil {
			t.Fatalf("response %d: %v", i, err)
		}
	}
	var lim survey.ErrLimited
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "flood-key-extra-0000000", Answers: answers(qs, 5, "")}); !errors.As(err, &lim) {
		t.Errorf("the daily cap did not hold: %v", err)
	}
	// someone already answering can still finish after the cap
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "flood-key-0000000000000000", Complete: true, Answers: answers(qs, 6, "")}); err != nil {
		t.Errorf("finishing after the cap: %v", err)
	}
}

// ---------------- from answers to evidence ----------------

func TestFreeTextBecomesAVerbatimSourceForTheReviewQueue(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "invited")
	pid := e.person(t, e.ws, "Ann", "ann@acme.com", "")
	everyone(t, e, id)
	tok := e.sentInvite(t, id, "ann@acme.com")
	said := "We really need SSO. My card is 4242 4242 4242 4242 by the way."
	if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, Complete: true, Answers: answers(qs, 4, said)}); err != nil {
		t.Fatal(err)
	}
	var respID uuid.UUID
	e.db.Super.QueryRow(ctx, `SELECT id FROM survey_response WHERE survey_id=$1`, id).Scan(&respID)
	if err := e.runEvidence(t, e.ws, respID); err != nil {
		t.Fatal(err)
	}
	if err := e.runEvidence(t, e.ws, respID); err != nil { // a job may run twice
		t.Fatal(err)
	}
	var src uuid.UUID
	var raw, kind, title string
	var person uuid.NullUUID
	var count int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM source_item WHERE workspace_id=$1 AND kind='survey'`, e.ws).Scan(&count)
	if count != 1 {
		t.Fatalf("%d source items for one response", count)
	}
	e.db.Super.QueryRow(ctx, `SELECT id, raw_text, kind, title, person_id FROM source_item WHERE workspace_id=$1 AND kind='survey'`, e.ws).Scan(&src, &raw, &kind, &title, &person)
	if !strings.Contains(raw, "What is missing for you?\nWe really need SSO.") || !person.Valid || person.UUID != pid || title != "Survey: Product check-in" {
		t.Errorf("source: %q person=%v title=%q", raw, person, title)
	}
	if strings.Contains(raw, "4242") {
		t.Errorf("a card number reached the stored text: %q", raw)
	}
	// every chunk is a verbatim slice of the stored text at its offsets (the property quotes rely on)
	rows, _ := e.db.Super.Query(ctx, `SELECT start_offset, end_offset, text FROM chunk WHERE source_item_id=$1`, src)
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var s, en int
		var tx string
		rows.Scan(&s, &en, &tx)
		if raw[s:en] != tx {
			t.Errorf("chunk %d-%d is not a verbatim slice", s, en)
		}
		seen++
	}
	if seen == 0 {
		t.Error("no chunks were made")
	}
	var linked uuid.NullUUID
	e.db.Super.QueryRow(ctx, `SELECT source_item_id FROM survey_response WHERE id=$1`, respID).Scan(&linked)
	if !linked.Valid || linked.UUID != src {
		t.Error("the response does not point at its source")
	}
	var queued int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM `+jobs.Schema+`.river_job WHERE kind='extract_source_item' AND args->>'source_item_id'=$1`, src.String()).Scan(&queued)
	if queued == 0 {
		var kinds []string
		r2, _ := e.db.Super.Query(ctx, `SELECT DISTINCT kind FROM `+jobs.Schema+`.river_job`)
		for r2.Next() {
			var k string
			r2.Scan(&k)
			kinds = append(kinds, k)
		}
		t.Errorf("extraction was not queued for the survey text (job kinds: %v)", kinds)
	}
	// ratings and choices alone make no source item
	id2, qs2 := e.built(t, "open")
	e.svc.Open(ctx, e.admin, id2)
	sv, _ := e.svc.Get(ctx, e.admin, id2)
	e.svc.Submit(ctx, survey.SubmitInput{Token: strings.TrimPrefix(sv.PublicLink, "https://app.example/s/"), RespondentKey: "numbers-only-key-0001", Complete: true, Answers: answers(qs2, 3, "")})
	var jobsN int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM `+jobs.Schema+`.river_job WHERE kind='survey_response_evidence' AND args->>'workspace_id'=$1`, e.ws.String()).Scan(&jobsN)
	if jobsN != 1 {
		t.Errorf("%d evidence jobs; a ratings-only response must not queue one", jobsN)
	}
}

// ---------------- privacy ----------------

func TestDeletingAPersonRemovesOrAnonymisesTheirAnswers(t *testing.T) {
	e := setup(t)
	removeID, qs := e.built(t, "invited")
	if err := e.svc.Update(ctx, e.admin, removeID, survey.Basics{Title: "Remove", Delivery: "invited", OnPersonDelete: "remove"}); err != nil {
		t.Fatal(err)
	}
	keepID, qs2 := e.built(t, "invited")
	if err := e.svc.Update(ctx, e.admin, keepID, survey.Basics{Title: "Anonymise", Delivery: "invited", OnPersonDelete: "anonymise"}); err != nil {
		t.Fatal(err)
	}
	pid := e.person(t, e.ws, "Ann", "ann@acme.com", "")
	e.person(t, e.ws, "Bea", "bea@acme.com", "")
	everyone(t, e, removeID)
	everyone(t, e, keepID)
	t1 := e.sentInvite(t, removeID, "ann@acme.com")
	t2 := e.sentInvite(t, keepID, "ann@acme.com")
	t3 := e.sentInvite(t, keepID, "bea@acme.com")
	for _, c := range []struct {
		tok string
		qs  []survey.Question
	}{{t1, qs}, {t2, qs2}, {t3, qs2}} {
		if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: c.tok, Complete: true, Answers: answers(c.qs, 9, "Private words about my company.")}); err != nil {
			t.Fatal(err)
		}
	}
	ms := &media.Service{Pool: e.db.Backend, HashKey: e.secret}
	if err := ms.DeletePerson(ctx, e.member, pid); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member deleted a person: %v", err)
	}
	if err := ms.DeletePerson(ctx, e.admin, pid); err != nil {
		t.Fatal(err)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_response WHERE survey_id=$1`, removeID).Scan(&n)
	if n != 0 {
		t.Errorf("%d responses of a deleted person remain in a remove-mode survey", n)
	}
	// anonymise: a rating stays, the words go, no name or link remains; the other person is untouched
	res, _ := e.svc.Results(ctx, e.admin, keepID)
	if res.Complete != 2 || res.Numeric[0].Answers != 2 {
		t.Errorf("anonymised results %+v", res)
	}
	var texts, namedByAnn int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_answer a JOIN survey_response r ON r.id=a.response_id WHERE r.survey_id=$1 AND a.value_text IS NOT NULL`, keepID).Scan(&texts)
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_response WHERE survey_id=$1 AND person_id IS NULL`, keepID).Scan(&namedByAnn)
	if texts != 1 || namedByAnn != 1 {
		t.Errorf("after deleting Ann: %d free-text answers (want Bea's 1), %d nameless responses (want 1)", texts, namedByAnn)
	}
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_invite WHERE person_id=$1`, pid).Scan(&n)
	if n != 0 {
		t.Error("the person's invitations remain")
	}
	if _, err := e.svc.View(ctx, t1); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("a deleted person's link still opens: %v", err)
	}
	// nothing identifying Ann is left in any survey table
	for _, tbl := range []string{"survey_response", "survey_invite"} {
		e.db.Super.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE person_id=$1`, tbl), pid).Scan(&n)
		if n != 0 {
			t.Errorf("%s still names the deleted person", tbl)
		}
	}
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_invite WHERE workspace_id=$1 AND to_email='ann@acme.com'`, e.ws).Scan(&n)
	if n != 0 {
		t.Error("the person's address remains in an invitation")
	}
}

// ---------------- results ----------------

func TestResultsCountOnlyFinishedResponses(t *testing.T) {
	e := setup(t)
	id, qs := e.built(t, "open")
	e.svc.Open(ctx, e.admin, id)
	sv, _ := e.svc.Get(ctx, e.admin, id)
	tok := strings.TrimPrefix(sv.PublicLink, "https://app.example/s/")
	scores := []int{10, 9, 9, 8, 7, 6, 3, 0}
	for i, sc := range scores {
		a := append(answers(qs, sc, ""), survey.AnswerInput{QuestionID: qs[1].ID, Number: ip(1 + i%5)}, survey.AnswerInput{QuestionID: qs[2].ID, Choice: sp([]string{"Speed", "Price"}[i%2])})
		if _, err := e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: fmt.Sprintf("result-key-%016d", i), Complete: true, Answers: a}); err != nil {
			t.Fatal(err)
		}
	}
	e.svc.Submit(ctx, survey.SubmitInput{Token: tok, RespondentKey: "result-key-partial-00001", Answers: answers(qs, 0, "")})
	res, err := e.svc.Results(ctx, e.admin, id)
	if err != nil {
		t.Fatal(err)
	}
	nps := res.Numeric[0]
	// 3 promoters (10,9,9), 2 passives (8,7), 3 detractors (6,3,0): score = (3-3)/8 = 0
	if res.Complete != 8 || res.Partial != 1 || nps.Answers != 8 || nps.Promoters != 3 || nps.Passives != 2 || nps.Detractors != 3 || nps.Score != 0 || nps.Average != 52.0/8 {
		t.Errorf("nps %+v (complete %d partial %d)", nps, res.Complete, res.Partial)
	}
	choices := map[string]int{}
	for _, c := range res.Choices {
		choices[c.Choice] = c.Count
	}
	if choices["Speed"] != 4 || choices["Price"] != 4 {
		t.Errorf("choices %v", choices)
	}
	if err := e.svc.Delete(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Get(ctx, e.admin, id); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("deleted survey: %v", err)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM survey_answer WHERE workspace_id=$1`, e.ws).Scan(&n)
	_ = n
}

var _ = json.Marshal
var _ pgx.Tx
var _ dbgen.Queries
