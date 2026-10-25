package api

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ListNotices shows admins what needs their attention. Everyone else gets an
// empty list: a notice about spend or limits is the owner's business.
func (s *Server) ListNotices(ctx context.Context, req ListNoticesRequestObject) (ListNoticesResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	type notice = struct {
		CreatedAt time.Time                                 `json:"createdAt"`
		Id        openapi_types.UUID                        `json:"id"`
		Kind      ListNotices200JSONResponseBodyNoticesKind `json:"kind"`
		Message   string                                    `json:"message"`
	}
	out := ListNotices200JSONResponse{}
	out.Notices = make([]notice, 0)
	if !t.Can(store.PermManage) || s.Pool == nil {
		return out, nil
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListRecentNotices(ctx, t.WorkspaceID)
		for _, r := range rows {
			out.Notices = append(out.Notices, notice{CreatedAt: r.CreatedAt, Id: r.ID, Kind: ListNotices200JSONResponseBodyNoticesKind(r.Kind), Message: r.Message})
		}
		return err
	})
	return out, err
}
