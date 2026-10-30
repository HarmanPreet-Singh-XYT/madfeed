package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/inbox"
)

func (s *Server) inboxReady() error {
	if s.Inbox == nil {
		return errNotConfigured
	}
	return nil
}

func settingsBody(st inbox.Settings) map[string]any {
	out := map[string]any{"chatEnabled": st.ChatEnabled, "emailEnabled": st.EmailEnabled, "origins": st.Origins, "greeting": st.Greeting}
	if st.WidgetToken != "" {
		out["widgetToken"] = st.WidgetToken
	}
	if st.InboundKey != "" {
		out["inboundKey"] = st.InboundKey
	}
	return out
}

func (s *Server) GetInboxSettings(ctx context.Context, req GetInboxSettingsRequestObject) (GetInboxSettingsResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	st, err := s.Inbox.GetSettings(ctx, t)
	if err != nil {
		return nil, err
	}
	return shape[GetInboxSettings200JSONResponse](settingsBody(st)), nil
}

func (s *Server) UpdateInboxSettings(ctx context.Context, req UpdateInboxSettingsRequestObject) (UpdateInboxSettingsResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	in := inbox.SettingsInput{ChatEnabled: b.ChatEnabled, EmailEnabled: b.EmailEnabled, Origins: b.Origins}
	if b.Greeting != nil {
		in.Greeting = *b.Greeting
	}
	in.RotateWidget = b.RotateWidget != nil && *b.RotateWidget
	in.RotateInbound = b.RotateInbound != nil && *b.RotateInbound
	st, err := s.Inbox.UpdateSettings(ctx, t, in)
	if err != nil {
		return nil, err
	}
	return shape[UpdateInboxSettings200JSONResponse](settingsBody(st)), nil
}

func summaryBody(c inbox.Summary, me uuid.UUID) map[string]any {
	m := map[string]any{"id": c.ID, "channel": c.Channel, "state": c.State, "subject": c.Subject, "customerName": c.CustomerName, "customerEmail": c.CustomerEmail, "preview": c.Preview, "messages": c.Messages, "lastMessageAt": c.LastMessageAt, "awaitingReply": c.Awaiting, "unread": c.Unread, "assignedToMe": c.Assignee != nil && *c.Assignee == me}
	if c.PersonID != nil {
		m["personId"] = c.PersonID
	}
	if c.Assignee != nil {
		m["assignee"] = c.Assignee
	}
	return m
}

func (s *Server) ListConversations(ctx context.Context, req ListConversationsRequestObject) (ListConversationsResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	p := req.Params
	f := inbox.Filter{AfterAt: p.AfterAt, AfterID: p.AfterId}
	if p.State != nil {
		f.State = string(*p.State)
	}
	f.Mine = p.Mine != nil && *p.Mine
	f.Unassigned = p.Unassigned != nil && *p.Unassigned
	f.Unread = p.Unread != nil && *p.Unread
	if p.Channel != nil {
		f.Channel = string(*p.Channel)
	}
	f.Assignee = p.Assignee
	f.PersonID = p.PersonId
	if p.Q != nil {
		f.Search = *p.Q
	}
	if p.Limit != nil {
		f.Limit = *p.Limit
	}
	rows, next, err := s.Inbox.List(ctx, t, f)
	if err != nil {
		return nil, err
	}
	list := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		list = append(list, summaryBody(r, t.UserID))
	}
	out := map[string]any{"conversations": list}
	if next != nil {
		out["next"] = map[string]any{"at": next.LastMessageAt, "id": next.ID}
	}
	return shape[ListConversations200JSONResponse](out), nil
}

func (s *Server) MarkConversationRead(ctx context.Context, req MarkConversationReadRequestObject) (MarkConversationReadResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.MarkRead(ctx, t, req.ConversationId); err != nil {
		return nil, err
	}
	return MarkConversationRead204Response{}, nil
}

func (s *Server) BulkConversations(ctx context.Context, req BulkConversationsRequestObject) (BulkConversationsResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Choose some conversations.")
	}
	var n int
	switch string(req.Body.Action) {
	case "take":
		n, err = s.Inbox.BulkAssign(ctx, t, req.Body.ConversationIds, &t.UserID)
	case "release":
		n, err = s.Inbox.BulkAssign(ctx, t, req.Body.ConversationIds, nil)
	case "close":
		n, err = s.Inbox.BulkSetState(ctx, t, req.Body.ConversationIds, "closed")
	case "reopen":
		n, err = s.Inbox.BulkSetState(ctx, t, req.Body.ConversationIds, "open")
	}
	if err != nil {
		return nil, err
	}
	return BulkConversations200JSONResponse{Updated: n}, nil
}

