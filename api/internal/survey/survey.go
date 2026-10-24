// Package survey builds surveys, decides who is asked, takes the answers, and turns free-text answers into
// source items for the review queue. Invitations by email follow the same rules as every other message to a
// customer: a person approves them first, the send step refuses anything unapproved, and addresses that asked
// not to be written to are never contacted (see worker.go).
package survey

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/audience"
	"product/api/internal/intake"
	"product/api/internal/outreach"
	"product/api/internal/redact"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound        = errors.New("survey: not found")
	ErrNotOpen         = errors.New("survey: closed")
	ErrNothingToSend   = errors.New("survey: nothing to send")
	ErrConflict        = errors.New("survey: not allowed in this state")
	ErrAlreadyAnswered = errors.New("survey: already answered")
)

// ErrInvalid is input the caller must fix; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ErrLimited is a limit that protects the survey from abuse; the message is safe to show.
type ErrLimited string

func (e ErrLimited) Error() string { return string(e) }

const (
	MaxQuestions     = 30
	MaxTextAnswer    = 2000
	DefaultMaxInvite = 2000
	DefaultDaily     = 2000 // responses a public link takes per day
)

type Service struct {
	Pool    *pgxpool.Pool
	Jobs    *river.Client[pgx.Tx]
	Intake  *intake.Service
	Links   Links
	HashKey []byte // for the shared opt-out list
	// Throttle returns false when this address (or this survey) is asking too often.
	Throttle func(ctx context.Context, key, addr string) bool
	// NewResponseThrottle limits how many new responses one address may start on a public link per day.
	NewResponseThrottle func(ctx context.Context, key, addr string) bool
	MaxInvites          int
	MaxReminders        int           // per person (default 2)
	ReminderGap         time.Duration // least time between two reminders to one person (default 3 days)
	DailyPublic         int
	Now                 func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) maxReminders() int {
	if s.MaxReminders > 0 {
		return s.MaxReminders
	}
	return 2
}

func (s *Service) reminderNotAfter() time.Time {
	gap := s.ReminderGap
	if gap <= 0 {
		gap = 3 * 24 * time.Hour
	}
	return s.now().Add(-gap)
}

func (s *Service) maxInvites() int {
	if s.MaxInvites > 0 {
		return s.MaxInvites
	}
	return DefaultMaxInvite
}

// ---- jobs ----

type SendArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	InviteID    uuid.UUID `json:"invite_id"`
	UserID      uuid.UUID `json:"user_id"`
	Reminder    bool      `json:"reminder,omitempty"` // the one reminder, not the invitation
}

func (SendArgs) Kind() string { return "send_survey_invite" }

// EvidenceArgs turns one finished response's free text into a source item.
type EvidenceArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	ResponseID  uuid.UUID `json:"response_id"`
}

func (EvidenceArgs) Kind() string { return "survey_response_evidence" }

// ---- views ----

type Question struct {
	ID       uuid.UUID
	Kind     string
	Prompt   string
	Required bool
	Options  []string
	ShowIf   *ShowIfView
}

// ShowIf makes a question appear only when an earlier answer matches. Question is the earlier question's
// position (counting from 0) when it is being saved; the view carries its id instead.
type ShowIf struct {
	Question int     `json:"question"`
	Op       string  `json:"op"` // eq, ne, lte, gte
	Number   *int    `json:"number,omitempty"`
	Choice   *string `json:"choice,omitempty"`
}

type ShowIfView struct {
	QuestionID uuid.UUID
	Op         string
	Number     *int
	Choice     *string
}

type Survey struct {
	ID             uuid.UUID
	Title          string
	Intro          string
	ThankYou       string
	State          string
	Delivery       string
	OnPersonDelete string
	Audience       json.RawMessage // null until chosen
	PublicLink     string          // only for an open-delivery survey that is open
	CreatedAt      time.Time
	OpenedAt       *time.Time
	ClosedAt       *time.Time
	Questions      []Question
	InvitesByState map[string]int
	Responses      int
	Partial        int
}

