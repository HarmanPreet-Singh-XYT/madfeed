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