func (s *Server) GetConversation(ctx context.Context, req GetConversationRequestObject) (GetConversationResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	c, err := s.Inbox.Get(ctx, t, req.ConversationId)
	if err != nil {
		return nil, err
	}
	m := summaryBody(c.Summary, t.UserID)
	thread := make([]map[string]any, 0, len(c.Thread))
	for _, x := range c.Thread {
		tm := map[string]any{"id": x.ID, "seq": x.Seq, "direction": x.Direction, "body": x.Body, "state": x.State, "at": x.CreatedAt, "sentOn": x.SentOn, "files": fileList(x.Files)}
		if x.AuthorID != nil {
			tm["authorId"] = x.AuthorID
		}
		if x.Error != "" {
			tm["error"] = x.Error
		}
		thread = append(thread, tm)
	}
	cards := make([]map[string]any, 0, len(c.Cards))
	for _, cd := range c.Cards {
		reqs := make([]map[string]any, 0, len(cd.Requests))
		for _, r := range cd.Requests {
			reqs = append(reqs, map[string]any{"id": r.ID, "title": r.Title, "status": r.Status, "bucket": r.Bucket})
		}
		cards = append(cards, map[string]any{"messageId": cd.MessageID, "sourceItemId": cd.SourceItemID, "stage": cd.Stage, "waiting": cd.Waiting, "requests": reqs})
	}
	m["lastMessageId"], m["canReply"], m["thread"], m["cards"] = c.LastID, c.CanReply, thread, cards
	return shape[GetConversation200JSONResponse](m), nil
}

func (s *Server) DeleteConversation(ctx context.Context, req DeleteConversationRequestObject) (DeleteConversationResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.Delete(ctx, t, req.ConversationId); err != nil {
		return nil, err
	}
	return DeleteConversation204Response{}, nil
}

func (s *Server) ReplyToConversation(ctx context.Context, req ReplyToConversationRequestObject) (ReplyToConversationResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, err := s.Inbox.Reply(ctx, t, req.ConversationId, req.Body.SeenMessageId, req.Body.Body, fileIDs(req.Body.AttachmentIds)...)
	if err != nil {
		return nil, err
	}
	return ReplyToConversation201JSONResponse{MessageId: id}, nil
}

func (s *Server) AddConversationNote(ctx context.Context, req AddConversationNoteRequestObject) (AddConversationNoteResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, err := s.Inbox.Note(ctx, t, req.ConversationId, req.Body.Body)
	if err != nil {
		return nil, err
	}
	return AddConversationNote201JSONResponse{MessageId: id}, nil
}

func (s *Server) AssignConversation(ctx context.Context, req AssignConversationRequestObject) (AssignConversationResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	var expected *uuid.UUID
	if req.Body.ExpectedAssignee != nil {
		id := uuid.UUID(*req.Body.ExpectedAssignee)
		expected = &id
	}
	if req.Body.AssignTo != nil {
		if !req.Body.Take {
			return nil, badRequest("To hand a conversation to someone, take must be true.")
		}
		if err := s.Inbox.AssignTo(ctx, t, req.ConversationId, uuid.UUID(*req.Body.AssignTo), expected); err != nil {
			return nil, err
		}
		return AssignConversation204Response{}, nil
	}
	if err := s.Inbox.Assign(ctx, t, req.ConversationId, req.Body.Take, expected); err != nil {
		return nil, err
	}
	return AssignConversation204Response{}, nil
}

func (s *Server) SetConversationState(ctx context.Context, req SetConversationStateRequestObject) (SetConversationStateResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.SetState(ctx, t, req.ConversationId, string(req.Body.State)); err != nil {
		return nil, err
	}
	return SetConversationState204Response{}, nil
}

func (s *Server) ConvertConversationMessage(ctx context.Context, req ConvertConversationMessageRequestObject) (ConvertConversationMessageResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, err := s.Inbox.Convert(ctx, t, req.ConversationId, req.MessageId)
	if err != nil {
		return nil, err
	}
	return ConvertConversationMessage200JSONResponse{SourceItemId: id}, nil
}

func (s *Server) RetryConversationReply(ctx context.Context, req RetryConversationReplyRequestObject) (RetryConversationReplyResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.Retry(ctx, t, req.MessageId); err != nil {
		return nil, err
	}
	return RetryConversationReply204Response{}, nil
}

// ---- the parts people outside the team reach (no sign-in) ----

