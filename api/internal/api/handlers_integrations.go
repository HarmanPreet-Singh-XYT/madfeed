package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"product/api/internal/billing"
	"product/api/internal/integrations"
)

func (s *Server) integrationsReady() error {
	if s.Integrations == nil {
		return errNotConfigured
	}
	return nil
}

func (s *Server) ListIntegrations(ctx context.Context, req ListIntegrationsRequestObject) (ListIntegrationsResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	list, err := s.Integrations.List(ctx, t)
	if err != nil {
		return nil, err
	}
	out := ListIntegrations200JSONResponse{SlackAvailable: s.Integrations.SlackEnabled(), GithubAvailable: s.Integrations.Available(), Integrations: make([]IntegrationStatus, 0, len(list))}
	for _, st := range list {
		out.Integrations = append(out.Integrations, IntegrationStatus{
			Kind: IntegrationStatusKind(st.Kind), State: IntegrationStatusState(st.State), Summary: st.Summary, Detail: st.Detail,
			LastOkAt: st.LastOK, LastError: st.LastError, ConnectedAt: st.ConnectedAt,
		})
	}
	return out, nil
}

func (s *Server) DisconnectIntegration(ctx context.Context, req DisconnectIntegrationRequestObject) (DisconnectIntegrationResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.Disconnect(ctx, t, string(req.Kind)); err != nil {
		return nil, err
	}
	return DisconnectIntegration204Response{}, nil
}

func (s *Server) StartSlackConnect(ctx context.Context, req StartSlackConnectRequestObject) (StartSlackConnectResponseObject, error) {
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
	u, err := s.Integrations.SlackConnectURL(ctx, t)
	if err != nil {
		return nil, err
	}
	return StartSlackConnect200JSONResponse{Url: u}, nil
}

func (s *Server) CompleteSlackConnect(ctx context.Context, req CompleteSlackConnectRequestObject) (CompleteSlackConnectResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	ws, err := s.Integrations.SlackStateWorkspace(req.Body.State)
	if err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, ws) // the signed-in person must be an admin of that workspace
	if err != nil {
		return nil, err
	}
	st, err := s.Integrations.SlackComplete(ctx, t, req.Body.Code, req.Body.State)
	if err != nil {
		return nil, err
	}
	return CompleteSlackConnect200JSONResponse{WorkspaceId: ws, Team: st.Summary}, nil
}

func (s *Server) ListSlackChannels(ctx context.Context, req ListSlackChannelsRequestObject) (ListSlackChannelsResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	cs, err := s.Integrations.SlackChannels(ctx, t)
	if err != nil {
		return nil, err
	}
	type ch = struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	}
	out := ListSlackChannels200JSONResponse{Channels: make([]ch, 0, len(cs))}
	for _, c := range cs {
		out.Channels = append(out.Channels, ch{Id: c.ID, Name: c.Name})
	}
	return out, nil
}

func (s *Server) SetSlackChannel(ctx context.Context, req SetSlackChannelRequestObject) (SetSlackChannelResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.SlackSetChannel(ctx, t, req.Body.ChannelId); err != nil {
		return nil, err
	}
	return SetSlackChannel204Response{}, nil
}

func (s *Server) CheckSlack(ctx context.Context, req CheckSlackRequestObject) (CheckSlackResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.SlackCheck(ctx, t); err != nil {
		return nil, err
	}
	return CheckSlack204Response{}, nil
}