type Row struct {
	ID          uuid.UUID
	Title       string
	State       string
	Delivery    string
	CreatedAt   time.Time
	InvitesSent int
	Responses   int
}

type Basics struct {
	Title, Intro, ThankYou, Delivery, OnPersonDelete string
}

type QuestionInput struct {
	Kind     string
	Prompt   string
	Required bool
	Options  []string
	ShowIf   *ShowIf
}

func cleanBasics(b Basics) (Basics, error) {
	b.Title, b.Intro, b.ThankYou = strings.TrimSpace(b.Title), strings.TrimSpace(b.Intro), strings.TrimSpace(b.ThankYou)
	if n := utf8.RuneCountInString(b.Title); n < 1 || n > 200 {
		return b, ErrInvalid("give the survey a title of up to 200 characters")
	}
	if utf8.RuneCountInString(b.Intro) > 2000 {
		return b, ErrInvalid("the introduction is too long (2,000 characters at most)")
	}
	if utf8.RuneCountInString(b.ThankYou) > 1000 {
		return b, ErrInvalid("the thank-you message is too long (1,000 characters at most)")
	}
	if b.Delivery == "" {
		b.Delivery = "invited"
	}
	if b.Delivery != "invited" && b.Delivery != "open" {
		return b, ErrInvalid("choose personal links or a public link")
	}
	if b.OnPersonDelete == "" {
		b.OnPersonDelete = "remove"
	}
	if b.OnPersonDelete != "remove" && b.OnPersonDelete != "anonymise" {
		return b, ErrInvalid("choose what happens to answers when a person is deleted")
	}
	return b, nil
}

// ---- building ----

func (s *Service) Create(ctx context.Context, t store.Tenant, b Basics) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	b, err := cleanBasics(b)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		sv, err := q.InsertSurvey(ctx, dbgen.InsertSurveyParams{WorkspaceID: t.WorkspaceID, Title: b.Title, Intro: b.Intro, ThankYou: b.ThankYou, Delivery: b.Delivery, OnPersonDelete: b.OnPersonDelete, CreatedBy: t.UserID})
		id = sv.ID
		return err
	})
	return id, err
}

func (s *Service) List(ctx context.Context, t store.Tenant, limit int) ([]Row, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var out []Row
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListSurveys(ctx, dbgen.ListSurveysParams{WorkspaceID: t.WorkspaceID, Limit: int32(limit)})
		for _, r := range rows {
			out = append(out, Row{ID: r.ID, Title: r.Title, State: r.State, Delivery: r.Delivery, CreatedAt: r.CreatedAt, InvitesSent: int(r.InvitesSent), Responses: int(r.Responses)})
		}
		return err
	})
	return out, err
}

func parseShowIf(raw []byte) *ShowIf {
	if len(raw) == 0 {
		return nil
	}
	var c ShowIf
	if json.Unmarshal(raw, &c) != nil {
		return nil
	}
	return &c
}

func questionsOf(rows []dbgen.SurveyQuestion) []Question {
	out := make([]Question, 0, len(rows))
	for _, r := range rows {
		q := Question{ID: r.ID, Kind: r.Kind, Prompt: r.Prompt, Required: r.Required, Options: r.Options}
		if c := parseShowIf(r.ShowIf); c != nil && c.Question >= 0 && c.Question < len(rows) {
			q.ShowIf = &ShowIfView{QuestionID: rows[c.Question].ID, Op: c.Op, Number: c.Number, Choice: c.Choice}
		}
		out = append(out, q)
	}
	return out
}

func tsPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func (s *Service) Get(ctx context.Context, t store.Tenant, id uuid.UUID) (Survey, error) {
	var out Survey
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		qs, err := q.ListSurveyQuestions(ctx, dbgen.ListSurveyQuestionsParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		inv, err := q.CountSurveyInvitesByState(ctx, dbgen.CountSurveyInvitesByStateParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		rs, err := q.CountSurveyResponsesByState(ctx, dbgen.CountSurveyResponsesByStateParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		out = Survey{
			ID: sv.ID, Title: sv.Title, Intro: sv.Intro, ThankYou: sv.ThankYou, State: sv.State, Delivery: sv.Delivery, OnPersonDelete: sv.OnPersonDelete,
			Audience: sv.Audience, CreatedAt: sv.CreatedAt, OpenedAt: tsPtr(sv.OpenedAt), ClosedAt: tsPtr(sv.ClosedAt),
			Questions: questionsOf(qs), InvitesByState: map[string]int{},
		}
		for _, c := range inv {
			out.InvitesByState[c.State] = int(c.N)
		}
		for _, c := range rs {
			if c.State == "complete" {
				out.Responses = int(c.N)
			} else {
				out.Partial = int(c.N)
			}
		}
		if sv.Delivery == "open" && sv.State == "open" {
			out.PublicLink = s.Links.URL(s.Links.OpenToken(t.WorkspaceID, sv.ID, int(sv.LinkEpoch)))
		}
		return nil
	})
	return out, err
}

func (s *Service) Update(ctx context.Context, t store.Tenant, id uuid.UUID, b Basics) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	b, err := cleanBasics(b)
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		sv, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if sv.State != "draft" && b.Delivery != sv.Delivery {
			return ErrConflict // how a survey is delivered is fixed once it has opened
		}
		_, err = q.UpdateSurveyBasics(ctx, dbgen.UpdateSurveyBasicsParams{WorkspaceID: t.WorkspaceID, ID: id, Title: b.Title, Intro: b.Intro, ThankYou: b.ThankYou, Delivery: b.Delivery, OnPersonDelete: b.OnPersonDelete})
		return err
	})
}