func (s *Server) GetChatConfig(ctx context.Context, req GetChatConfigRequestObject) (GetChatConfigResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	c, err := s.Inbox.Config(ctx, req.Token, req.Params.Origin)
	if err != nil {
		return nil, err
	}
	return GetChatConfig200JSONResponse{WorkspaceName: c.WorkspaceName, Greeting: c.Greeting}, nil
}

func (s *Server) SendChatMessage(ctx context.Context, req SendChatMessageRequestObject) (SendChatMessageResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	addr, _ := ctx.Value(addrKey{}).(string)
	b := req.Body
	in := inbox.ChatInput{Token: req.Token, Origin: b.Origin, Visitor: b.Visitor, Text: b.Text, Addr: addr, Files: fileIDs(b.AttachmentIds)}
	if b.Name != nil {
		in.Name = *b.Name
	}
	if b.Email != nil {
		in.Email = *b.Email
	}
	if err := s.Inbox.ChatSend(ctx, in); err != nil {
		return nil, err
	}
	return SendChatMessage202JSONResponse{Received: true}, nil
}

func (s *Server) GetChatMessages(ctx context.Context, req GetChatMessagesRequestObject) (GetChatMessagesResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	after := 0
	if req.Params.After != nil {
		after = *req.Params.After
	}
	msgs, err := s.Inbox.ChatPoll(ctx, req.Token, req.Params.Origin, req.Params.Visitor, after)
	if err != nil {
		return nil, err
	}
	list := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		list = append(list, map[string]any{"seq": m.Seq, "fromTeam": m.FromTeam, "text": m.Text, "at": m.CreatedAt, "files": fileList(m.Files)})
	}
	return shape[GetChatMessages200JSONResponse](map[string]any{"messages": list}), nil
}

