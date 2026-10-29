package research_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/ai"
	"product/api/internal/jobs"
	"product/api/internal/research"
	"product/api/internal/store"
)

type suggestModel struct {
	mu     sync.Mutex
	calls  int
	prompt string
	reply  []map[string]any
}

func (m *suggestModel) Complete(_ context.Context, _ ai.Tier, r ai.Request) (ai.Response, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	m.prompt = r.Messages[0].Text
	raw, _ := json.Marshal(map[string]any{"highlights": m.reply})
	return ai.Response{JSON: raw}, nil
}

const interview = "Priya: Honestly the security team will not let us roll this out without single sign-on.\n" +
	"Sam: Understood. Anything else?\n" +
	"Priya: Yes, the weekly export is painful, I copy it by hand every Friday."

func (e *env) suggestSetup(t *testing.T) (*research.SuggestWorker, *suggestModel, uuid.UUID, map[string]uuid.UUID) {
	t.Helper()
	m := &suggestModel{}
	w := &research.SuggestWorker{Pool: e.db.Backend, Completer: m}
	src := e.source(t, e.admin.WorkspaceID, interview)
	tags := map[string]uuid.UUID{}
	for _, n := range []string{"Security", "Reporting"} {
		id, err := e.svc.CreateTag(ctx, e.admin, research.TagInput{Name: n, Definition: "about " + strings.ToLower(n)})
		if err != nil {
			t.Fatal(err)
		}
		tags[n] = id
	}
	return w, m, src, tags
}

func run(t *testing.T, w *research.SuggestWorker, ten store.Tenant, src uuid.UUID) error {
	t.Helper()
	return w.Work(ctx, &river.Job[research.SuggestArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: research.SuggestArgs{WorkspaceID: ten.WorkspaceID, SourceItemID: src, UserID: ten.UserID}})
}

func TestSuggestionsAreVerbatimTaggedFromTheCodebookAndNeverAutomatic(t *testing.T) {
	e := setup(t)
	w, m, src, tags := e.suggestSetup(t)
	m.reply = []map[string]any{
		{"quote": "the security team will not let us roll this out without single sign-on", "tags": []string{"security"}, "confidence": 0.9}, // tag name in other case
		{"quote": "the weekly export is painful", "tags": []string{"Reporting", "Invented tag"}, "confidence": 0.8},
		{"quote": "the weekly export hurts a lot", "tags": []string{"Reporting"}, "confidence": 0.9},        // paraphrase: dropped
		{"quote": "Understood. Anything else?", "tags": []string{"Not in the codebook"}, "confidence": 0.7}, // no valid tag: dropped
		{"quote": "I copy it by hand every Friday", "tags": []string{"Reporting"}, "confidence": 7},         // confidence clamped
	}
	if err := run(t, w, e.member, src); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.ListSuggestions(ctx, e.viewer, src)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 suggestions, got %d: %+v", len(got), got)
	}
	for _, s := range got {
		if interview[s.SpanStart:s.SpanEnd] != s.Quote {
			t.Errorf("suggestion %q does not match the source at its offsets", s.Quote)
		}
		if len(s.Tags) == 0 || s.Confidence < 0 || s.Confidence > 1 {
			t.Errorf("%+v", s)
		}
	}
	if got[0].Tags[0].Name != "Security" || len(got[1].Tags) != 1 || got[1].Tags[0].Name != "Reporting" {
		t.Errorf("tags: %+v", got)
	}
	// Nothing became a highlight by itself.
	if hs, _ := e.svc.ListHighlights(ctx, e.admin, research.ListFilter{}); len(hs.Highlights) != 0 {
		t.Errorf("suggestions created highlights on their own: %+v", hs)
	}
	// The model was shown the codebook with definitions, not any ids.
	if !strings.Contains(m.prompt, "- Security: about security") || strings.Contains(m.prompt, tags["Security"].String()) {
		t.Errorf("prompt: %s", m.prompt)
	}
	// Running it again adds nothing (same spans).
	if err := run(t, w, e.member, src); err != nil {
		t.Fatal(err)
	}
	if again, _ := e.svc.ListSuggestions(ctx, e.viewer, src); len(again) != 3 {
		t.Errorf("duplicates after a rerun: %d", len(again))
	}

	// Accept as suggested; accept with the person's own tags; dismiss; each only once.
	h, err := e.svc.AcceptSuggestion(ctx, e.member, got[0].ID, nil)
	if err != nil || h.Quote != got[0].Quote || len(h.Tags) != 1 || h.Tags[0].Name != "Security" {
		t.Fatalf("%v %+v", err, h)
	}
	if _, err := e.svc.AcceptSuggestion(ctx, e.member, got[0].ID, nil); !errors.As(err, new(research.ErrConflict)) {
		t.Errorf("accepted twice: %v", err)
	}
	h2, err := e.svc.AcceptSuggestion(ctx, e.member, got[1].ID, []uuid.UUID{tags["Security"], tags["Reporting"]})
	if err != nil || len(h2.Tags) != 2 {
		t.Fatalf("%v %+v", err, h2)
	}
	var edited bool
	_ = e.db.Super.QueryRow(ctx, `SELECT edited FROM highlight_proposal WHERE id=$1`, got[1].ID).Scan(&edited)
	if !edited {
		t.Error("changing the tags should count as an edit")
	}
	if err := e.svc.DismissSuggestion(ctx, e.member, got[2].ID); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DismissSuggestion(ctx, e.member, got[2].ID); !errors.As(err, new(research.ErrConflict)) {
		t.Errorf("dismissed twice: %v", err)
	}
	if left, _ := e.svc.ListSuggestions(ctx, e.viewer, src); len(left) != 0 {
		t.Errorf("handled suggestions still listed: %+v", left)
	}
	if hs, _ := e.svc.ListHighlights(ctx, e.admin, research.ListFilter{SourceItemID: &src}); len(hs.Highlights) != 2 {
		t.Errorf("highlights: %d", len(hs.Highlights))
	}
	// Roles.
	if _, err := e.svc.AcceptSuggestion(ctx, e.viewer, got[2].ID, nil); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer accepted: %v", err)
	}
}