// SetQuestions replaces the questions of a draft survey.
func (s *Service) SetQuestions(ctx context.Context, t store.Tenant, id uuid.UUID, in []QuestionInput) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if len(in) == 0 || len(in) > MaxQuestions {
		return ErrInvalid(fmt.Sprintf("a survey has between 1 and %d questions", MaxQuestions))
	}
	clean := make([]QuestionInput, len(in))
	for i, qi := range in {
		qi.Prompt = strings.TrimSpace(qi.Prompt)
		if n := utf8.RuneCountInString(qi.Prompt); n < 1 || n > 300 {
			return ErrInvalid(fmt.Sprintf("question %d needs wording of up to 300 characters", i+1))
		}
		switch qi.Kind {
		case "nps", "csat", "text":
			qi.Options = nil
		case "choice":
			seen := map[string]bool{}
			var opts []string
			for _, o := range qi.Options {
				o = strings.TrimSpace(o)
				if o == "" {
					continue
				}
				if utf8.RuneCountInString(o) > 100 {
					return ErrInvalid(fmt.Sprintf("question %d has an answer choice longer than 100 characters", i+1))
				}
				if seen[strings.ToLower(o)] {
					return ErrInvalid(fmt.Sprintf("question %d lists %q twice", i+1, o))
				}
				seen[strings.ToLower(o)] = true
				opts = append(opts, o)
			}
			if len(opts) < 2 || len(opts) > 10 {
				return ErrInvalid(fmt.Sprintf("question %d needs between 2 and 10 answer choices", i+1))
			}
			qi.Options = opts
		default:
			return ErrInvalid(fmt.Sprintf("question %d has an unknown type", i+1))
		}
		if c := qi.ShowIf; c != nil {
			if c.Question < 0 || c.Question >= i {
				return ErrInvalid(fmt.Sprintf("question %d can only depend on a question before it", i+1))
			}
			src := in[c.Question]
			switch src.Kind {
			case "nps", "csat":
				lo, hi := 0, 10
				if src.Kind == "csat" {
					lo, hi = 1, 5
				}
				if (c.Op != "eq" && c.Op != "ne" && c.Op != "lte" && c.Op != "gte") || c.Number == nil || c.Choice != nil || *c.Number < lo || *c.Number > hi {
					return ErrInvalid(fmt.Sprintf("question %d: the condition on a rating needs a comparison and a number from %d to %d", i+1, lo, hi))
				}
			case "choice":
				ok := false
				if c.Choice != nil {
					for _, o := range src.Options {
						ok = ok || strings.TrimSpace(o) == *c.Choice
					}
				}
				if (c.Op != "eq" && c.Op != "ne") || c.Number != nil || !ok {
					return ErrInvalid(fmt.Sprintf("question %d: the condition on a choice must be one of that question's answers", i+1))
				}
			default:
				return ErrInvalid(fmt.Sprintf("question %d can only depend on a rating or a choice", i+1))
			}
		}
		clean[i] = qi
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		sv, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		existing, err := q.ListSurveyQuestions(ctx, dbgen.ListSurveyQuestionsParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		if sv.State != "draft" {
			// Answers refer to these questions, so once the survey has opened only the wording of a question may
			// change (a typo, a clearer phrase): same questions, same types, choices, conditions and order.
			if len(existing) != len(clean) {
				return ErrConflict
			}
			for i, e := range existing {
				c := clean[i]
				if e.Kind != c.Kind || e.Required != c.Required || strings.Join(e.Options, "\x00") != strings.Join(c.Options, "\x00") || !sameShowIf(parseShowIf(e.ShowIf), c.ShowIf) {
					return ErrConflict
				}
			}
			for i, e := range existing {
				if e.Prompt != clean[i].Prompt {
					if _, err := q.SetSurveyQuestionPrompt(ctx, dbgen.SetSurveyQuestionPromptParams{WorkspaceID: t.WorkspaceID, SurveyID: id, Ordinal: int32(i), Prompt: clean[i].Prompt}); err != nil {
						return err
					}
				}
			}
			return nil
		}
		if err := q.DeleteSurveyQuestions(ctx, dbgen.DeleteSurveyQuestionsParams{WorkspaceID: t.WorkspaceID, SurveyID: id}); err != nil {
			return err
		}
		for i, qi := range clean {
			opts := qi.Options
			if opts == nil {
				opts = []string{}
			}
			var showIf []byte
			if qi.ShowIf != nil {
				showIf, _ = json.Marshal(qi.ShowIf)
			}
			if err := q.InsertSurveyQuestion(ctx, dbgen.InsertSurveyQuestionParams{WorkspaceID: t.WorkspaceID, SurveyID: id, Ordinal: int32(i), Kind: qi.Kind, Prompt: qi.Prompt, Required: qi.Required, Options: opts, ShowIf: showIf}); err != nil {
				return err
			}
		}
		return nil
	})
}

func sameShowIf(a, b *ShowIf) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

// SetAudience saves who the survey is for. The rule is parsed and stored in its checked form.
func (s *Service) SetAudience(ctx context.Context, t store.Tenant, id uuid.UUID, raw []byte) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	rule, err := audience.Parse(raw)
	if err != nil {
		return ErrInvalid(err.Error())
	}
	stored, err := json.Marshal(rule)
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.SetSurveyAudience(ctx, dbgen.SetSurveyAudienceParams{WorkspaceID: t.WorkspaceID, ID: id, Audience: stored})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

type Preview struct {
	Total, WithEmail, AlreadyInvited int
	Sample                           []audience.Match
}

// PreviewAudience shows how many people the rule picks now, without inviting anyone. A rule may be given to
// try before saving; otherwise the saved one is used.
func (s *Service) PreviewAudience(ctx context.Context, t store.Tenant, id uuid.UUID, raw []byte) (Preview, error) {
	var out Preview
	var rule audience.Rule
	if len(raw) > 0 {
		r, err := audience.Parse(raw)
		if err != nil {
			return out, ErrInvalid(err.Error())
		}
		rule = r
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if len(raw) == 0 {
			if len(sv.Audience) == 0 {
				return ErrInvalid("choose who the survey is for first")
			}
			if rule, err = audience.Parse(sv.Audience); err != nil {
				return ErrInvalid(err.Error())
			}
		}
		out.Total, out.WithEmail, out.Sample, err = audience.Select(ctx, tx, t.WorkspaceID, rule, s.now(), 10)
		if err != nil {
			return err
		}
		inv, err := q.CountSurveyInvitesByState(ctx, dbgen.CountSurveyInvitesByStateParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		for _, c := range inv {
			out.AlreadyInvited += int(c.N)
		}
		return err
	})
	return out, err
}

