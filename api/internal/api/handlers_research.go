package api

import (
	"context"

	"github.com/google/uuid"

	"product/api/internal/research"
	"product/api/internal/store"
)

func (s *Server) researchTenant(ctx context.Context, ws uuid.UUID) (store.Tenant, error) {
	if s.Research == nil || s.QA == nil {
		return store.Tenant{}, errNotConfigured
	}
	return s.tenant(ctx, ws)
}

// ---- codebook ----

func (s *Server) ListTags(ctx context.Context, req ListTagsRequestObject) (ListTagsResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Research.ListTags(ctx, t, req.Params.IncludeArchived != nil && *req.Params.IncludeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]Tag, 0, len(rows))
	for _, r := range rows {
		out = append(out, Tag{Id: r.ID, Name: r.Name, Definition: r.Definition, Color: r.Color, Origin: TagOrigin(r.Origin), Archived: r.Archived,
			MergedInto: r.MergedInto, UndoMergeId: r.UndoMergeID, HighlightCount: r.HighlightCount, RequestCount: r.RequestCount})
	}
	return ListTags200JSONResponse{Tags: out}, nil
}

func tagInput(b *TagInput) research.TagInput {
	in := research.TagInput{Name: b.Name}
	if b.Definition != nil {
		in.Definition = *b.Definition
	}
	if b.Color != nil {
		in.Color = string(*b.Color)
	}
	return in
}

func (s *Server) CreateTag(ctx context.Context, req CreateTagRequestObject) (CreateTagResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	id, err := s.Research.CreateTag(ctx, t, tagInput(req.Body))
	if err != nil {
		return nil, err
	}
	return CreateTag201JSONResponse{Id: id}, nil
}

func (s *Server) UpdateTag(ctx context.Context, req UpdateTagRequestObject) (UpdateTagResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	if err := s.Research.UpdateTag(ctx, t, req.TagId, tagInput(req.Body)); err != nil {
		return nil, err
	}
	return UpdateTag204Response{}, nil
}

func (s *Server) ArchiveTag(ctx context.Context, req ArchiveTagRequestObject) (ArchiveTagResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Research.ArchiveTag(ctx, t, req.TagId); err != nil {
		return nil, err
	}
	return ArchiveTag204Response{}, nil
}

func (s *Server) RestoreTag(ctx context.Context, req RestoreTagRequestObject) (RestoreTagResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Research.RestoreTag(ctx, t, req.TagId); err != nil {
		return nil, err
	}
	return RestoreTag204Response{}, nil
}

func (s *Server) MergeTag(ctx context.Context, req MergeTagRequestObject) (MergeTagResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Choose the tag to merge into.")
	}
	r, err := s.Research.MergeTags(ctx, t, req.TagId, req.Body.IntoTagId)
	if err != nil {
		return nil, err
	}
	return MergeTag200JSONResponse{MergeId: r.MergeID, Highlights: r.Highlights, Requests: r.Requests}, nil
}

func (s *Server) UndoTagMerge(ctx context.Context, req UndoTagMergeRequestObject) (UndoTagMergeResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Research.UndoMerge(ctx, t, req.MergeId); err != nil {
		return nil, err
	}
	return UndoTagMerge204Response{}, nil
}

func (s *Server) SetRequestTags(ctx context.Context, req SetRequestTagsRequestObject) (SetRequestTagsResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A list of tags is required.")
	}
	if err := s.Research.SetRequestTags(ctx, t, req.RequestId, req.Body.TagIds); err != nil {
		return nil, err
	}
	return SetRequestTags204Response{}, nil
}

// ---- highlights ----

func highlightOut(h research.Highlight) Highlight {
	tags := make([]TagRef, 0, len(h.Tags))
	for _, t := range h.Tags {
		tags = append(tags, TagRef{Id: t.ID, Name: t.Name, Color: t.Color})
	}
	return Highlight{Id: h.ID, SourceItemId: h.SourceItemID, SourceTitle: h.SourceTitle, SpanStart: h.SpanStart, SpanEnd: h.SpanEnd,
		Quote: h.Quote, Note: h.Note, Tags: tags, CreatedAt: h.CreatedAt}
}