// inboundEmail receives one incoming email from the mail service, signed with the workspace's inbound key.
func (s *Server) inboundEmail() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.Inbox == nil {
			http.NotFound(w, r)
			return
		}
		ws, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "workspaceId")))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10+1))
		if err != nil {
			writeError(w, r, &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "That is larger than allowed."})
			return
		}
		err = s.Inbox.ReceiveEmail(r.Context(), ws, body, r.Header.Get("X-Timestamp"), r.Header.Get("X-Signature"))
		switch {
		case err == nil:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"received":true}`))
		case errors.Is(err, inbox.ErrBadSign):
			writeError(w, r, errUnauthorized)
		default:
			writeError(w, r, err)
		}
	})
}

func (s *Server) ListMembers(ctx context.Context, req ListMembersRequestObject) (ListMembersResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	ms, err := s.Inbox.Teammates(ctx, t)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(ms))
	for _, m := range ms {
		rows = append(rows, map[string]any{"userId": m.UserID, "name": m.Name, "role": m.Role, "isMe": m.UserID == t.UserID})
	}
	return shape[ListMembers200JSONResponse](map[string]any{"members": rows}), nil
}

func (s *Server) SetMyName(ctx context.Context, req SetMyNameRequestObject) (SetMyNameResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.SetMyName(ctx, t, req.Body.Name); err != nil {
		return nil, err
	}
	return SetMyName204Response{}, nil
}

func (s *Server) ListCannedReplies(ctx context.Context, req ListCannedRepliesRequestObject) (ListCannedRepliesResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	cs, err := s.Inbox.CannedReplies(ctx, t)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(cs))
	for _, c := range cs {
		rows = append(rows, map[string]any{"id": c.ID, "name": c.Name, "body": c.Body, "updatedAt": c.UpdatedAt})
	}
	return shape[ListCannedReplies200JSONResponse](map[string]any{"replies": rows}), nil
}

func (s *Server) CreateCannedReply(ctx context.Context, req CreateCannedReplyRequestObject) (CreateCannedReplyResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, err := s.Inbox.CreateCanned(ctx, t, req.Body.Name, req.Body.Body)
	if err != nil {
		return nil, err
	}
	return CreateCannedReply201JSONResponse{Id: id}, nil
}

func (s *Server) UpdateCannedReply(ctx context.Context, req UpdateCannedReplyRequestObject) (UpdateCannedReplyResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.UpdateCanned(ctx, t, req.CannedReplyId, req.Body.Name, req.Body.Body); err != nil {
		return nil, err
	}
	return UpdateCannedReply204Response{}, nil
}

func (s *Server) DeleteCannedReply(ctx context.Context, req DeleteCannedReplyRequestObject) (DeleteCannedReplyResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.DeleteCanned(ctx, t, req.CannedReplyId); err != nil {
		return nil, err
	}
	return DeleteCannedReply204Response{}, nil
}

func (s *Server) GetInboxStats(ctx context.Context, req GetInboxStatsRequestObject) (GetInboxStatsResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	f := inbox.StatsFilter{}
	if req.Params.Channel != nil {
		f.Channel = string(*req.Params.Channel)
	}
	f.Assignee = req.Params.Assignee
	st, err := s.Inbox.Stats(ctx, t, f)
	if err != nil {
		return nil, err
	}
	return GetInboxStats200JSONResponse{Days: st.Days, Answered: st.Answered, MedianMinutes: float32(st.MedianMinutes), P90Minutes: float32(st.P90Minutes),
		Open: st.Open, Mine: st.Mine, Unassigned: st.Unassigned, Closed: st.Closed, Unread: st.Unread,
		Waiting: st.Waiting, OldestWaitingMinutes: float32(st.OldestWaitingMin), TargetHours: st.TargetHours, OverTarget: st.OverTarget}, nil
}

func (s *Server) SetReplyTarget(ctx context.Context, req SetReplyTargetRequestObject) (SetReplyTargetResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Inbox.SetReplyTarget(ctx, t, req.Body.Hours); err != nil {
		return nil, err
	}
	return SetReplyTarget204Response{}, nil
}

func fileIDs(in *[]openapi_types.UUID) []uuid.UUID {
	if in == nil {
		return nil
	}
	out := make([]uuid.UUID, 0, len(*in))
	for _, id := range *in {
		out = append(out, uuid.UUID(id))
	}
	return out
}

func fileList(fs []inbox.Attachment) []map[string]any {
	out := make([]map[string]any, 0, len(fs))
	for _, f := range fs {
		out = append(out, map[string]any{"id": f.ID, "name": f.Name, "contentType": f.ContentType, "size": f.Size})
	}
	return out
}

func fileBody(f inbox.File) (io.Reader, int64, string) {
	// always a download: a fixed type, never one the sender chose, and no sniffing
	return bytes.NewReader(f.Data), int64(len(f.Data)), `attachment; filename="` + f.Name + `"`
}

func (s *Server) UploadConversationFile(ctx context.Context, req UploadConversationFileRequestObject) (UploadConversationFileResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("The file is empty.")
	}
	a, err := s.Inbox.UploadFile(ctx, t, req.ConversationId, req.Params.Name, req.Body)
	if err != nil {
		return nil, err
	}
	return UploadConversationFile201JSONResponse(shape[ChatFile](fileList([]inbox.Attachment{a})[0])), nil
}

func (s *Server) DownloadConversationFile(ctx context.Context, req DownloadConversationFileRequestObject) (DownloadConversationFileResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	f, err := s.Inbox.OpenFile(ctx, t, req.ConversationId, req.AttachmentId)
	if err != nil {
		return nil, err
	}
	body, n, disp := fileBody(f)
	nosniff, priv := "nosniff", "private, no-store"
	return DownloadConversationFile200ApplicationoctetStreamResponse{Body: body, ContentLength: n,
		Headers: DownloadConversationFile200ResponseHeaders{ContentDisposition: &disp, XContentTypeOptions: &nosniff, CacheControl: &priv}}, nil
}

func (s *Server) UploadChatFile(ctx context.Context, req UploadChatFileRequestObject) (UploadChatFileResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("The file is empty.")
	}
	addr, _ := ctx.Value(addrKey{}).(string)
	a, err := s.Inbox.ChatUploadFile(ctx, req.Token, req.Params.Origin, req.Params.Visitor, addr, req.Params.Name, req.Body)
	if err != nil {
		return nil, err
	}
	return UploadChatFile201JSONResponse(shape[ChatFile](fileList([]inbox.Attachment{a})[0])), nil
}

func (s *Server) DownloadChatFile(ctx context.Context, req DownloadChatFileRequestObject) (DownloadChatFileResponseObject, error) {
	if err := s.inboxReady(); err != nil {
		return nil, err
	}
	f, err := s.Inbox.ChatOpenFile(ctx, req.Token, req.Params.Origin, req.Params.Visitor, req.AttachmentId)
	if err != nil {
		return nil, err
	}
	body, n, disp := fileBody(f)
	nosniff, priv := "nosniff", "private, no-store"
	return DownloadChatFile200ApplicationoctetStreamResponse{Body: body, ContentLength: n,
		Headers: DownloadChatFile200ResponseHeaders{ContentDisposition: &disp, XContentTypeOptions: &nosniff, CacheControl: &priv}}, nil
}
