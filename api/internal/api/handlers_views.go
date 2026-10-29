package api

import (
	"context"

	"github.com/google/uuid"

	"product/api/internal/store"
	"product/api/internal/views"
)

func (s *Server) viewsTenant(ctx context.Context, ws uuid.UUID) (store.Tenant, error) {
	if s.Views == nil {
		return store.Tenant{}, errNotConfigured
	}
	return s.tenant(ctx, ws)
}

func (s *Server) ListViews(ctx context.Context, req ListViewsRequestObject) (ListViewsResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Views.List(ctx, t)
	if err != nil {
		return nil, err
	}
	out := make([]SavedView, 0, len(rows))
	for _, v := range rows {
		out = append(out, SavedView{Id: v.ID, Name: v.Name, StatusId: v.StatusID, TagId: v.TagID, Q: v.Search, Sort: SavedViewSort(v.Sort),
			Mine: v.CreatedBy == t.UserID, CreatedAt: v.CreatedAt})
	}
	return ListViews200JSONResponse{Views: out}, nil
}

func (s *Server) CreateView(ctx context.Context, req CreateViewRequestObject) (CreateViewResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	in := views.Input{Name: req.Body.Name, StatusID: req.Body.StatusId, TagID: req.Body.TagId}
	if req.Body.Q != nil {
		in.Search = *req.Body.Q
	}
	if req.Body.Sort != nil {
		in.Sort = string(*req.Body.Sort)
	}
	v, err := s.Views.Create(ctx, t, in)
	if err != nil {
		return nil, err
	}
	return CreateView201JSONResponse(SavedView{Id: v.ID, Name: v.Name, StatusId: v.StatusID, TagId: v.TagID, Q: v.Search, Sort: SavedViewSort(v.Sort), Mine: true, CreatedAt: v.CreatedAt}), nil
}

func (s *Server) UpdateView(ctx context.Context, req UpdateViewRequestObject) (UpdateViewResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	in := views.Input{Name: req.Body.Name, StatusID: req.Body.StatusId, TagID: req.Body.TagId}
	if req.Body.Q != nil {
		in.Search = *req.Body.Q
	}
	if req.Body.Sort != nil {
		in.Sort = string(*req.Body.Sort)
	}
	v, err := s.Views.Update(ctx, t, req.ViewId, in)
	if err != nil {
		return nil, err
	}
	return UpdateView200JSONResponse(SavedView{Id: v.ID, Name: v.Name, StatusId: v.StatusID, TagId: v.TagID, Q: v.Search, Sort: SavedViewSort(v.Sort), Mine: v.CreatedBy == t.UserID, CreatedAt: v.CreatedAt}), nil
}

func (s *Server) DeleteView(ctx context.Context, req DeleteViewRequestObject) (DeleteViewResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Views.Delete(ctx, t, req.ViewId); err != nil {
		return nil, err
	}
	return DeleteView204Response{}, nil
}

func quoteView(v views.QuoteView, mine bool) QuoteView {
	out := QuoteView{Id: v.ID, Name: v.Name, Sort: QuoteViewSort(v.Sort), Mine: mine, CreatedAt: v.CreatedAt, TagId: v.TagID}
	if v.Kind != "" {
		k := QuoteViewKind(v.Kind)
		out.Kind = &k
	}
	if v.Sentiment != "" {
		s := QuoteViewSentiment(v.Sentiment)
		out.Sentiment = &s
	}
	if v.SourceKind != "" {
		s := QuoteViewSourceKind(v.SourceKind)
		out.SourceKind = &s
	}
	if v.Search != "" {
		out.Q = &v.Search
	}
	if v.Meaning != "" {
		out.Meaning = &v.Meaning
	}
	if v.Days != 0 {
		d := QuoteViewDays(v.Days)
		out.Days = &d
	}
	out.PersonId = v.PersonID
	out.AccountId = v.AccountID
	return out
}

func (s *Server) ListQuoteViews(ctx context.Context, req ListQuoteViewsRequestObject) (ListQuoteViewsResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Views.ListQuotes(ctx, t)
	if err != nil {
		return nil, err
	}
	out := make([]QuoteView, 0, len(rows))
	for _, v := range rows {
		out = append(out, quoteView(v, v.CreatedBy == t.UserID))
	}
	return ListQuoteViews200JSONResponse{Views: out}, nil
}

func (s *Server) CreateQuoteView(ctx context.Context, req CreateQuoteViewRequestObject) (CreateQuoteViewResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	in := views.QuoteInput{Name: req.Body.Name, TagID: req.Body.TagId}
	if req.Body.Kind != nil {
		in.Kind = string(*req.Body.Kind)
	}
	if req.Body.Sentiment != nil {
		in.Sentiment = string(*req.Body.Sentiment)
	}
	if req.Body.SourceKind != nil {
		in.SourceKind = string(*req.Body.SourceKind)
	}
	if req.Body.Q != nil {
		in.Search = *req.Body.Q
	}
	if req.Body.Meaning != nil {
		in.Meaning = *req.Body.Meaning
	}
	if req.Body.Sort != nil {
		in.Sort = string(*req.Body.Sort)
	}
	if req.Body.Days != nil {
		in.Days = int(*req.Body.Days)
	}
	in.PersonID = req.Body.PersonId
	in.AccountID = req.Body.AccountId
	v, err := s.Views.CreateQuote(ctx, t, in)
	if err != nil {
		return nil, err
	}
	return CreateQuoteView201JSONResponse(quoteView(v, true)), nil
}

func (s *Server) RenameQuoteView(ctx context.Context, req RenameQuoteViewRequestObject) (RenameQuoteViewResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	v, err := s.Views.RenameQuote(ctx, t, req.ViewId, req.Body.Name)
	if err != nil {
		return nil, err
	}
	return RenameQuoteView200JSONResponse(quoteView(v, true)), nil
}

func (s *Server) DeleteQuoteView(ctx context.Context, req DeleteQuoteViewRequestObject) (DeleteQuoteViewResponseObject, error) {
	t, err := s.viewsTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Views.DeleteQuote(ctx, t, req.ViewId); err != nil {
		return nil, err
	}
	return DeleteQuoteView204Response{}, nil
}