func (s *Server) ListHighlights(ctx context.Context, req ListHighlightsRequestObject) (ListHighlightsResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	limit := 50
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	f := research.ListFilter{TagID: req.Params.TagId, SourceItemID: req.Params.SourceItemId, Limit: limit + 1}
	if req.Params.Cursor != nil && *req.Params.Cursor != "" {
		at, id, cerr := decodeCursor(*req.Params.Cursor)
		if cerr != nil {
			return nil, badRequest("The page cursor is not valid.")
		}
		f.AfterCreated, f.AfterID = &at, &id
	}
	rows, err := s.Research.ListHighlights(ctx, t, f)
	if err != nil {
		return nil, err
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		c := encodeCursor(rows[len(rows)-1].CreatedAt, rows[len(rows)-1].ID)
		next = &c
	}
	out := make([]Highlight, 0, len(rows))
	for _, r := range rows {
		out = append(out, highlightOut(r))
	}
	return ListHighlights200JSONResponse{Highlights: out, NextCursor: next}, nil
}

func (s *Server) CreateHighlight(ctx context.Context, req CreateHighlightRequestObject) (CreateHighlightResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A passage is required.")
	}
	in := research.HighlightInput{SourceItemID: req.Body.SourceItemId, SpanStart: req.Body.SpanStart, SpanEnd: req.Body.SpanEnd, Quote: req.Body.Quote}
	if req.Body.Note != nil {
		in.Note = *req.Body.Note
	}
	if req.Body.TagIds != nil {
		in.TagIDs = *req.Body.TagIds
	}
	h, err := s.Research.CreateHighlight(ctx, t, in)
	if err != nil {
		return nil, err
	}
	return CreateHighlight201JSONResponse(highlightOut(h)), nil
}

func (s *Server) DeleteHighlight(ctx context.Context, req DeleteHighlightRequestObject) (DeleteHighlightResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Research.DeleteHighlight(ctx, t, req.HighlightId); err != nil {
		return nil, err
	}
	return DeleteHighlight204Response{}, nil
}

func (s *Server) SetHighlightTags(ctx context.Context, req SetHighlightTagsRequestObject) (SetHighlightTagsResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A list of tags is required.")
	}
	if err := s.Research.SetHighlightTags(ctx, t, req.HighlightId, req.Body.TagIds); err != nil {
		return nil, err
	}
	return SetHighlightTags204Response{}, nil
}

// ---- questions ----

func answerOut(a research.Answer) Answer {
	cs := make([]Citation, 0, len(a.Citations))
	for _, c := range a.Citations {
		cs = append(cs, Citation{Number: c.Number, Kind: CitationKind(c.Kind), Id: c.ID, SourceItemId: c.SourceItemID, SpanStart: c.SpanStart, SpanEnd: c.SpanEnd, Quote: c.Quote})
	}
	out := Answer{Id: a.ID, Question: a.Question, Outcome: AnswerOutcome(a.Outcome), Text: a.Text, Reason: a.Reason, Citations: cs, CreatedAt: a.CreatedAt}
	if a.Rating != "" {
		r := AnswerRating(a.Rating)
		out.Rating = &r
	}
	return out
}

func (s *Server) AskQuestion(ctx context.Context, req AskQuestionRequestObject) (AskQuestionResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A question is required.")
	}
	a, err := s.QA.Ask(ctx, t, req.Body.Question)
	if err != nil {
		return nil, err
	}
	return AskQuestion200JSONResponse(answerOut(a)), nil
}

func (s *Server) ListAnswers(ctx context.Context, req ListAnswersRequestObject) (ListAnswersResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.QA.History(ctx, t, 20)
	if err != nil {
		return nil, err
	}
	out := make([]Answer, 0, len(rows))
	for _, r := range rows {
		out = append(out, answerOut(r))
	}
	return ListAnswers200JSONResponse{Answers: out}, nil
}

func (s *Server) GetAnswer(ctx context.Context, req GetAnswerRequestObject) (GetAnswerResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	a, err := s.QA.Get(ctx, t, req.AnswerId)
	if err != nil {
		return nil, err
	}
	return GetAnswer200JSONResponse(answerOut(a)), nil
}

func (s *Server) RateAnswer(ctx context.Context, req RateAnswerRequestObject) (RateAnswerResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A rating is required.")
	}
	if err := s.QA.Rate(ctx, t, req.AnswerId, string(req.Body.Rating)); err != nil {
		return nil, err
	}
	return RateAnswer204Response{}, nil
}
