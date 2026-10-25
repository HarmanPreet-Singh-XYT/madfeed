package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"product/api/internal/modules"
)

// GetAccess tells the web app what to show: the caller's permissions and the tools the plan switches on. It
// shapes the navigation only; every route still checks permission and plan itself.
func (s *Server) GetAccess(ctx context.Context, req GetAccessRequestObject) (GetAccessResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	mods := modules.Set(nil).Strings() // every tool, until a payment provider says otherwise
	if s.Billing != nil {
		if mods, err = s.Billing.Modules(ctx, t.WorkspaceID); err != nil {
			return nil, err
		}
	}
	out := GetAccess200JSONResponse{
		Role:        GetAccess200JSONResponseBodyRole(t.Role),
		Permissions: []GetAccess200JSONResponseBodyPermissions{},
		Modules:     make([]GetAccess200JSONResponseBodyModules, 0, len(mods)),
	}
	for _, p := range t.Permissions() {
		out.Permissions = append(out.Permissions, GetAccess200JSONResponseBodyPermissions(p))
	}
	for _, m := range mods {
		out.Modules = append(out.Modules, GetAccess200JSONResponseBodyModules(m))
	}
	return out, nil
}

// moduleGate refuses a request to a tool the workspace's plan does not switch on. It runs after the route is
// matched and only for paths a tool owns (modules.PathPrefix); everything else belongs to the core.
// Membership is checked first, so a stranger still gets "not found" and learns nothing about the plan.
func (s *Server) moduleGate() StrictMiddlewareFunc {
	return func(next StrictHandlerFunc, _ string) StrictHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
			if s.Billing == nil {
				return next(ctx, w, r, request)
			}
			ws, tool, ok := toolOfPath(r.URL.Path)
			if !ok {
				return next(ctx, w, r, request)
			}
			if _, err := s.tenant(ctx, ws); err != nil {
				return nil, err
			}
			if err := s.Billing.CheckModule(ctx, ws, tool); err != nil {
				return nil, err
			}
			return next(ctx, w, r, request)
		}
	}
}

// toolOfPath reads /v1/workspaces/{id}/{segment}/... and returns the workspace and the tool that owns the segment.
func toolOfPath(path string) (uuid.UUID, modules.ID, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 4 || parts[0] != "v1" || parts[1] != "workspaces" {
		return uuid.Nil, "", false
	}
	tool, ok := modules.OwnerOf(parts[3])
	if !ok {
		return uuid.Nil, "", false
	}
	ws, err := uuid.Parse(parts[2])
	if err != nil {
		return uuid.Nil, "", false
	}
	return ws, tool, true
}
