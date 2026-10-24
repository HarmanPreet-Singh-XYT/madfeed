package api

import (
	"context"

	"product/api/internal/hooks"
)

func (s *Server) hooksReady() error {
	if s.Hooks == nil {
		return errNotConfigured
	}
	return nil
}

func hookEndpoint(e hooks.Endpoint) WebhookEndpoint {
	return WebhookEndpoint{
		Id: e.ID, Url: e.URL, Description: e.Description, Events: e.Events, Enabled: e.Enabled,
		PausedReason: e.PausedReason, ConsecutiveFailures: e.ConsecutiveFailures, CreatedAt: e.CreatedAt,
	}
}

func (s *Server) ListWebhooks(ctx context.Context, req ListWebhooksRequestObject) (ListWebhooksResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	list, err := s.Hooks.List(ctx, t)
	if err != nil {
		return nil, err
	}
	out := ListWebhooks200JSONResponse{Available: s.Hooks.Available(), Events: hooks.Events, Endpoints: make([]WebhookEndpoint, 0, len(list))}
	for _, e := range list {
		out.Endpoints = append(out.Endpoints, hookEndpoint(e))
	}
	return out, nil
}

func (s *Server) CreateWebhook(ctx context.Context, req CreateWebhookRequestObject) (CreateWebhookResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	desc := ""
	if req.Body.Description != nil {
		desc = *req.Body.Description
	}
	e, secret, err := s.Hooks.Create(ctx, t, hooks.Input{URL: req.Body.Url, Description: desc, Events: req.Body.Events})
	if err != nil {
		return nil, err
	}
	return CreateWebhook201JSONResponse{Endpoint: hookEndpoint(e), Secret: secret}, nil
}

func (s *Server) UpdateWebhook(ctx context.Context, req UpdateWebhookRequestObject) (UpdateWebhookResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	desc := ""
	if req.Body.Description != nil {
		desc = *req.Body.Description
	}
	if err := s.Hooks.Update(ctx, t, req.WebhookId, hooks.Input{URL: req.Body.Url, Description: desc, Events: req.Body.Events}, req.Body.Enabled); err != nil {
		return nil, err
	}
	return UpdateWebhook204Response{}, nil
}

func (s *Server) DeleteWebhook(ctx context.Context, req DeleteWebhookRequestObject) (DeleteWebhookResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Hooks.Delete(ctx, t, req.WebhookId); err != nil {
		return nil, err
	}
	return DeleteWebhook204Response{}, nil
}

func (s *Server) RotateWebhookSecret(ctx context.Context, req RotateWebhookSecretRequestObject) (RotateWebhookSecretResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	secret, err := s.Hooks.RotateSecret(ctx, t, req.WebhookId)
	if err != nil {
		return nil, err
	}
	return RotateWebhookSecret200JSONResponse{Secret: secret}, nil
}

func (s *Server) TestWebhook(ctx context.Context, req TestWebhookRequestObject) (TestWebhookResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if _, err := s.Hooks.SendTest(ctx, t, req.WebhookId); err != nil {
		return nil, err
	}
	return TestWebhook202Response{}, nil
}

func (s *Server) ListWebhookDeliveries(ctx context.Context, req ListWebhookDeliveriesRequestObject) (ListWebhookDeliveriesResponseObject, error) {
	if err := s.hooksReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	list, err := s.Hooks.Deliveries(ctx, t, req.WebhookId)
	if err != nil {
		return nil, err
	}
	out := ListWebhookDeliveries200JSONResponse{Deliveries: make([]WebhookDelivery, 0, len(list))}
	for _, d := range list {
		out.Deliveries = append(out.Deliveries, WebhookDelivery{
			Id: d.ID, EventType: d.EventType, State: WebhookDeliveryState(d.State), Attempts: d.Attempts,
			LastStatus: d.LastStatus, LastError: d.LastError, CreatedAt: d.CreatedAt, SentAt: d.SentAt,
		})
	}
	return out, nil
}