// slackEvents receives Slack's event calls. It lives outside the sign-in layer on purpose (Slack has no
// account here) and checks the signature of every request on the exact bytes received.
func (s *Server) slackEvents() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.Integrations == nil || !s.Integrations.SlackEnabled() {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10+1))
		if err != nil {
			writeError(w, r, &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "That is larger than allowed."})
			return
		}
		challenge, err := s.Integrations.SlackEvent(r.Context(), body, r.Header.Get("X-Slack-Request-Timestamp"), r.Header.Get("X-Slack-Signature"))
		switch {
		case err == nil:
		case isErr(err, integrations.ErrBadSignature):
			writeError(w, r, errUnauthorized)
			return
		default:
			if _, ok := err.(integrations.ErrInvalid); ok {
				writeError(w, r, badRequest("Not a valid event."))
				return
			}
			writeError(w, r, err) // a real failure: a 500 makes Slack try again
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if challenge != "" {
			_ = json.NewEncoder(w).Encode(map[string]string{"challenge": challenge})
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
}

func isErr(err, target error) bool { return errors.Is(err, target) }

// ---- the issue tracker ----

func (s *Server) GetGithubIntegration(ctx context.Context, req GetGithubIntegrationRequestObject) (GetGithubIntegrationResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	in, err := s.Integrations.GitHubInfo(ctx, t)
	if err != nil {
		return nil, err
	}
	return GetGithubIntegration200JSONResponse{Repo: in.Repo, State: GetGithubIntegration200JSONResponseBodyState(in.State), WebhookUrl: in.WebhookURL, CloseStatusId: in.CloseStatusID, ReopenStatusId: in.ReopenStatusID}, nil
}

func (s *Server) ConnectGithub(ctx context.Context, req ConnectGithubRequestObject) (ConnectGithubResponseObject, error) {
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
	b := req.Body
	setup, err := s.Integrations.GitHubConnect(ctx, t, integrations.GitHubInput{
		Token: b.Token, Repo: b.Repo, AllowPublic: b.AllowPublicRepo != nil && *b.AllowPublicRepo, CloseStatusID: b.CloseStatusId, ReopenStatusID: b.ReopenStatusId,
	})
	if err != nil {
		return nil, err
	}
	return ConnectGithub200JSONResponse{WebhookUrl: setup.WebhookURL, WebhookSecret: setup.WebhookSecret}, nil
}

func (s *Server) SetGithubMapping(ctx context.Context, req SetGithubMappingRequestObject) (SetGithubMappingResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.GitHubSetMapping(ctx, t, req.Body.CloseStatusId, req.Body.ReopenStatusId); err != nil {
		return nil, err
	}
	return SetGithubMapping204Response{}, nil
}

func (s *Server) CheckGithub(ctx context.Context, req CheckGithubRequestObject) (CheckGithubResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.GitHubCheckAs(ctx, t); err != nil {
		return nil, err
	}
	return CheckGithub204Response{}, nil
}

func issueBody(l integrations.IssueLink) IssueLink {
	return IssueLink{Repo: l.Repo, Number: l.Number, Url: l.URL, State: IssueLinkState(l.State), Conflict: l.Conflict, UpdatedAt: l.UpdatedAt}
}

func (s *Server) GetRequestIssue(ctx context.Context, req GetRequestIssueRequestObject) (GetRequestIssueResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	l, err := s.Integrations.GetIssue(ctx, t, req.RequestId)
	if err != nil {
		return nil, err
	}
	return GetRequestIssue200JSONResponse(issueBody(l)), nil
}

func (s *Server) CreateRequestIssue(ctx context.Context, req CreateRequestIssueRequestObject) (CreateRequestIssueResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	l, err := s.Integrations.CreateIssue(ctx, t, req.RequestId)
	if err != nil {
		return nil, err
	}
	return CreateRequestIssue201JSONResponse(issueBody(l)), nil
}

func (s *Server) UnlinkRequestIssue(ctx context.Context, req UnlinkRequestIssueRequestObject) (UnlinkRequestIssueResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.Unlink(ctx, t, req.RequestId); err != nil {
		return nil, err
	}
	return UnlinkRequestIssue204Response{}, nil
}

func (s *Server) ResolveIssueConflict(ctx context.Context, req ResolveIssueConflictRequestObject) (ResolveIssueConflictResponseObject, error) {
	if err := s.integrationsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Integrations.ResolveConflict(ctx, t, req.RequestId, req.Body.Apply); err != nil {
		return nil, err
	}
	return ResolveIssueConflict204Response{}, nil
}

// githubEvents receives GitHub's notifications for one workspace, outside the sign-in layer (GitHub has
// no account here). The signature is checked with that workspace's own secret.
func (s *Server) githubEvents() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := uuid.Parse(chi.URLParam(r, "workspaceId"))
		if r.Method != http.MethodPost || s.Integrations == nil || err != nil {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20+1))
		if err != nil {
			writeError(w, r, &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "That is larger than allowed."})
			return
		}
		err = s.Integrations.GitHubEvent(r.Context(), ws, body, r.Header.Get("X-GitHub-Event"), r.Header.Get("X-GitHub-Delivery"), r.Header.Get("X-Hub-Signature-256"))
		switch {
		case err == nil:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		case isErr(err, integrations.ErrBadSignature):
			writeError(w, r, errUnauthorized)
		default:
			if _, ok := err.(integrations.ErrInvalid); ok {
				writeError(w, r, badRequest("Not a valid event."))
				return
			}
			writeError(w, r, err)
		}
	})
}