func TestSuggestionsRespectArchivedTagsExistingHighlightsRolesAndWorkspaces(t *testing.T) {
	e := setup(t)
	w, m, src, tags := e.suggestSetup(t)
	quote := "the weekly export is painful"
	m.reply = []map[string]any{
		{"quote": quote, "tags": []string{"Reporting"}, "confidence": 0.8},
		{"quote": "single sign-on", "tags": []string{"Security"}, "confidence": 0.8},
	}
	// Already highlighted by a person: not suggested again.
	i := strings.Index(interview, "single sign-on")
	if _, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: i, SpanEnd: i + len("single sign-on"), Quote: "single sign-on"}); err != nil {
		t.Fatal(err)
	}
	if err := run(t, w, e.member, src); err != nil {
		t.Fatal(err)
	}
	got, _ := e.svc.ListSuggestions(ctx, e.viewer, src)
	if len(got) != 1 || got[0].Quote != quote {
		t.Fatalf("%+v", got)
	}
	// The suggested tag is archived before the person accepts: the highlight is made, without that tag.
	if err := e.svc.ArchiveTag(ctx, e.admin, tags["Reporting"]); err != nil {
		t.Fatal(err)
	}
	h, err := e.svc.AcceptSuggestion(ctx, e.member, got[0].ID, nil)
	if err != nil || len(h.Tags) != 0 {
		t.Fatalf("%v %+v", err, h)
	}
	// Someone in another workspace can neither see nor act on it.
	other := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1,'x')`, other.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	if l, _ := e.svc.ListSuggestions(ctx, other, src); len(l) != 0 {
		t.Errorf("leak: %+v", l)
	}
	if _, err := e.svc.AcceptSuggestion(ctx, other, uuid.New(), nil); !errors.Is(err, research.ErrNotFound) {
		t.Errorf("%v", err)
	}
	// Requesting: needs tags, needs write access, needs a queue; without tags nothing is asked.
	bare := setup(t) // a workspace with no tags at all
	bareSrc := bare.source(t, bare.admin.WorkspaceID, interview)
	if err := setupFresh(t, bare).RequestSuggestions(ctx, bare.admin, bareSrc); !errors.As(err, new(research.ErrInvalid)) {
		t.Errorf("without tags: %v", err)
	}
	fresh := setupFresh(t, e)
	if err := fresh.RequestSuggestions(ctx, e.viewer, src); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer requested: %v", err)
	}
}

func setupFresh(t *testing.T, e *env) *research.Service {
	t.Helper()
	e.db.EnableRiver(t)
	w := river.NewWorkers()
	river.AddWorker(w, &research.SuggestWorker{})
	jc, err := jobs.NewClient(e.db.Backend, w, nil)
	if err != nil {
		t.Fatal(err)
	}
	return &research.Service{Pool: e.db.Backend, Jobs: jc}
}

func TestRequestingSuggestionsQueuesOneJobAndAnIdleWorkerWaits(t *testing.T) {
	e := setup(t)
	svc := setupFresh(t, e)
	src := e.source(t, e.admin.WorkspaceID, interview)
	if _, err := svc.CreateTag(ctx, e.admin, research.TagInput{Name: "Security"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := svc.RequestSuggestions(ctx, e.member, src); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job WHERE kind='suggest_highlights' AND args->>'source_item_id'=$1`, src.String()).Scan(&n)
	if n != 1 {
		t.Errorf("a double click queued %d jobs", n)
	}
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM river.river_job WHERE kind='suggest_highlights' AND queue='research' AND args->>'source_item_id'=$1`, src.String()).Scan(&n)
	if n != 1 {
		t.Errorf("suggestions are not on the research queue: %d", n)
	}
	idle := &research.SuggestWorker{Pool: e.db.Backend}
	err := run(t, idle, e.member, src)
	var snooze *river.JobSnoozeError
	if !errors.As(err, &snooze) {
		t.Errorf("an idle worker should wait: %v", err)
	}
	if err := (&research.Service{Pool: e.db.Backend}).RequestSuggestions(ctx, e.member, src); !errors.Is(err, research.ErrAIOff) {
		t.Errorf("no queue: %v", err)
	}
}
