package survey_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/store"
	"product/api/internal/survey"
)

func TestASurveyCanBeDuplicatedAsANewDraft(t *testing.T) {
	e := setup(t)
	id, err := e.svc.Create(ctx, e.member, survey.Basics{
		Title:          "Quarterly check-in",
		Intro:          "Two minutes, honestly.",
		ThankYou:       "Thanks, that helps.",
		Delivery:       "invited",
		OnPersonDelete: "anonymise",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetQuestions(ctx, e.member, id, []survey.QuestionInput{
		{Kind: "choice", Prompt: "Which plan are you on?", Required: true, Options: []string{"Free", "Team"}},
		{Kind: "text", Prompt: "What should we improve?"},
	}); err != nil {
		t.Fatal(err)
	}

	copyID, err := e.svc.Duplicate(ctx, e.member, id)
	if err != nil {
		t.Fatal(err)
	}
	if copyID == id {
		t.Fatal("duplicate reused the original id")
	}

	got, err := e.svc.Get(ctx, e.member, copyID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "draft" {
		t.Errorf("a copy must start as a draft, got %q", got.State)
	}
	if got.Title != "Quarterly check-in (copy)" {
		t.Errorf("title: %q", got.Title)
	}
	if got.Intro != "Two minutes, honestly." || got.ThankYou != "Thanks, that helps." {
		t.Errorf("wording: %q / %q", got.Intro, got.ThankYou)
	}
	if got.Delivery != "invited" || got.OnPersonDelete != "anonymise" {
		t.Errorf("settings: %q / %q", got.Delivery, got.OnPersonDelete)
	}
	if len(got.Questions) != 2 {
		t.Fatalf("questions: %d", len(got.Questions))
	}
	if got.Questions[0].Prompt != "Which plan are you on?" || got.Questions[0].Kind != "choice" ||
		len(got.Questions[0].Options) != 2 {
		t.Errorf("first question: %+v", got.Questions[0])
	}
	if got.Questions[1].Prompt != "What should we improve?" || got.Questions[1].Kind != "text" {
		t.Errorf("second question: %+v", got.Questions[1])
	}

	// The copy has no answers or invitations of its own.
	if got.Responses != 0 || len(got.InvitesByState) != 0 {
		t.Errorf("copy carries the original's activity: responses=%d invites=%v", got.Responses, got.InvitesByState)
	}

	if _, err := e.svc.Duplicate(ctx, e.viewer, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer: %v", err)
	}
	if _, err := e.svc.Duplicate(ctx, e.member, uuid.New()); !errors.Is(err, survey.ErrNotFound) {
		t.Errorf("unknown survey: %v", err)
	}
}

func TestADuplicateTitleStaysWithinTheLimit(t *testing.T) {
	e := setup(t)
	long := make([]rune, 200)
	for i := range long {
		long[i] = 'a'
	}
	id, err := e.svc.Create(ctx, e.member, survey.Basics{Title: string(long), Delivery: "open"})
	if err != nil {
		t.Fatal(err)
	}
	copyID, err := e.svc.Duplicate(ctx, e.member, id)
	if err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.Get(ctx, e.member, copyID)
	if err != nil {
		t.Fatal(err)
	}
	if n := len([]rune(got.Title)); n != 200 {
		t.Errorf("title length %d, want 200: %q", n, got.Title)
	}
}
