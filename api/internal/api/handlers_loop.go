package api

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"product/api/internal/outreach"
	"product/api/internal/release"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/workflow"
)

func (s *Server) loopReady() error {
	if s.Workflow == nil || s.Outreach == nil || s.Release == nil {
		return errNotConfigured
	}
	return nil
}

func (s *Server) loopTenant(ctx context.Context, ws uuid.UUID) (store.Tenant, error) {
	if err := s.loopReady(); err != nil {
		return store.Tenant{}, err
	}
	return s.tenant(ctx, ws)
}

// ---- statuses ----

func (s *Server) ListStatuses(ctx context.Context, req ListStatusesRequestObject) (ListStatusesResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Workflow.List(ctx, t)
	if err != nil {
		return nil, err
	}
	out := make([]Status, 0, len(rows))
	for _, r := range rows {
		out = append(out, Status{Id: r.ID, Name: r.Name, Bucket: StatusBucket(r.Bucket), Position: r.Position})
	}
	return ListStatuses200JSONResponse{Statuses: out}, nil
}

func (s *Server) CreateStatus(ctx context.Context, req CreateStatusRequestObject) (CreateStatusResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name and a type are required.")
	}
	id, err := s.Workflow.Create(ctx, t, req.Body.Name, string(req.Body.Bucket))
	if err != nil {
		return nil, err
	}
	return CreateStatus201JSONResponse{Id: id}, nil
}

func (s *Server) RenameStatus(ctx context.Context, req RenameStatusRequestObject) (RenameStatusResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	if err := s.Workflow.Rename(ctx, t, req.StatusId, req.Body.Name); err != nil {
		return nil, err
	}
	return RenameStatus204Response{}, nil
}

func (s *Server) SetRequestStatus(ctx context.Context, req SetRequestStatusRequestObject) (SetRequestStatusResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A status is required.")
	}
	ch, err := s.Workflow.SetRequestStatus(ctx, t, req.RequestId, req.Body.StatusId)
	if err != nil {
		return nil, err
	}
	out := SetRequestStatus200JSONResponse{Shipped: ch.Shipped, WillContact: ch.Outreach.WillContact, Suppressed: ch.Outreach.Suppressed,
		NoEmail: ch.Outreach.NoEmail, AnonymousQuotes: ch.Outreach.AnonymousQuotes}
	if ch.Outreach.BatchID != uuid.Nil {
		id := ch.Outreach.BatchID
		out.BatchId = &id
	}
	return out, nil
}

// ---- outreach ----

func batchRowState(s string) []string {
	switch s {
	case "done":
		return []string{"done"}
	case "cancelled":
		return []string{"cancelled"}
	}
	return []string{"drafting", "review", "approved"}
}

func (s *Server) ListOutreach(ctx context.Context, req ListOutreachRequestObject) (ListOutreachResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	state := "open"
	if req.Params.State != nil {
		state = string(*req.Params.State)
	}
	rows, err := s.Outreach.List(ctx, t, batchRowState(state), 50)
	if err != nil {
		return nil, err
	}
	out := make([]OutreachBatchRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, OutreachBatchRow{Id: r.ID, RequestId: r.RequestID, RequestTitle: r.RequestTitle, State: OutreachBatchRowState(r.State), MessageCount: r.MessageCount, ReadyToSend: r.ReadyToSend, LeftOut: r.LeftOut, Failed: r.Failed, CreatedAt: r.CreatedAt})
	}
	return ListOutreach200JSONResponse{Batches: out}, nil
}

func (s *Server) GetOutreachBatch(ctx context.Context, req GetOutreachBatchRequestObject) (GetOutreachBatchResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	b, err := s.Outreach.Get(ctx, t, req.BatchId)
	if err != nil {
		return nil, err
	}
	out := OutreachBatch{Id: b.ID, RequestId: b.RequestID, RequestTitle: b.RequestTitle, State: OutreachBatchState(b.State), CreatedAt: b.CreatedAt,
		NoEmail: b.NoEmail, AnonymousQuotes: b.Anonymous, ReadyToSend: b.ReadyToSend, Messages: make([]OutreachMessage, 0, len(b.Messages))}
	for _, m := range b.Messages {
		om := OutreachMessage{Id: m.ID, PersonId: m.PersonID, PersonName: m.PersonName, ToEmail: m.ToEmail, State: OutreachMessageState(m.State),
			Subject: m.Subject, Body: m.Body, Edited: m.Edited, SentAt: m.SentAt, Quotes: make([]OutreachQuote, 0, len(m.Quotes))}
		if m.AccountName != "" {
			a := m.AccountName
			om.AccountName = &a
		}
		if m.DraftedBy != "" {
			d := OutreachMessageDraftedBy(m.DraftedBy)
			om.DraftedBy = &d
		}
		if m.Error != "" {
			e := m.Error
			om.Error = &e
		}
		for _, q := range m.Quotes {
			om.Quotes = append(om.Quotes, OutreachQuote{EvidenceId: q.EvidenceID, Text: q.Text})
		}
		out.Messages = append(out.Messages, om)
	}
	return GetOutreachBatch200JSONResponse(out), nil
}