// Open starts taking answers. Questions are fixed from here on.
func (s *Service) Open(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		qs, err := q.ListSurveyQuestions(ctx, dbgen.ListSurveyQuestionsParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		if len(qs) == 0 {
			return ErrInvalid("add at least one question before opening the survey")
		}
		n, err := q.OpenSurvey(ctx, dbgen.OpenSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		return nil
	})
}

func (s *Service) Close(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.CloseSurvey(ctx, dbgen.CloseSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		return nil
	})
}

// ResetLink retires every copy of the public link and returns the new one.
func (s *Service) ResetLink(ctx context.Context, t store.Tenant, id uuid.UUID) (string, error) {
	if !t.CanWrite() {
		return "", store.ErrForbidden
	}
	var link string
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if sv.Delivery != "open" {
			return ErrConflict
		}
		epoch, err := q.ResetSurveyLink(ctx, dbgen.ResetSurveyLinkParams{WorkspaceID: t.WorkspaceID, ID: id})
		link = s.Links.URL(s.Links.OpenToken(t.WorkspaceID, id, int(epoch)))
		return err
	})
	return link, err
}

// Delete removes the survey with its questions, invitations and answers. Admins only.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		// Sent invitations leave their opt-out links working: keep a fingerprint for each, as deleting a person does.
		if err := tombstoneInvites(ctx, q, s.HashKey, t.WorkspaceID, id, uuid.Nil); err != nil {
			return err
		}
		n, err := q.DeleteSurvey(ctx, dbgen.DeleteSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// ---- invitations ----

type InviteSummary struct{ Added, AlreadyInvited, Suppressed, Manual int }

// CreateInvites writes down who will be asked: everyone the audience picks who has an address, once each.
// Nothing is sent. Addresses that asked not to be written to are recorded as suppressed and never contacted.
func (s *Service) CreateInvites(ctx context.Context, t store.Tenant, id uuid.UUID, withoutEmail bool) (InviteSummary, error) {
	var sum InviteSummary
	if !t.CanWrite() {
		return sum, store.ErrForbidden
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		sv, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if sv.State == "closed" {
			return ErrConflict
		}
		if sv.Delivery != "invited" {
			return ErrInvalid("this survey is shared with a public link, not by personal invitations")
		}
		if len(sv.Audience) == 0 {
			return ErrInvalid("choose who the survey is for first")
		}
		rule, err := audience.Parse(sv.Audience)
		if err != nil {
			return ErrInvalid(err.Error())
		}
		people, err := audience.Emailable(ctx, tx, t.WorkspaceID, rule, s.now(), s.maxInvites()+1)
		if err != nil {
			return err
		}
		if len(people) > s.maxInvites() {
			return ErrInvalid(fmt.Sprintf("this audience has more than %d people with an address; narrow it", s.maxInvites()))
		}
		if withoutEmail {
			// People with no address: a personal link for the owner to hand over; nothing is ever emailed.
			none, err := audience.NoEmail(ctx, tx, t.WorkspaceID, rule, s.now(), s.maxInvites()+1)
			if err != nil {
				return err
			}
			if len(none) > s.maxInvites() {
				return ErrInvalid(fmt.Sprintf("this audience has more than %d people without an address; narrow it", s.maxInvites()))
			}
			for _, p := range none {
				_, err := q.InsertSurveyInvite(ctx, dbgen.InsertSurveyInviteParams{WorkspaceID: t.WorkspaceID, SurveyID: id, PersonID: p.ID, ToEmail: "", State: "manual"})
				switch {
				case errors.Is(err, pgx.ErrNoRows):
					sum.AlreadyInvited++
				case err != nil:
					return err
				default:
					sum.Manual++
				}
			}
		}
		for _, p := range people {
			addr := strings.ToLower(strings.TrimSpace(p.Email))
			state := "draft"
			if sup, err := outreach.Suppressed(ctx, q, s.HashKey, t.WorkspaceID, addr); err != nil {
				return err
			} else if sup {
				state = "suppressed"
			}
			_, err := q.InsertSurveyInvite(ctx, dbgen.InsertSurveyInviteParams{WorkspaceID: t.WorkspaceID, SurveyID: id, PersonID: p.ID, ToEmail: addr, State: state})
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				sum.AlreadyInvited++
			case err != nil:
				return err
			case state == "suppressed":
				sum.Suppressed++
			default:
				sum.Added++
			}
		}
		return nil
	})
	return sum, err
}

