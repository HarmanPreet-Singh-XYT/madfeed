package api

import (
	"context"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"product/api/internal/billing"
	"product/api/internal/integrations"
	"product/api/internal/store"
)

func (s *Server) ListTrackers(ctx context.Context, req ListTrackersRequestObject) (ListTrackersResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if !t.Can(store.PermManage) {
		return nil, errForbidden
	}
	out := []map[string]any{}
	for _, e := range s.Integrations.TrackerCatalog() {
		fields := []map[string]any{}
		for _, f := range e.Fields {
			fields = append(fields, map[string]any{"name": f.Name, "label": f.Label, "help": f.Help, "secret": f.Secret, "optional": f.Optional})
		}
		out = append(out, map[string]any{"kind": e.Kind, "name": e.Name, "intro": e.Intro, "fields": fields})
	}
	return shape[ListTrackers200JSONResponse](map[string]any{"trackers": out}), nil
}

func (s *Server) GetTrackerIntegration(ctx context.Context, req GetTrackerIntegrationRequestObject) (GetTrackerIntegrationResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	in, err := s.Integrations.TrackerInfo(ctx, t, string(req.TrackerKind))
	if err != nil {
		return nil, err
	}
	return GetTrackerIntegration200JSONResponse{Summary: in.Summary, Detail: in.Detail, State: GetTrackerIntegration200JSONResponseBodyState(in.State), WebhookUrl: in.WebhookURL, CloseStatusId: in.CloseStatusID, ReopenStatusId: in.ReopenStatusID}, nil
}

func (s *Server) ConnectTracker(ctx context.Context, req ConnectTrackerRequestObject) (ConnectTrackerResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureIntegrations); err != nil {
		return nil, err
	}
	f := map[string]string{}
	for k, v := range map[string]*string{
		"listId": req.Body.Fields.ListId, "projectId": req.Body.Fields.ProjectId, "teamId": req.Body.Fields.TeamId,
		"organization": req.Body.Fields.Organization, "project": req.Body.Fields.Project, "workItemType": req.Body.Fields.WorkItemType,
		"doneStates": req.Body.Fields.DoneStates, "token": req.Body.Fields.Token,
	} {
		if v != nil {
			f[k] = *v
		}
	}
	setup, err := s.Integrations.TrackerConnect(ctx, t, string(req.TrackerKind), f, req.Body.CloseStatusId, req.Body.ReopenStatusId)
	if err != nil {
		return nil, err
	}
	show := []map[string]any{}
	for _, v := range setup.Show {
		show = append(show, map[string]any{"label": v.Label, "value": v.Value, "secret": v.Secret})
	}
	return shape[ConnectTracker200JSONResponse](map[string]any{"webhookUrl": setup.WebhookURL, "note": setup.Note, "show": show}), nil
}

func (s *Server) SetTrackerMapping(ctx context.Context, req SetTrackerMappingRequestObject) (SetTrackerMappingResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.TrackerSetMapping(ctx, t, string(req.TrackerKind), req.Body.CloseStatusId, req.Body.ReopenStatusId); err != nil {
		return nil, err
	}
	return SetTrackerMapping204Response{}, nil
}

func (s *Server) CheckTracker(ctx context.Context, req CheckTrackerRequestObject) (CheckTrackerResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.TrackerCheck(ctx, t, string(req.TrackerKind)); err != nil {
		return nil, err
	}
	return CheckTracker204Response{}, nil
}

// trackerEvents receives notifications from the driver-based trackers for one workspace, outside the sign-in
// layer (they have no account here). Each driver checks its own signature or secret.
func (s *Server) trackerEvents() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := uuid.Parse(chi.URLParam(r, "workspaceId"))
		kind := chi.URLParam(r, "kind")
		if r.Method != http.MethodPost || s.Integrations == nil || err != nil || !s.Integrations.On(kind) {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20+1))
		if err != nil {
			writeError(w, r, &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "That is larger than allowed."})
			return
		}
		reply, err := s.Integrations.TrackerEvent(r.Context(), ws, kind, integrations.EventRequest{Body: body, Header: r.Header})
		switch {
		case err == nil:
		case isErr(err, integrations.ErrBadSignature):
			writeError(w, r, errUnauthorized)
			return
		case isErr(err, integrations.ErrNotFound):
			http.NotFound(w, r)
			return
		default:
			if _, ok := err.(integrations.ErrInvalid); ok {
				writeError(w, r, badRequest("Not a valid event."))
				return
			}
			writeError(w, r, err)
			return
		}
		for k, v := range reply {
			w.Header().Set(k, v)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
}