func (s *Server) ApproveOutreachBatch(ctx context.Context, req ApproveOutreachBatchRequestObject) (ApproveOutreachBatchResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	n, err := s.Outreach.Approve(ctx, t, req.BatchId)
	if err != nil {
		return nil, err
	}
	return ApproveOutreachBatch202JSONResponse{Queued: n}, nil
}

func (s *Server) CancelOutreachBatch(ctx context.Context, req CancelOutreachBatchRequestObject) (CancelOutreachBatchResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Outreach.Cancel(ctx, t, req.BatchId); err != nil {
		return nil, err
	}
	return CancelOutreachBatch204Response{}, nil
}

func (s *Server) EditOutreachMessage(ctx context.Context, req EditOutreachMessageRequestObject) (EditOutreachMessageResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A subject and a message are required.")
	}
	if err := s.Outreach.EditMessage(ctx, t, req.MessageId, req.Body.Subject, req.Body.Body); err != nil {
		return nil, err
	}
	return EditOutreachMessage204Response{}, nil
}

func (s *Server) ExcludeOutreachMessage(ctx context.Context, req ExcludeOutreachMessageRequestObject) (ExcludeOutreachMessageResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Outreach.Exclude(ctx, t, req.MessageId); err != nil {
		return nil, err
	}
	return ExcludeOutreachMessage204Response{}, nil
}

func (s *Server) IncludeOutreachMessage(ctx context.Context, req IncludeOutreachMessageRequestObject) (IncludeOutreachMessageResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Outreach.Include(ctx, t, req.MessageId); err != nil {
		return nil, err
	}
	return IncludeOutreachMessage204Response{}, nil
}

func (s *Server) RetryOutreachMessage(ctx context.Context, req RetryOutreachMessageRequestObject) (RetryOutreachMessageResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Outreach.RetryFailed(ctx, t, req.MessageId); err != nil {
		return nil, err
	}
	return RetryOutreachMessage204Response{}, nil
}

func (s *Server) SendTestOutreachMessage(ctx context.Context, req SendTestOutreachMessageRequestObject) (SendTestOutreachMessageResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if !t.CanWrite() {
		return nil, store.ErrForbidden
	}
	id, ok := identityFrom(ctx)
	if !ok || !id.EmailVerified || strings.TrimSpace(id.Email) == "" {
		return nil, badRequest("Your account needs a verified email address before a test can be sent.")
	}
	var subject, body string
	if req.Body != nil {
		if req.Body.Subject != nil {
			subject = *req.Body.Subject
		}
		if req.Body.Body != nil {
			body = *req.Body.Body
		}
	}
	if err := s.Outreach.SendTest(ctx, t, req.MessageId, id.Email, subject, body); err != nil {
		return nil, err
	}
	return SendTestOutreachMessage204Response{}, nil
}

// ---- release notes ----

func kindOfInput(t *ReleaseNoteInputType) string {
	if t == nil {
		return ""
	}
	return string(*t)
}

func noteView(n release.Note) ReleaseNote {
	out := ReleaseNote{Id: n.ID, Title: n.Title, Body: n.Body, State: ReleaseNoteState(n.State), Type: ReleaseNoteType(n.Type), ScheduledFor: n.ScheduledFor, PublishedAt: n.PublishedAt,
		LiveNow: n.LiveNow, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt, Requests: make([]LinkedRequest, 0, len(n.Requests))}
	for _, r := range n.Requests {
		out.Requests = append(out.Requests, LinkedRequest{Id: r.ID, Title: r.Title})
	}
	return out
}

