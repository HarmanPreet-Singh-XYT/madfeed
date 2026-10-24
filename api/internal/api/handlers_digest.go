package api

import (
	"context"

	"product/api/internal/billing"
	"product/api/internal/digest"
)

func (s *Server) digestReady() error {
	if s.Digest == nil {
		return errNotConfigured
	}
	return nil
}

func (s *Server) digestBody(st digest.Settings) DigestSettings {
	out := DigestSettings{Enabled: st.Enabled, Weekday: st.Weekday, HourUtc: st.HourUTC, EmailConfigured: s.EmailConfigured, Recipients: make([]struct {
		Email        string `json:"email"`
		Unsubscribed bool   `json:"unsubscribed"`
	}, 0, len(st.Recipients))}
	for _, r := range st.Recipients {
		out.Recipients = append(out.Recipients, struct {
			Email        string `json:"email"`
			Unsubscribed bool   `json:"unsubscribed"`
		}{r.Email, r.Unsubscribed})
	}
	return out
}

func (s *Server) GetDigestSettings(ctx context.Context, req GetDigestSettingsRequestObject) (GetDigestSettingsResponseObject, error) {
	if err := s.digestReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	st, err := s.Digest.GetSettings(ctx, t)
	if err != nil {
		return nil, err
	}
	return GetDigestSettings200JSONResponse(s.digestBody(st)), nil
}

func (s *Server) UpdateDigestSettings(ctx context.Context, req UpdateDigestSettingsRequestObject) (UpdateDigestSettingsResponseObject, error) {
	if err := s.digestReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b.Enabled {
		if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureDigest); err != nil {
			return nil, err
		}
	}
	confirmed := b.RecipientsConfirmed != nil && *b.RecipientsConfirmed
	if err := s.Digest.UpdateSettings(ctx, t, b.Enabled, b.Weekday, b.HourUtc, b.Recipients, confirmed); err != nil {
		return nil, err
	}
	st, err := s.Digest.GetSettings(ctx, t)
	if err != nil {
		return nil, err
	}
	return UpdateDigestSettings200JSONResponse(s.digestBody(st)), nil
}

func (s *Server) PreviewDigest(ctx context.Context, req PreviewDigestRequestObject) (PreviewDigestResponseObject, error) {
	if err := s.digestReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	d, err := s.Digest.Preview(ctx, t)
	if err != nil {
		return nil, err
	}
	return PreviewDigest200JSONResponse{Subject: d.Subject, Text: d.Text, Empty: d.Empty}, nil
}

func (s *Server) CheckDigestUnsubscribe(ctx context.Context, req CheckDigestUnsubscribeRequestObject) (CheckDigestUnsubscribeResponseObject, error) {
	if err := s.digestReady(); err != nil {
		return nil, err
	}
	masked, err := s.Digest.Info(ctx, req.Token)
	if err != nil {
		return nil, err
	}
	return CheckDigestUnsubscribe200JSONResponse{MaskedEmail: masked}, nil
}

func (s *Server) ConfirmDigestUnsubscribe(ctx context.Context, req ConfirmDigestUnsubscribeRequestObject) (ConfirmDigestUnsubscribeResponseObject, error) {
	if err := s.digestReady(); err != nil {
		return nil, err
	}
	if err := s.Digest.Unsubscribe(ctx, req.Token); err != nil {
		return nil, err
	}
	return ConfirmDigestUnsubscribe204Response{}, nil
}
