package api

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// RenameRequest changes a request's title. Editors may do this; viewers may not.
func (s *Server) RenameRequest(ctx context.Context, req RenameRequestRequestObject) (RenameRequestResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if !t.CanWrite() {
		return nil, store.ErrForbidden
	}
	if req.Body == nil {
		return nil, badRequest("A title is required.")
	}
	title := strings.Join(strings.Fields(req.Body.Title), " ")
	if title == "" || utf8.RuneCountInString(title) > 200 {
		return nil, badRequest("A request title must be 1 to 200 characters.")
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateRequestTitle(ctx, dbgen.UpdateRequestTitleParams{
			WorkspaceID: t.WorkspaceID,
			ID:          req.RequestId,
			Title:       title,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return RenameRequest204Response{}, nil
}

// DeleteRequest removes a request and, by cascade, its evidence, brief, votes,
// impact, tags, issue link and outreach ties. The source conversations stay.
// Deleting is a manage action, so admins only.
func (s *Server) DeleteRequest(ctx context.Context, req DeleteRequestRequestObject) (DeleteRequestResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if !t.Can(store.PermManage) {
		return nil, store.ErrForbidden
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.DeleteRequest(ctx, dbgen.DeleteRequestParams{
			WorkspaceID: t.WorkspaceID,
			ID:          req.RequestId,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return DeleteRequest204Response{}, nil
}

// ReorderRoadmap saves the manual order of one board column. Positions are just
// the array index, so the order is exactly what the caller sent.
func (s *Server) ReorderRoadmap(ctx context.Context, req ReorderRoadmapRequestObject) (ReorderRoadmapResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if !t.CanWrite() {
		return nil, store.ErrForbidden
	}
	if req.Body == nil || len(req.Body.Ids) == 0 {
		return ReorderRoadmap204Response{}, nil
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		for i, id := range req.Body.Ids {
			n, err := q.UpdateRequestRoadmapPosition(ctx, dbgen.UpdateRequestRoadmapPositionParams{
				WorkspaceID:     t.WorkspaceID,
				ID:              id,
				RoadmapPosition: pgtype.Float8{Float64: float64(i), Valid: true},
			})
			if err != nil {
				return err
			}
			if n == 0 {
				return pgx.ErrNoRows
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return ReorderRoadmap204Response{}, nil
}