type Invite struct {
	ID         uuid.UUID
	PersonID   uuid.UUID
	PersonName string
	Email      string
	State      string
	SentAt     *time.Time
	Answered   bool
	Reminder   string // "", "approved", "sending" or "failed"
	Reminded   int    // how many reminders have gone out
}

func (s *Service) ListInvites(ctx context.Context, t store.Tenant, id uuid.UUID, limit int) ([]Invite, error) {
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	var out []Invite
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		rows, err := q.ListSurveyInvites(ctx, dbgen.ListSurveyInvitesParams{WorkspaceID: t.WorkspaceID, SurveyID: id, Limit: int32(limit)})
		for _, r := range rows {
			out = append(out, Invite{ID: r.ID, PersonID: r.PersonID, PersonName: r.PersonName, Email: r.ToEmail, State: r.State, SentAt: tsPtr(r.SentAt), Answered: r.Answered, Reminder: r.ReminderState.String, Reminded: int(r.ReminderCount)})
		}
		return err
	})
	return out, err
}

type ManualLink struct {
	PersonName string
	Link       string
}

// ManualLinks are the personal links of people who have no email address, for the owner to hand over some other
// way (a message, a printed card, a support chat). Whoever holds a link can answer once for that person.
func (s *Service) ManualLinks(ctx context.Context, t store.Tenant, id uuid.UUID) ([]ManualLink, error) {
	if !t.CanWrite() {
		return nil, store.ErrForbidden
	}
	var out []ManualLink
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if sv.State != "open" {
			return ErrInvalid("open the survey first; links only work while it is open")
		}
		rows, err := q.ListSurveyInvites(ctx, dbgen.ListSurveyInvitesParams{WorkspaceID: t.WorkspaceID, SurveyID: id, Limit: 100000})
		if err != nil {
			return err
		}
		for _, r := range rows {
			if r.State == "manual" {
				out = append(out, ManualLink{PersonName: r.PersonName, Link: s.Links.URL(s.Links.InviteToken(t.WorkspaceID, r.ID))})
			}
		}
		return nil
	})
	return out, err
}

// SetInviteExcluded takes one person off the list before sending, or puts them back.
func (s *Service) SetInviteExcluded(ctx context.Context, t store.Tenant, inviteID uuid.UUID, exclude bool) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.ToggleSurveyInvite(ctx, dbgen.ToggleSurveyInviteParams{WorkspaceID: t.WorkspaceID, ID: inviteID, Exclude: exclude})
		if err != nil {
			return err
		}
		if n == 0 {
			if _, gerr := q.GetSurveyInvite(ctx, dbgen.GetSurveyInviteParams{WorkspaceID: t.WorkspaceID, ID: inviteID}); errors.Is(gerr, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return ErrConflict
		}
		return nil
	})
}

