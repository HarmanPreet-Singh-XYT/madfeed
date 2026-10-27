package api

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// GetShell answers everything the workspace navigation draws in one request, so a page (and every refresh of
// it) costs one call and one transaction instead of five. It shapes the navigation only; every route still
// checks permission and plan itself.
func (s *Server) GetShell(ctx context.Context, req GetShellRequestObject) (GetShellResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	mods, err := s.modulesFor(ctx, t)
	if err != nil {
		return nil, err
	}
	out := GetShell200JSONResponse{
		Role:        GetShell200JSONResponseBodyRole(t.Role),
		Permissions: []GetShell200JSONResponseBodyPermissions{},
		Modules:     make([]GetShell200JSONResponseBodyModules, 0, len(mods)),
	}
	out.Notices = make([]struct {
		CreatedAt time.Time                              `json:"createdAt"`
		Id        openapi_types.UUID                     `json:"id"`
		Kind      GetShell200JSONResponseBodyNoticesKind `json:"kind"`
		Message   string                                 `json:"message"`
	}, 0)
	for _, p := range t.Permissions() {
		out.Permissions = append(out.Permissions, GetShell200JSONResponseBodyPermissions(p))
	}
	for _, m := range mods {
		out.Modules = append(out.Modules, GetShell200JSONResponseBodyModules(m))
	}
	out.Workspace.Id = t.WorkspaceID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		if out.Workspace.Name, err = q.GetWorkspaceName(ctx, t.WorkspaceID); err != nil {
			return err
		}
		if out.WaitingProposals, err = countInt(q.CountWaitingProposals(ctx, t.WorkspaceID)); err != nil {
			return err
		}
		if out.OpenOutreach, err = countInt(q.CountOutreachNeedingYou(ctx, t.WorkspaceID)); err != nil {
			return err
		}
		if !t.Can(store.PermManage) { // a notice about spend or limits is the owner's business
			return nil
		}
		rows, err := q.ListRecentNotices(ctx, t.WorkspaceID)
		for _, r := range rows {
			out.Notices = append(out.Notices, struct {
				CreatedAt time.Time                              `json:"createdAt"`
				Id        openapi_types.UUID                     `json:"id"`
				Kind      GetShell200JSONResponseBodyNoticesKind `json:"kind"`
				Message   string                                 `json:"message"`
			}{CreatedAt: r.CreatedAt, Id: r.ID, Kind: GetShell200JSONResponseBodyNoticesKind(r.Kind), Message: r.Message})
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func countInt(n int32, err error) (int, error) { return int(n), err }
