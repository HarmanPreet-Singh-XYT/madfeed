package api

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"product/api/internal/billing"
	"product/api/internal/survey"
)

func (s *Server) surveysReady() error {
	if s.Surveys == nil {
		return errNotConfigured
	}
	return nil
}

func audienceBytes(r *AudienceRule) ([]byte, error) {
	if r == nil {
		return nil, nil
	}
	return json.Marshal(r)
}

func surveyBasics(b SurveyBasics) survey.Basics {
	out := survey.Basics{Title: b.Title}
	if b.Intro != nil {
		out.Intro = *b.Intro
	}
	if b.ThankYou != nil {
		out.ThankYou = *b.ThankYou
	}
	if b.Delivery != nil {
		out.Delivery = string(*b.Delivery)
	}
	if b.OnPersonDelete != nil {
		out.OnPersonDelete = string(*b.OnPersonDelete)
	}
	return out
}

func (s *Server) ListSurveys(ctx context.Context, req ListSurveysRequestObject) (ListSurveysResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Surveys.List(ctx, t, 100)
	if err != nil {
		return nil, err
	}
	out := ListSurveys200JSONResponse{Surveys: make([]SurveyRow, 0, len(rows))}
	for _, r := range rows {
		out.Surveys = append(out.Surveys, SurveyRow{Id: r.ID, Title: r.Title, State: SurveyRowState(r.State), Delivery: SurveyRowDelivery(r.Delivery), CreatedAt: r.CreatedAt, InvitesSent: r.InvitesSent, Responses: r.Responses})
	}
	return out, nil
}

func (s *Server) CreateSurvey(ctx context.Context, req CreateSurveyRequestObject) (CreateSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureSurveys); err != nil {
		return nil, err
	}
	id, err := s.Surveys.Create(ctx, t, surveyBasics(*req.Body))
	if err != nil {
		return nil, err
	}
	return CreateSurvey201JSONResponse{Id: id}, nil
}