func (s *Server) ListReleaseNotes(ctx context.Context, req ListReleaseNotesRequestObject) (ListReleaseNotesResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	before, beforeID := time.Now().Add(24*time.Hour), uuid.Max
	if req.Params.Cursor != nil && *req.Params.Cursor != "" {
		if before, beforeID, err = decodeCursor(string(*req.Params.Cursor)); err != nil {
			return nil, badRequest("The page cursor is not valid.")
		}
	}
	limit := pageSize(req.Params.Limit)
	filter := release.ListFilter{}
	if req.Params.State != nil {
		filter.State = string(*req.Params.State)
	}
	if req.Params.Q != nil {
		filter.Q = *req.Params.Q
	}
	if req.Params.Type != nil {
		filter.Type = string(*req.Params.Type)
	}
	rows, err := s.Release.List(ctx, t, before, beforeID, limit+1, filter)
	if err != nil {
		return nil, err
	}
	counts, err := s.Release.Counts(ctx, t)
	if err != nil {
		return nil, err
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		c := encodeCursor(rows[len(rows)-1].CreatedAt, rows[len(rows)-1].ID)
		next = &c
	}
	out := make([]ReleaseNote, 0, len(rows))
	for _, n := range rows {
		out = append(out, noteView(n))
	}
	return ListReleaseNotes200JSONResponse{
		Notes:      out,
		NextCursor: next,
		Counts:     ReleaseNoteCounts{All: counts.All, Draft: counts.Draft, Scheduled: counts.Scheduled, Published: counts.Published, Unpublished: counts.Unpublished},
	}, nil
}

func (s *Server) CreateReleaseNote(ctx context.Context, req CreateReleaseNoteRequestObject) (CreateReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A title is required.")
	}
	id, err := s.Release.Create(ctx, t, req.Body.Title, derefStr(req.Body.Body), kindOfInput(req.Body.Type))
	if err != nil {
		return nil, err
	}
	return CreateReleaseNote201JSONResponse{Id: id}, nil
}

func (s *Server) GetReleaseNote(ctx context.Context, req GetReleaseNoteRequestObject) (GetReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	n, err := s.Release.Get(ctx, t, req.NoteId)
	if err != nil {
		return nil, err
	}
	return GetReleaseNote200JSONResponse(noteView(n)), nil
}

func (s *Server) UpdateReleaseNote(ctx context.Context, req UpdateReleaseNoteRequestObject) (UpdateReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A title is required.")
	}
	if err := s.Release.Update(ctx, t, req.NoteId, req.Body.Title, derefStr(req.Body.Body), kindOfInput(req.Body.Type)); err != nil {
		return nil, err
	}
	return UpdateReleaseNote204Response{}, nil
}

func (s *Server) SetReleaseNoteRequests(ctx context.Context, req SetReleaseNoteRequestsRequestObject) (SetReleaseNoteRequestsResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A list of requests is required.")
	}
	ids := make([]uuid.UUID, 0, len(req.Body.RequestIds))
	for _, id := range req.Body.RequestIds {
		ids = append(ids, uuid.UUID(id))
	}
	if err := s.Release.SetRequests(ctx, t, req.NoteId, ids); err != nil {
		return nil, err
	}
	return SetReleaseNoteRequests204Response{}, nil
}

func (s *Server) PublishReleaseNote(ctx context.Context, req PublishReleaseNoteRequestObject) (PublishReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	var at *time.Time
	if req.Body != nil && req.Body.ScheduledFor != nil {
		at = req.Body.ScheduledFor
	}
	if err := s.Release.Publish(ctx, t, req.NoteId, at); err != nil {
		return nil, err
	}
	return PublishReleaseNote204Response{}, nil
}

func (s *Server) UnpublishReleaseNote(ctx context.Context, req UnpublishReleaseNoteRequestObject) (UnpublishReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Release.Unpublish(ctx, t, req.NoteId); err != nil {
		return nil, err
	}
	return UnpublishReleaseNote204Response{}, nil
}

func (s *Server) UnscheduleReleaseNote(ctx context.Context, req UnscheduleReleaseNoteRequestObject) (UnscheduleReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Release.Unschedule(ctx, t, req.NoteId); err != nil {
		return nil, err
	}
	return UnscheduleReleaseNote204Response{}, nil
}

func (s *Server) DeleteReleaseNote(ctx context.Context, req DeleteReleaseNoteRequestObject) (DeleteReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Release.DeleteDraft(ctx, t, req.NoteId); err != nil {
		return nil, err
	}
	return DeleteReleaseNote204Response{}, nil
}

