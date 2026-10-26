package api

import (
	"context"

	"product/api/internal/ops"
)

func (s *Server) GetAccountDeletionRequest(ctx context.Context, _ GetAccountDeletionRequestRequestObject) (GetAccountDeletionRequestResponseObject, error) {
	if s.Account == nil {
		return nil, errNotConfigured
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	r, err := s.Account.Open(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return GetAccountDeletionRequest200JSONResponse{Open: false}, nil
	}
	return GetAccountDeletionRequest200JSONResponse{Open: true, RequestedAt: &r.RequestedAt}, nil
}

func (s *Server) RequestAccountDeletion(ctx context.Context, _ RequestAccountDeletionRequestObject) (RequestAccountDeletionResponseObject, error) {
	if s.Account == nil {
		return nil, errNotConfigured
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	r, created, err := s.Account.Request(ctx, id.UserID, id.Email)
	if err != nil {
		return nil, err
	}
	if created && s.Alerts != nil {
		// The operator deletes the sign-in account by hand; this is how they hear of it. Ids only, no address.
		s.Alerts.Fire(context.WithoutCancel(ctx), ops.Alert{
			Name: "account_deletion_requested", Severity: ops.Warning,
			Summary: "Someone asked for their account to be deleted. Process it with: go run ./cmd/accountdeletion list",
			Details: map[string]string{"request": r.ID.String()},
		}, "account-deletion:"+r.ID.String())
	}
	return RequestAccountDeletion200JSONResponse{RequestedAt: r.RequestedAt}, nil
}

func (s *Server) CancelAccountDeletionRequest(ctx context.Context, _ CancelAccountDeletionRequestRequestObject) (CancelAccountDeletionRequestResponseObject, error) {
	if s.Account == nil {
		return nil, errNotConfigured
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	if _, err := s.Account.Cancel(ctx, id.UserID); err != nil {
		return nil, err
	}
	return CancelAccountDeletionRequest204Response{}, nil
}