func (s *Server) GetSurvey(ctx context.Context, req GetSurveyRequestObject) (GetSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	sv, err := s.Surveys.Get(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	out := GetSurvey200JSONResponse{
		Id: sv.ID, Title: sv.Title, Intro: sv.Intro, ThankYou: sv.ThankYou, State: SurveyState(sv.State), Delivery: SurveyDelivery(sv.Delivery),
		OnPersonDelete: SurveyOnPersonDelete(sv.OnPersonDelete), CreatedAt: sv.CreatedAt, OpenedAt: sv.OpenedAt, ClosedAt: sv.ClosedAt,
		Questions: surveyQuestions(sv.Questions), InvitesByState: sv.InvitesByState, Responses: sv.Responses, Partial: sv.Partial,
	}
	if sv.PublicLink != "" {
		out.PublicLink = &sv.PublicLink
	}
	if len(sv.Audience) > 0 {
		var r AudienceRule
		if json.Unmarshal(sv.Audience, &r) == nil {
			out.Audience = &r
		}
	}
	return out, nil
}

func surveyQuestions(qs []survey.Question) []SurveyQuestion {
	out := make([]SurveyQuestion, 0, len(qs))
	for _, q := range qs {
		opts := q.Options
		if opts == nil {
			opts = []string{}
		}
		sq := SurveyQuestion{Id: q.ID, Kind: SurveyQuestionKind(q.Kind), Prompt: q.Prompt, Required: q.Required, Options: opts}
		if c := q.ShowIf; c != nil {
			sq.ShowIf = &struct {
				Choice     *string                `json:"choice,omitempty"`
				Number     *int                   `json:"number,omitempty"`
				Op         SurveyQuestionShowIfOp `json:"op"`
				QuestionId uuid.UUID              `json:"questionId"`
			}{c.Choice, c.Number, SurveyQuestionShowIfOp(c.Op), c.QuestionID}
		}
		out = append(out, sq)
	}
	return out
}

func (s *Server) UpdateSurvey(ctx context.Context, req UpdateSurveyRequestObject) (UpdateSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Surveys.Update(ctx, t, req.SurveyId, surveyBasics(*req.Body)); err != nil {
		return nil, err
	}
	return UpdateSurvey204Response{}, nil
}

func (s *Server) DeleteSurvey(ctx context.Context, req DeleteSurveyRequestObject) (DeleteSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Surveys.Delete(ctx, t, req.SurveyId); err != nil {
		return nil, err
	}
	return DeleteSurvey204Response{}, nil
}

func (s *Server) SetSurveyQuestions(ctx context.Context, req SetSurveyQuestionsRequestObject) (SetSurveyQuestionsResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	in := make([]survey.QuestionInput, 0, len(req.Body.Questions))
	for _, q := range req.Body.Questions {
		qi := survey.QuestionInput{Kind: string(q.Kind), Prompt: q.Prompt}
		if q.Required != nil {
			qi.Required = *q.Required
		}
		if q.Options != nil {
			qi.Options = *q.Options
		}
		if c := q.ShowIf; c != nil {
			qi.ShowIf = &survey.ShowIf{Question: c.Question, Op: string(c.Op), Number: c.Number, Choice: c.Choice}
		}
		in = append(in, qi)
	}
	if err := s.Surveys.SetQuestions(ctx, t, req.SurveyId, in); err != nil {
		return nil, err
	}
	return SetSurveyQuestions204Response{}, nil
}

func (s *Server) SetSurveyAudience(ctx context.Context, req SetSurveyAudienceRequestObject) (SetSurveyAudienceResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	raw, err := audienceBytes(&req.Body.Audience)
	if err != nil {
		return nil, err
	}
	if err := s.Surveys.SetAudience(ctx, t, req.SurveyId, raw); err != nil {
		return nil, err
	}
	return SetSurveyAudience204Response{}, nil
}

func (s *Server) PreviewSurveyAudience(ctx context.Context, req PreviewSurveyAudienceRequestObject) (PreviewSurveyAudienceResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	raw, err := audienceBytes(req.Body.Audience)
	if err != nil {
		return nil, err
	}
	p, err := s.Surveys.PreviewAudience(ctx, t, req.SurveyId, raw)
	if err != nil {
		return nil, err
	}
	out := PreviewSurveyAudience200JSONResponse{Total: p.Total, WithEmail: p.WithEmail, AlreadyInvited: p.AlreadyInvited}
	for _, m := range p.Sample {
		out.Sample = append(out.Sample, struct {
			Email string    `json:"email"`
			Id    uuid.UUID `json:"id"`
			Name  string    `json:"name"`
		}{m.Email, m.ID, m.Name})
	}
	return out, nil
}

func (s *Server) OpenSurvey(ctx context.Context, req OpenSurveyRequestObject) (OpenSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureSurveys); err != nil {
		return nil, err
	}
	if err := s.Surveys.Open(ctx, t, req.SurveyId); err != nil {
		return nil, err
	}
	return OpenSurvey204Response{}, nil
}

func (s *Server) CloseSurvey(ctx context.Context, req CloseSurveyRequestObject) (CloseSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Surveys.Close(ctx, t, req.SurveyId); err != nil {
		return nil, err
	}
	return CloseSurvey204Response{}, nil
}