// Approve is the one step that lets invitations go out: it marks every invitation still waiting as approved by
// this person and queues one send each, in the same transaction. The survey must be open.
func (s *Service) Approve(ctx context.Context, t store.Tenant, id uuid.UUID) (queued int, err error) {
	if !t.CanWrite() {
		return 0, store.ErrForbidden
	}
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		sv, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if sv.State != "open" {
			return ErrInvalid("open the survey before sending invitations")
		}
		ids, err := q.ApproveSurveyInvites(ctx, dbgen.ApproveSurveyInvitesParams{WorkspaceID: t.WorkspaceID, SurveyID: id, ApprovedBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return ErrNothingToSend
		}
		for _, inv := range ids {
			if _, err := s.Jobs.InsertTx(ctx, tx, SendArgs{WorkspaceID: t.WorkspaceID, InviteID: inv, UserID: t.UserID}, nil); err != nil {
				return fmt.Errorf("enqueue invitation: %w", err)
			}
		}
		queued = len(ids)
		return nil
	})
	return queued, err
}

// Remindable is how many people could get a reminder now: invited, not finished, never reminded.
func (s *Service) Remindable(ctx context.Context, t store.Tenant, id uuid.UUID) (int, error) {
	var n int
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountSurveyRemindable(ctx, dbgen.CountSurveyRemindableParams{Ws: t.WorkspaceID, Survey: id, MaxReminders: int32(s.maxReminders()), NotAfter: s.reminderNotAfter()})
		n = int(c)
		return err
	})
	return n, err
}

// ApproveReminders lets a reminder go to everyone whose invitation went out and who has not finished, has had
// fewer than the allowed number, and was last reminded long enough ago. Same approval rule as the invitation: the survey must be open and a person
// must say yes.
func (s *Service) ApproveReminders(ctx context.Context, t store.Tenant, id uuid.UUID) (queued int, err error) {
	if !t.CanWrite() {
		return 0, store.ErrForbidden
	}
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		sv, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if sv.State != "open" {
			return ErrInvalid("open the survey before sending reminders")
		}
		ids, err := q.ApproveSurveyReminders(ctx, dbgen.ApproveSurveyRemindersParams{Ws: t.WorkspaceID, Survey: id, By: uuid.NullUUID{UUID: t.UserID, Valid: true}, MaxReminders: int32(s.maxReminders()), NotAfter: s.reminderNotAfter()})
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return ErrNothingToSend
		}
		for _, inv := range ids {
			if _, err := s.Jobs.InsertTx(ctx, tx, SendArgs{WorkspaceID: t.WorkspaceID, InviteID: inv, UserID: t.UserID, Reminder: true}, nil); err != nil {
				return fmt.Errorf("enqueue reminder: %w", err)
			}
		}
		queued = len(ids)
		return nil
	})
	return queued, err
}

// tombstoneInvites keeps, for every invitation that was actually sent, the link's id and the address hash, so an
// opt-out link in someone's inbox still works after the invitation (or the person) is gone. person == Nil means
// every person of the survey.
func tombstoneInvites(ctx context.Context, q *dbgen.Queries, key []byte, ws, surveyID, person uuid.UUID) error {
	if len(key) == 0 {
		return nil
	}
	var rows []struct {
		ID    uuid.UUID
		Email string
	}
	if person != uuid.Nil {
		r, err := q.SentSurveyInvitesForPerson(ctx, dbgen.SentSurveyInvitesForPersonParams{WorkspaceID: ws, PersonID: person})
		if err != nil {
			return err
		}
		for _, x := range r {
			rows = append(rows, struct {
				ID    uuid.UUID
				Email string
			}{x.ID, x.ToEmail})
		}
	} else {
		invs, err := q.ListSurveyInvites(ctx, dbgen.ListSurveyInvitesParams{WorkspaceID: ws, SurveyID: surveyID, Limit: 100000})
		if err != nil {
			return err
		}
		for _, x := range invs {
			if x.State == "sent" || x.State == "sending" {
				rows = append(rows, struct {
					ID    uuid.UUID
					Email string
				}{x.ID, x.ToEmail})
			}
		}
	}
	for _, r := range rows {
		if err := q.InsertTombstone(ctx, dbgen.InsertTombstoneParams{WorkspaceID: ws, MessageID: r.ID, EmailHash: outreach.EmailHash(key, r.Email)}); err != nil {
			return err
		}
	}
	return nil
}

