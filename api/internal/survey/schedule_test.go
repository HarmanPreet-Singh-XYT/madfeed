package survey_test

import (
	"errors"
	"testing"
	"time"

	"product/api/internal/store"
	"product/api/internal/survey"
)

func TestASurveyCanBeScheduledToClose(t *testing.T) {
	e := setup(t)
	id, err := e.svc.Create(ctx, e.member, survey.Basics{Title: "Scheduled", Delivery: "open"})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Add(time.Hour).Truncate(time.Second)

	// A draft can be scheduled before it opens.
	if err := e.svc.Schedule(ctx, e.member, id, &at); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.Get(ctx, e.member, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClosesAt == nil || !got.ClosesAt.Equal(at) {
		t.Fatalf("closes at: %v, want %v", got.ClosesAt, at)
	}

	// Clearing it works.
	if err := e.svc.Schedule(ctx, e.member, id, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ = e.svc.Get(ctx, e.member, id); got.ClosesAt != nil {
		t.Fatalf("schedule was not cleared: %v", got.ClosesAt)
	}

	// A time that has already passed is refused.
	past := time.Now().UTC().Add(-time.Minute)
	if err := e.svc.Schedule(ctx, e.member, id, &past); !errors.As(err, new(survey.ErrInvalid)) {
		t.Fatalf("past time: %v", err)
	}

	// Opening keeps a schedule; closing by hand clears it.
	if err := e.svc.SetQuestions(ctx, e.member, id, []survey.QuestionInput{{Kind: "text", Prompt: "Why?"}}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Open(ctx, e.member, id); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Schedule(ctx, e.member, id, &at); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Close(ctx, e.member, id); err != nil {
		t.Fatal(err)
	}
	got, _ = e.svc.Get(ctx, e.member, id)
	if got.State != "closed" || got.ClosesAt != nil {
		t.Fatalf("after a manual close: state=%s closesAt=%v", got.State, got.ClosesAt)
	}
	// A closed survey cannot be scheduled again until it is reopened.
	if err := e.svc.Schedule(ctx, e.member, id, &at); !errors.Is(err, survey.ErrConflict) {
		t.Fatalf("closed survey: %v", err)
	}

	if err := e.svc.Schedule(ctx, e.viewer, id, &at); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer: %v", err)
	}
}

func TestTheSchedulerClosesSurveysWhoseTimeIsUp(t *testing.T) {
	e := setup(t)
	id, err := e.svc.Create(ctx, e.member, survey.Basics{Title: "Due", Delivery: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetQuestions(ctx, e.member, id, []survey.QuestionInput{{Kind: "text", Prompt: "Why?"}}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Open(ctx, e.member, id); err != nil {
		t.Fatal(err)
	}
	// A time in the past, as if the clock had moved on since it was set.
	e.exec(t, `UPDATE survey SET closes_at = now() - interval '1 minute' WHERE workspace_id=$1 AND id=$2`, e.ws, id)

	s := &survey.Scheduler{Pool: e.db.Backend}
	n, err := s.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("closed %d surveys, want 1", n)
	}
	got, err := e.svc.Get(ctx, e.member, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "closed" || got.ClosedAt == nil {
		t.Fatalf("after the sweep: state=%s closedAt=%v", got.State, got.ClosedAt)
	}
	if got.ClosesAt != nil {
		t.Fatalf("a fired schedule should be cleared: %v", got.ClosesAt)
	}

	// Running again changes nothing.
	if n, err := s.Run(ctx); err != nil || n != 0 {
		t.Fatalf("second sweep: n=%d err=%v", n, err)
	}
}
