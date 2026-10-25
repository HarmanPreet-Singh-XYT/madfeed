package api

import (
	"context"

	"product/api/internal/team"
)

func (s *Server) teamReady() error {
	if s.Team == nil {
		return errNotConfigured
	}
	return nil
}

func invitationBody(i team.Invitation) Invitation {
	return Invitation{Id: i.ID, Email: i.Email, Role: InvitationRole(i.Role), CreatedAt: i.CreatedAt, ExpiresAt: i.ExpiresAt, LastSentAt: i.LastSentAt, Link: i.Link}
}

func (s *Server) ListInvitations(ctx context.Context, req ListInvitationsRequestObject) (ListInvitationsResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	list, err := s.Team.Pending(ctx, t)
	if err != nil {
		return nil, err
	}
	out := ListInvitations200JSONResponse{EmailEnabled: s.Team.MailEnabled, Invitations: make([]Invitation, 0, len(list))}
	for _, i := range list {
		out.Invitations = append(out.Invitations, invitationBody(i))
	}
	return out, nil
}

func (s *Server) CreateInvitation(ctx context.Context, req CreateInvitationRequestObject) (CreateInvitationResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	r, err := s.Team.Invite(ctx, t, req.Body.Email, string(req.Body.Role))
	if err != nil {
		return nil, err
	}
	return CreateInvitation201JSONResponse{Invitation: invitationBody(r.Invitation), EmailQueued: r.EmailQueued}, nil
}

func (s *Server) RevokeInvitation(ctx context.Context, req RevokeInvitationRequestObject) (RevokeInvitationResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Team.Revoke(ctx, t, req.InvitationId); err != nil {
		return nil, err
	}
	return RevokeInvitation204Response{}, nil
}

func (s *Server) ResendInvitation(ctx context.Context, req ResendInvitationRequestObject) (ResendInvitationResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	r, err := s.Team.Resend(ctx, t, req.InvitationId)
	if err != nil {
		return nil, err
	}
	return ResendInvitation200JSONResponse{Invitation: invitationBody(r.Invitation), EmailQueued: r.EmailQueued}, nil
}

func (s *Server) SetMemberRole(ctx context.Context, req SetMemberRoleRequestObject) (SetMemberRoleResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Team.SetRole(ctx, t, req.UserId, string(req.Body.Role)); err != nil {
		return nil, err
	}
	return SetMemberRole204Response{}, nil
}

func (s *Server) RemoveMember(ctx context.Context, req RemoveMemberRequestObject) (RemoveMemberResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Team.Remove(ctx, t, req.UserId); err != nil {
		return nil, err
	}
	return RemoveMember204Response{}, nil
}

func (s *Server) PreviewInvitation(ctx context.Context, req PreviewInvitationRequestObject) (PreviewInvitationResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	p, err := s.Team.Preview(ctx, req.Token, id)
	if err != nil {
		return nil, err
	}
	return shape[PreviewInvitation200JSONResponse](map[string]any{
		"workspaceName": p.WorkspaceName, "role": p.Role, "email": p.Email, "state": p.State,
		"alreadyMember": p.AlreadyMember, "canAccept": p.CanAccept,
	}), nil
}

func (s *Server) AcceptInvitation(ctx context.Context, req AcceptInvitationRequestObject) (AcceptInvitationResponseObject, error) {
	if err := s.teamReady(); err != nil {
		return nil, err
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	ws, err := s.Team.Accept(ctx, req.Token, id)
	if err != nil {
		return nil, err
	}
	return AcceptInvitation200JSONResponse{WorkspaceId: ws}, nil
}