// ErasePerson is called when a person is deleted, before the person row goes. It keeps opt-out fingerprints for
// invitations already sent, deletes the invitations, and removes or anonymises the person's answers according to
// each survey's setting. (Free text that became a source item is deleted with the person's other sources.)
func ErasePerson(ctx context.Context, q *dbgen.Queries, key []byte, ws, person uuid.UUID) error {
	if err := tombstoneInvites(ctx, q, key, ws, uuid.Nil, person); err != nil {
		return err
	}
	if err := q.DeleteSurveyResponsesOfPerson(ctx, dbgen.DeleteSurveyResponsesOfPersonParams{WorkspaceID: ws, PersonID: uuid.NullUUID{UUID: person, Valid: true}}); err != nil {
		return err
	}
	if err := q.AnonymiseSurveyResponsesOfPerson(ctx, dbgen.AnonymiseSurveyResponsesOfPersonParams{WorkspaceID: ws, PersonID: uuid.NullUUID{UUID: person, Valid: true}}); err != nil {
		return err
	}
	return q.DeleteSurveyInvitesForPerson(ctx, dbgen.DeleteSurveyInvitesForPersonParams{WorkspaceID: ws, PersonID: person})
}

// ---- results ----

type NumericResult struct {
	QuestionID uuid.UUID
	Kind       string
	Answers    int
	Average    float64
	// NPS only
	Promoters, Passives, Detractors int
	Score                           int // promoters minus detractors, as a percentage of answers
}

type ChoiceCount struct {
	QuestionID uuid.UUID
	Choice     string
	Count      int
}

type TextAnswer struct {
	QuestionID   uuid.UUID
	Text         string
	At           *time.Time
	Person       string
	SourceItemID *uuid.UUID
}

type Results struct {
	Complete, Partial int
	Numeric           []NumericResult
	Choices           []ChoiceCount
	Text              []TextAnswer
}

func (s *Service) Results(ctx context.Context, t store.Tenant, id uuid.UUID) (Results, error) {
	var out Results
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		rs, err := q.CountSurveyResponsesByState(ctx, dbgen.CountSurveyResponsesByStateParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		for _, c := range rs {
			if c.State == "complete" {
				out.Complete = int(c.N)
			} else {
				out.Partial = int(c.N)
			}
		}
		nums, err := q.SurveyNumericResults(ctx, dbgen.SurveyNumericResultsParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		for _, n := range nums {
			r := NumericResult{QuestionID: n.QuestionID, Kind: n.Kind, Answers: int(n.Answers), Promoters: int(n.Promoters), Passives: int(n.Passives), Detractors: int(n.Detractors)}
			if n.Answers > 0 {
				r.Average = float64(n.Total) / float64(n.Answers)
				if n.Kind == "nps" {
					r.Score = int(float64(n.Promoters-n.Detractors) * 100 / float64(n.Answers))
				}
			}
			out.Numeric = append(out.Numeric, r)
		}
		cs, err := q.SurveyChoiceResults(ctx, dbgen.SurveyChoiceResultsParams{WorkspaceID: t.WorkspaceID, SurveyID: id})
		if err != nil {
			return err
		}
		for _, c := range cs {
			out.Choices = append(out.Choices, ChoiceCount{QuestionID: c.QuestionID, Choice: c.Choice.String, Count: int(c.N)})
		}
		ts, err := q.ListSurveyTextAnswers(ctx, dbgen.ListSurveyTextAnswersParams{WorkspaceID: t.WorkspaceID, SurveyID: id, Limit: 200})
		if err != nil {
			return err
		}
		for _, a := range ts {
			ta := TextAnswer{QuestionID: a.QuestionID, Text: a.Text.String, At: tsPtr(a.SubmittedAt), Person: a.PersonName}
			if a.SourceItemID.Valid {
				id := a.SourceItemID.UUID
				ta.SourceItemID = &id
			}
			out.Text = append(out.Text, ta)
		}
		return nil
	})
	return out, err
}

// redactAnswer hides card numbers, keys and passwords before an answer is stored.
func redactAnswer(s string) string { return redact.Text(s).Text }
