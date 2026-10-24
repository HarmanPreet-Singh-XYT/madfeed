package survey

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// What a person sees when they open a link, and what they send back. Nothing here is signed in: the link is the
// only credential, and it opens exactly one survey (and, for a personal link, one invitation).

type SavedAnswer struct {
	QuestionID uuid.UUID
	Number     *int
	Choice     *string
	Text       *string
}

type PublicSurvey struct {
	WorkspaceName string
	Title         string
	Intro         string
	ThankYou      string
	Closed        bool
	Answered      bool // a personal link that already has a finished response
	Questions     []Question
	Saved         []SavedAnswer // an unfinished response, so a person can pick up where they stopped
}

type AnswerInput struct {
	QuestionID uuid.UUID
	Number     *int
	Choice     *string
	Text       *string
}

type SubmitInput struct {
	Token         string
	RespondentKey string // a public link: an id the browser makes up and keeps
	Answers       []AnswerInput
	Complete      bool
	Honeypot      string // a field real people never see; bots fill it in
	Addr          string // for limits only; never stored
}

type SubmitResult struct {
	Complete        bool
	AlreadyAnswered bool
	ThankYou        string
}

var respondentRe = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

func systemTenant(ws uuid.UUID) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
}

// resolved is what a verified link opens.
type resolved struct {
	ws     uuid.UUID
	survey dbgen.Survey
	invite *dbgen.SurveyInvite
}

func (s *Service) resolve(ctx context.Context, q *dbgen.Queries, token string) (resolved, error) {
	ref, err := s.Links.Verify(token)
	if err != nil {
		return resolved{}, ErrNotFound // a bad link looks like any other missing page
	}
	var r resolved
	r.ws = ref.Workspace
	if ref.Open {
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: ref.Workspace, ID: ref.Survey})
		if err != nil || sv.Delivery != "open" || int(sv.LinkEpoch) != ref.Epoch {
			return r, ErrNotFound
		}
		r.survey = sv
		return r, nil
	}
	inv, err := q.GetSurveyInvite(ctx, dbgen.GetSurveyInviteParams{WorkspaceID: ref.Workspace, ID: ref.Invite})
	if err != nil || (inv.State != "sent" && inv.State != "sending" && inv.State != "approved" && inv.State != "manual") {
		return r, ErrNotFound
	}
	sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: ref.Workspace, ID: inv.SurveyID})
	if err != nil {
		return r, ErrNotFound
	}
	r.survey, r.invite = sv, &inv
	return r, nil
}