func (s *Server) DuplicateReleaseNote(ctx context.Context, req DuplicateReleaseNoteRequestObject) (DuplicateReleaseNoteResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, err := s.Release.Duplicate(ctx, t, req.NoteId)
	if err != nil {
		return nil, err
	}
	return DuplicateReleaseNote201JSONResponse{Id: id}, nil
}

// ---- settings ----

func (s *Server) GetWorkspaceSettings(ctx context.Context, req GetWorkspaceSettingsRequestObject) (GetWorkspaceSettingsResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	st, err := s.Release.GetSettings(ctx, t)
	if err != nil {
		return nil, err
	}
	out := GetWorkspaceSettings200JSONResponse{Name: st.Name, SenderName: st.SenderName}
	if st.PublicSlug != "" {
		out.PublicSlug = &st.PublicSlug
	}
	if s.EmailFromAddress != "" {
		address := s.EmailFromAddress
		out.SenderAddress = &address
	}
	if s.EmailReplyTo != "" {
		replyTo := s.EmailReplyTo
		out.ReplyTo = &replyTo
	}
	configured := s.EmailConfigured
	out.EmailConfigured = &configured
	return out, nil
}

func (s *Server) UpdateWorkspaceSettings(ctx context.Context, req UpdateWorkspaceSettingsRequestObject) (UpdateWorkspaceSettingsResponseObject, error) {
	t, err := s.loopTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Settings are required.")
	}
	if err := s.Release.UpdateSettings(ctx, t, derefStr(req.Body.PublicSlug), derefStr(req.Body.SenderName)); err != nil {
		return nil, err
	}
	return UpdateWorkspaceSettings204Response{}, nil
}

// ---- public (no sign-in) ----

func (s *Server) GetPublicReleases(ctx context.Context, req GetPublicReleasesRequestObject) (GetPublicReleasesResponseObject, error) {
	if s.Release == nil {
		return nil, errNotConfigured
	}
	page, err := s.Release.PublicList(ctx, req.Slug, pageSize(req.Params.Limit))
	if err != nil {
		return nil, err
	}
	out := GetPublicReleases200JSONResponse{WorkspaceName: page.WorkspaceName, Notes: make([]PublicReleaseNote, 0, len(page.Notes))}
	for _, n := range page.Notes {
		out.Notes = append(out.Notes, PublicReleaseNote{Id: n.ID, Title: n.Title, Body: n.Body, Type: PublicReleaseNoteType(n.Type), PublishedAt: n.PublishedAt})
	}
	return out, nil
}

func (s *Server) GetPublicRelease(ctx context.Context, req GetPublicReleaseRequestObject) (GetPublicReleaseResponseObject, error) {
	if s.Release == nil {
		return nil, errNotConfigured
	}
	n, name, err := s.Release.PublicGet(ctx, req.Slug, req.NoteId)
	if err != nil {
		return nil, err
	}
	return GetPublicRelease200JSONResponse{WorkspaceName: name, Note: PublicReleaseNote{Id: n.ID, Title: n.Title, Body: n.Body, Type: PublicReleaseNoteType(n.Type), PublishedAt: n.PublishedAt}}, nil
}

func maskEmail(e string) string {
	at := strings.LastIndex(e, "@")
	if at < 1 {
		return "***"
	}
	return e[:1] + "***" + e[at:]
}

func (s *Server) CheckUnsubscribe(ctx context.Context, req CheckUnsubscribeRequestObject) (CheckUnsubscribeResponseObject, error) {
	if s.Outreach == nil || s.Unsub.Secret == nil {
		return nil, errNotConfigured
	}
	_, addr, err := s.Outreach.AddressFor(ctx, s.Unsub, req.Token)
	if err != nil {
		return nil, errNotFound // a bad link looks like any other missing page
	}
	return CheckUnsubscribe200JSONResponse{MaskedEmail: maskEmail(addr)}, nil
}

func (s *Server) ConfirmUnsubscribe(ctx context.Context, req ConfirmUnsubscribeRequestObject) (ConfirmUnsubscribeResponseObject, error) {
	if s.Outreach == nil || s.Unsub.Secret == nil {
		return nil, errNotConfigured
	}
	if err := s.Outreach.Unsubscribe(ctx, s.Unsub, req.Token); err != nil {
		return nil, err
	}
	return ConfirmUnsubscribe204Response{}, nil
}

var _ = outreach.ErrNotFound
var _ = workflow.ErrNotFound
var _ dbgen.Queries