func (s *Server) ResetSurveyLink(ctx context.Context, req ResetSurveyLinkRequestObject) (ResetSurveyLinkResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	link, err := s.Surveys.ResetLink(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	return ResetSurveyLink200JSONResponse{Link: link}, nil
}

func (s *Server) ListSurveyInvites(ctx context.Context, req ListSurveyInvitesRequestObject) (ListSurveyInvitesResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	list, err := s.Surveys.ListInvites(ctx, t, req.SurveyId, 1000)
	if err != nil {
		return nil, err
	}
	rem, err := s.Surveys.Remindable(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	out := ListSurveyInvites200JSONResponse{Invites: make([]SurveyInvite, 0, len(list)), Remindable: rem}
	for _, i := range list {
		inv := SurveyInvite{Id: i.ID, PersonId: i.PersonID, PersonName: i.PersonName, Email: i.Email, State: SurveyInviteState(i.State), SentAt: i.SentAt, Answered: i.Answered}
		if i.Reminder != "" {
			r := SurveyInviteReminder(i.Reminder)
			inv.Reminder = &r
		}
		out.Invites = append(out.Invites, inv)
	}
	return out, nil
}

func (s *Server) CreateSurveyInvites(ctx context.Context, req CreateSurveyInvitesRequestObject) (CreateSurveyInvitesResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	without := req.Body != nil && req.Body.WithoutEmail != nil && *req.Body.WithoutEmail
	sum, err := s.Surveys.CreateInvites(ctx, t, req.SurveyId, without)
	if err != nil {
		return nil, err
	}
	return CreateSurveyInvites200JSONResponse{Added: sum.Added, AlreadyInvited: sum.AlreadyInvited, Suppressed: sum.Suppressed, Manual: sum.Manual}, nil
}

func (s *Server) PreviewSurveyInvite(ctx context.Context, req PreviewSurveyInviteRequestObject) (PreviewSurveyInviteResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	sv, err := s.Surveys.Get(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	ws, err := s.Release.GetSettings(ctx, t)
	if err != nil {
		return nil, err
	}
	sender := ws.SenderName
	if strings.TrimSpace(sender) == "" {
		sender = ws.Name
	}
	subject, body := survey.InviteMessage(sender, sv.Title, sv.Intro, "https://…/s/(a link only this person can use)")
	return PreviewSurveyInvite200JSONResponse{Subject: subject, Text: body + "\n--\nYou are receiving this because you are a customer of " + sender + ". To stop getting emails like this, unsubscribe: (a link in every email)", EmailConfigured: s.EmailConfigured}, nil
}

func (s *Server) ApproveSurveyInvites(ctx context.Context, req ApproveSurveyInvitesRequestObject) (ApproveSurveyInvitesResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureSurveys); err != nil {
		return nil, err
	}
	n, err := s.Surveys.Approve(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	return ApproveSurveyInvites200JSONResponse{Queued: n}, nil
}

func (s *Server) SetSurveyInviteExcluded(ctx context.Context, req SetSurveyInviteExcludedRequestObject) (SetSurveyInviteExcludedResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Surveys.SetInviteExcluded(ctx, t, req.InviteId, req.Body.Excluded); err != nil {
		return nil, err
	}
	return SetSurveyInviteExcluded204Response{}, nil
}

func (s *Server) GetSurveyResults(ctx context.Context, req GetSurveyResultsRequestObject) (GetSurveyResultsResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	r, err := s.Surveys.Results(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	out := GetSurveyResults200JSONResponse{Complete: r.Complete, Partial: r.Partial}
	out.Numeric = make([]struct {
		Answers    int                      `json:"answers"`
		Average    float32                  `json:"average"`
		Detractors int                      `json:"detractors"`
		Kind       SurveyResultsNumericKind `json:"kind"`
		Passives   int                      `json:"passives"`
		Promoters  int                      `json:"promoters"`
		QuestionId uuid.UUID                `json:"questionId"`
		Score      int                      `json:"score"`
	}, 0, len(r.Numeric))
	for _, n := range r.Numeric {
		out.Numeric = append(out.Numeric, struct {
			Answers    int                      `json:"answers"`
			Average    float32                  `json:"average"`
			Detractors int                      `json:"detractors"`
			Kind       SurveyResultsNumericKind `json:"kind"`
			Passives   int                      `json:"passives"`
			Promoters  int                      `json:"promoters"`
			QuestionId uuid.UUID                `json:"questionId"`
			Score      int                      `json:"score"`
		}{n.Answers, float32(n.Average), n.Detractors, SurveyResultsNumericKind(n.Kind), n.Passives, n.Promoters, n.QuestionID, n.Score})
	}
	for _, c := range r.Choices {
		out.Choices = append(out.Choices, struct {
			Choice     string    `json:"choice"`
			Count      int       `json:"count"`
			QuestionId uuid.UUID `json:"questionId"`
		}{c.Choice, c.Count, c.QuestionID})
	}
	for _, a := range r.Text {
		out.Text = append(out.Text, struct {
			At           *time.Time `json:"at,omitempty"`
			Person       string     `json:"person"`
			QuestionId   uuid.UUID  `json:"questionId"`
			SourceItemId *uuid.UUID `json:"sourceItemId,omitempty"`
			Text         string     `json:"text"`
		}{a.At, a.Person, a.QuestionID, a.SourceItemID, a.Text})
	}
	return out, nil
}

// ---- the parts people open from a link (no sign-in) ----

func (s *Server) GetPublicSurvey(ctx context.Context, req GetPublicSurveyRequestObject) (GetPublicSurveyResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	v, err := s.Surveys.View(ctx, req.Token)
	if err != nil {
		return nil, err
	}
	saved := v.Saved
	if req.Params.Respondent != nil && !v.Closed {
		if sv, done, serr := s.Surveys.Saved(ctx, req.Token, *req.Params.Respondent); serr == nil {
			saved, v.Answered = sv, v.Answered || done
		}
	}
	out := GetPublicSurvey200JSONResponse{
		WorkspaceName: v.WorkspaceName, Title: v.Title, Intro: v.Intro, ThankYou: v.ThankYou, Closed: v.Closed, Answered: v.Answered,
		Questions: surveyQuestions(v.Questions),
	}
	out.Saved = make([]struct {
		Choice     *string   `json:"choice,omitempty"`
		Number     *int      `json:"number,omitempty"`
		QuestionId uuid.UUID `json:"questionId"`
		Text       *string   `json:"text,omitempty"`
	}, 0, len(saved))
	for _, a := range saved {
		out.Saved = append(out.Saved, struct {
			Choice     *string   `json:"choice,omitempty"`
			Number     *int      `json:"number,omitempty"`
			QuestionId uuid.UUID `json:"questionId"`
			Text       *string   `json:"text,omitempty"`
		}{a.Choice, a.Number, a.QuestionID, a.Text})
	}
	return out, nil
}

func (s *Server) SubmitSurveyAnswers(ctx context.Context, req SubmitSurveyAnswersRequestObject) (SubmitSurveyAnswersResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	addr, _ := ctx.Value(addrKey{}).(string)
	in := survey.SubmitInput{Token: req.Token, Complete: req.Body.Complete, Addr: addr}
	if req.Body.Respondent != nil {
		in.RespondentKey = *req.Body.Respondent
	}
	if req.Body.Website != nil {
		in.Honeypot = *req.Body.Website
	}
	for _, a := range req.Body.Answers {
		in.Answers = append(in.Answers, survey.AnswerInput{QuestionID: a.QuestionId, Number: a.Number, Choice: a.Choice, Text: a.Text})
	}
	r, err := s.Surveys.Submit(ctx, in)
	if err != nil {
		return nil, err
	}
	return SubmitSurveyAnswers200JSONResponse{Complete: r.Complete, AlreadyAnswered: r.AlreadyAnswered, ThankYou: r.ThankYou}, nil
}

func (s *Server) RemindSurveyInvites(ctx context.Context, req RemindSurveyInvitesRequestObject) (RemindSurveyInvitesResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureSurveys); err != nil {
		return nil, err
	}
	n, err := s.Surveys.ApproveReminders(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	return RemindSurveyInvites200JSONResponse{Queued: n}, nil
}

func (s *Server) ListSurveyManualLinks(ctx context.Context, req ListSurveyManualLinksRequestObject) (ListSurveyManualLinksResponseObject, error) {
	if err := s.surveysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	links, err := s.Surveys.ManualLinks(ctx, t, req.SurveyId)
	if err != nil {
		return nil, err
	}
	out := ListSurveyManualLinks200JSONResponse{}
	out.Links = make([]struct {
		Link       string `json:"link"`
		PersonName string `json:"personName"`
	}, 0, len(links))
	for _, l := range links {
		out.Links = append(out.Links, struct {
			Link       string `json:"link"`
			PersonName string `json:"personName"`
		}{l.Link, l.PersonName})
	}
	return out, nil
}