// View is what the page shows. A survey that has not opened looks like a missing page; a closed one says so.
func (s *Service) View(ctx context.Context, token string) (PublicSurvey, error) {
	var out PublicSurvey
	ref, err := s.Links.Verify(token)
	if err != nil {
		return out, ErrNotFound
	}
	err = store.WithTenant(ctx, s.Pool, systemTenant(ref.Workspace), func(q *dbgen.Queries) error {
		r, err := s.resolve(ctx, q, token)
		if err != nil {
			return err
		}
		if r.survey.State == "draft" {
			return ErrNotFound
		}
		ws, err := q.GetWorkspaceSettings(ctx, r.ws)
		if err != nil {
			return err
		}
		out = PublicSurvey{WorkspaceName: ws.Name, Title: r.survey.Title, Intro: r.survey.Intro, ThankYou: r.survey.ThankYou, Closed: r.survey.State == "closed"}
		qs, err := q.ListSurveyQuestions(ctx, dbgen.ListSurveyQuestionsParams{WorkspaceID: r.ws, SurveyID: r.survey.ID})
		if err != nil {
			return err
		}
		out.Questions = questionsOf(qs)
		if r.invite != nil {
			resp, err := q.GetSurveyResponseByInvite(ctx, dbgen.GetSurveyResponseByInviteParams{WorkspaceID: r.ws, SurveyID: r.survey.ID, InviteID: uuid.NullUUID{UUID: r.invite.ID, Valid: true}})
			if err == nil {
				out.Answered = resp.State == "complete"
				if !out.Answered {
					out.Saved, err = savedAnswers(ctx, q, r.ws, resp.ID)
					return err
				}
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		return nil
	})
	return out, err
}

// Saved returns what a browser already saved on a public link.
func (s *Service) Saved(ctx context.Context, token, respondentKey string) ([]SavedAnswer, bool, error) {
	ref, err := s.Links.Verify(token)
	if err != nil || !ref.Open || !respondentRe.MatchString(respondentKey) {
		return nil, false, ErrNotFound
	}
	var out []SavedAnswer
	done := false
	err = store.WithTenant(ctx, s.Pool, systemTenant(ref.Workspace), func(q *dbgen.Queries) error {
		r, err := s.resolve(ctx, q, token)
		if err != nil {
			return err
		}
		resp, err := q.GetSurveyResponseByRespondent(ctx, dbgen.GetSurveyResponseByRespondentParams{WorkspaceID: r.ws, SurveyID: r.survey.ID, RespondentKey: pgtype.Text{String: respondentKey, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		done = resp.State == "complete"
		if done {
			return nil
		}
		out, err = savedAnswers(ctx, q, r.ws, resp.ID)
		return err
	})
	return out, done, err
}

func savedAnswers(ctx context.Context, q *dbgen.Queries, ws, response uuid.UUID) ([]SavedAnswer, error) {
	rows, err := q.ListSurveyAnswers(ctx, dbgen.ListSurveyAnswersParams{WorkspaceID: ws, ResponseID: response})
	if err != nil {
		return nil, err
	}
	out := make([]SavedAnswer, 0, len(rows))
	for _, a := range rows {
		sa := SavedAnswer{QuestionID: a.QuestionID}
		if a.ValueNum.Valid {
			n := int(a.ValueNum.Int32)
			sa.Number = &n
		}
		if a.ValueChoice.Valid {
			c := a.ValueChoice.String
			sa.Choice = &c
		}
		if a.ValueText.Valid {
			x := a.ValueText.String
			sa.Text = &x
		}
		out = append(out, sa)
	}
	return out, nil
}

type clean struct {
	q      dbgen.SurveyQuestion
	num    pgtype.Int4
	choice pgtype.Text
	text   pgtype.Text
}

// checkAnswers validates every answer against its question. Text is redacted before it is kept. An empty text
// answer means "skipped". When finishing, every required question must be answered.
func checkAnswers(qs []dbgen.SurveyQuestion, in []AnswerInput, finish bool) ([]clean, error) {
	byID := map[uuid.UUID]dbgen.SurveyQuestion{}
	for _, q := range qs {
		byID[q.ID] = q
	}
	seen := map[uuid.UUID]bool{}
	var out []clean
	for _, a := range in {
		q, ok := byID[a.QuestionID]
		if !ok {
			return nil, ErrInvalid("an answer refers to a question that is not in this survey")
		}
		if seen[q.ID] {
			return nil, ErrInvalid("a question was answered twice")
		}
		seen[q.ID] = true
		c := clean{q: q}
		only := func(set int) bool { // exactly the one field this kind of question uses
			n := 0
			if a.Number != nil {
				n++
			}
			if a.Choice != nil {
				n++
			}
			if a.Text != nil {
				n++
			}
			return n == set
		}
		switch q.Kind {
		case "nps", "csat":
			lo, hi := 0, 10
			if q.Kind == "csat" {
				lo, hi = 1, 5
			}
			if a.Number == nil || !only(1) || *a.Number < lo || *a.Number > hi {
				return nil, ErrInvalid(fmt.Sprintf("choose a rating from %d to %d", lo, hi))
			}
			c.num = pgtype.Int4{Int32: int32(*a.Number), Valid: true}
		case "choice":
			if a.Choice == nil || !only(1) {
				return nil, ErrInvalid("choose one of the answers offered")
			}
			found := false
			for _, o := range q.Options {
				if o == *a.Choice {
					found = true
				}
			}
			if !found {
				return nil, ErrInvalid("choose one of the answers offered")
			}
			c.choice = pgtype.Text{String: *a.Choice, Valid: true}
		case "text":
			if a.Text == nil || !only(1) {
				return nil, ErrInvalid("write your answer in the box")
			}
			txt := strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(*a.Text, "\x00", ""), ""))
			if utf8.RuneCountInString(txt) > MaxTextAnswer {
				return nil, ErrInvalid(fmt.Sprintf("answers can be up to %d characters", MaxTextAnswer))
			}
			if txt == "" {
				continue // skipped
			}
			txt = strings.TrimSpace(redactAnswer(txt))
			c.text = pgtype.Text{String: txt, Valid: true}
		}
		out = append(out, c)
	}
	// A question that is not shown (its condition does not hold) takes no answer: anything sent for it is
	// dropped, and it is never required.
	byQ := map[uuid.UUID]clean{}
	for _, c := range out {
		byQ[c.q.ID] = c
	}
	visible := map[uuid.UUID]bool{}
	var kept []clean
	for _, q := range qs {
		vis := true
		if w := parseShowWhen(q.ShowIf); w != nil {
			// a condition holds only if the question it looks at was itself shown and answered
			vis = w.Match == "all"
			for _, cond := range w.Conditions {
				held := false
				if cond.Question >= 0 && cond.Question < len(qs) {
					src := qs[cond.Question]
					if a, ok := byQ[src.ID]; ok && visible[src.ID] {
						held = holds(&cond, a)
					}
				}
				if w.Match == "all" {
					vis = vis && held
				} else {
					vis = vis || held
				}
			}
		}
		visible[q.ID] = vis
		if a, ok := byQ[q.ID]; ok && vis {
			kept = append(kept, a)
		}
	}
	out = kept
	if finish {
		answered := map[uuid.UUID]bool{}
		for _, c := range out {
			answered[c.q.ID] = true
		}
		missing := 0
		for _, q := range qs {
			if q.Required && visible[q.ID] && !answered[q.ID] {
				missing++
			}
		}
		if missing > 0 {
			return nil, ErrInvalid(fmt.Sprintf("answer the %d required question(s) first", missing))
		}
	}
	return out, nil
}

// Submit saves a person's answers so far (the full current set replaces what was saved), and finishes the
// response when asked. Finishing is final: a second submission for the same invitation or browser changes
// nothing and says so. A finished response with free text queues that text for the review queue.
func (s *Service) Submit(ctx context.Context, in SubmitInput) (SubmitResult, error) {
	var res SubmitResult
	ref, err := s.Links.Verify(in.Token)
	if err != nil {
		return res, ErrNotFound
	}
	if in.Honeypot != "" {
		// A bot filled in the field no person can see. Look like success and keep nothing.
		return SubmitResult{Complete: in.Complete}, nil
	}
	if len(in.Answers) > MaxQuestions {
		return res, ErrInvalid("too many answers")
	}
	limitKey := hexID(ref.Invite)
	if ref.Open {
		limitKey = hexID(ref.Survey)
	}
	if s.Throttle != nil && !s.Throttle(ctx, "survey:"+limitKey, in.Addr) {
		return res, ErrLimited("you are sending answers too quickly; wait a moment and try again")
	}
	if ref.Open && !respondentRe.MatchString(in.RespondentKey) {
		return res, ErrInvalid("this page could not identify your browser; reload it and try again")
	}
	daily := s.DailyPublic
	if daily <= 0 {
		daily = DefaultDaily
	}
	err = store.WithTenantTx(ctx, s.Pool, systemTenant(ref.Workspace), func(tx pgx.Tx, q *dbgen.Queries) error {
		r, err := s.resolve(ctx, q, in.Token)
		if err != nil {
			return err
		}
		if r.survey.State == "draft" {
			return ErrNotFound
		}
		// Serialise everything about one response: two taps at once must not make two responses.
		sv, err := q.GetSurveyForUpdate(ctx, dbgen.GetSurveyForUpdateParams{WorkspaceID: r.ws, ID: r.survey.ID})
		if err != nil {
			return err
		}
		res.ThankYou = sv.ThankYou
		var resp dbgen.SurveyResponse
		if r.invite != nil {
			resp, err = q.GetSurveyResponseByInvite(ctx, dbgen.GetSurveyResponseByInviteParams{WorkspaceID: r.ws, SurveyID: sv.ID, InviteID: uuid.NullUUID{UUID: r.invite.ID, Valid: true}})
		} else {
			resp, err = q.GetSurveyResponseByRespondent(ctx, dbgen.GetSurveyResponseByRespondentParams{WorkspaceID: r.ws, SurveyID: sv.ID, RespondentKey: pgtype.Text{String: in.RespondentKey, Valid: true}})
		}
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if exists && resp.State == "complete" {
			res = SubmitResult{Complete: true, AlreadyAnswered: true, ThankYou: sv.ThankYou}
			return nil // final: a repeat changes nothing
		}
		if sv.State != "open" {
			return ErrNotOpen
		}
		qs, err := q.ListSurveyQuestions(ctx, dbgen.ListSurveyQuestionsParams{WorkspaceID: r.ws, SurveyID: sv.ID})
		if err != nil {
			return err
		}
		answers, err := checkAnswers(qs, in.Answers, in.Complete)
		if err != nil {
			return err
		}
		if !exists {
			if r.invite == nil {
				since := s.now().Add(-24 * time.Hour)
				n, err := q.CountSurveyResponsesSince(ctx, dbgen.CountSurveyResponsesSinceParams{WorkspaceID: r.ws, SurveyID: sv.ID, StartedAt: since})
				if err != nil {
					return err
				}
				if int(n) >= daily {
					return ErrLimited("this survey has reached its limit for today; please try again tomorrow")
				}
				// Clearing browser storage makes a new browser id, so also bound new responses per address.
				if s.NewResponseThrottle != nil && !s.NewResponseThrottle(ctx, "survey-new:"+hexID(sv.ID), in.Addr) {
					return ErrLimited("answers from your connection have reached the limit for today; please try again tomorrow")
				}
			}
			p := dbgen.InsertSurveyResponseParams{WorkspaceID: r.ws, SurveyID: sv.ID}
			if r.invite != nil {
				p.InviteID = uuid.NullUUID{UUID: r.invite.ID, Valid: true}
				p.PersonID = uuid.NullUUID{UUID: r.invite.PersonID, Valid: true}
			} else {
				p.RespondentKey = pgtype.Text{String: in.RespondentKey, Valid: true}
			}
			if resp, err = q.InsertSurveyResponse(ctx, p); err != nil {
				return err
			}
		}
		keep := make([]uuid.UUID, 0, len(answers))
		hasText := false
		for _, a := range answers {
			keep = append(keep, a.q.ID)
			hasText = hasText || a.text.Valid
			if err := q.UpsertSurveyAnswer(ctx, dbgen.UpsertSurveyAnswerParams{WorkspaceID: r.ws, ResponseID: resp.ID, QuestionID: a.q.ID, ValueNum: a.num, ValueChoice: a.choice, ValueText: a.text}); err != nil {
				return err
			}
		}
		if err := q.DeleteSurveyAnswersExcept(ctx, dbgen.DeleteSurveyAnswersExceptParams{WorkspaceID: r.ws, ResponseID: resp.ID, Keep: keep}); err != nil {
			return err
		}
		if !in.Complete {
			return nil
		}
		if len(answers) == 0 {
			return ErrInvalid("answer at least one question")
		}
		if n, err := q.CompleteSurveyResponse(ctx, dbgen.CompleteSurveyResponseParams{WorkspaceID: r.ws, ID: resp.ID}); err != nil {
			return err
		} else if n == 0 {
			return nil
		}
		res.Complete = true
		if hasText && s.Jobs != nil {
			// In the same commit as the response: either both exist or neither does.
			if _, err := s.Jobs.InsertTx(ctx, tx, EvidenceArgs{WorkspaceID: r.ws, ResponseID: resp.ID}, nil); err != nil {
				return fmt.Errorf("enqueue evidence: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return SubmitResult{}, err
	}
	return res, nil
}

// holds says whether an earlier answer satisfies a question's condition.
func holds(c *ShowIf, a clean) bool {
	switch {
	case a.num.Valid && c.Number != nil:
		n, w := int(a.num.Int32), *c.Number
		switch c.Op {
		case "eq":
			return n == w
		case "ne":
			return n != w
		case "lte":
			return n <= w
		case "gte":
			return n >= w
		}
	case a.choice.Valid && c.Choice != nil:
		switch c.Op {
		case "eq":
			return a.choice.String == *c.Choice
		case "ne":
			return a.choice.String != *c.Choice
		}
	}
	return false
}
