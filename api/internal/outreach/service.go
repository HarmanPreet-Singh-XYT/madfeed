package outreach

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/email"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound           = errors.New("outreach: not found")
	ErrConflict           = errors.New("outreach: not in a state that allows this")
	ErrStillDrafting      = errors.New("outreach: some messages are still being written")
	ErrNothingToSend      = errors.New("outreach: there are no messages ready to send")
	ErrEmailNotConfigured = errors.New("outreach: email is not configured")
	ErrSendFailed         = errors.New("outreach: the email provider did not accept the message")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ---- jobs ----

type DraftArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	MessageID   uuid.UUID `json:"message_id"`
	UserID      uuid.UUID `json:"user_id"`
}

func (DraftArgs) Kind() string { return "draft_outreach_message" }

type SendArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	MessageID   uuid.UUID `json:"message_id"`
	UserID      uuid.UUID `json:"user_id"`
}

func (SendArgs) Kind() string { return "send_outreach_message" }

// ---- views ----

type Summary struct {
	BatchID          uuid.UUID
	WillContact      int // people who will get a draft
	Suppressed       int // asked not to be emailed
	NoEmail          int // asked, but we have no address
	AnonymousQuotes  int // quotes from someone we have not recorded
	AlreadyContacted int // told about this request before
}

type QuoteView struct {
	EvidenceID uuid.UUID
	Text       string
}

type MessageView struct {
	ID          uuid.UUID
	PersonID    uuid.UUID
	PersonName  string
	AccountName string
	ToEmail     string
	State       string
	Subject     string
	Body        string
	DraftedBy   string
	Edited      bool
	SentAt      *time.Time
	Error       string
	Quotes      []QuoteView // the recipient's own words the draft was based on
}

type BatchView struct {
	ID           uuid.UUID
	RequestID    uuid.UUID
	RequestTitle string
	State        string
	CreatedAt    time.Time
	Messages     []MessageView
	NoEmail      int
	Anonymous    int
	ReadyToSend  int // messages that would go out on approval
}

type BatchRow struct {
	ID           uuid.UUID
	RequestID    uuid.UUID
	RequestTitle string
	State        string
	MessageCount int
	ReadyToSend  int
	LeftOut      int
	Failed       int
	CreatedAt    time.Time
}

type Service struct {
	Pool *pgxpool.Pool
	Jobs *river.Client[pgx.Tx]
	// HashKey keys the fingerprints that keep opt-outs working after a person is deleted.
	// Normally the same secret that signs unsubscribe links.
	HashKey []byte
	// Mail sends a draft to the signed-in person so they can see it in their own inbox.
	// Nil means email is not configured in this process.
	Mail        email.Sender
	FromAddress string
	ReplyTo     string
}

// Start is called inside the transaction that moves a request to a shipped
// status. It never creates a second open batch for the same request, and
// never a second message for the same person.
func (s *Service) Start(ctx context.Context, tx pgx.Tx, q *dbgen.Queries, t store.Tenant, requestID uuid.UUID) (Summary, error) {
	var sum Summary
	reqs, err := q.ListRequesters(ctx, dbgen.ListRequestersParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
	if err != nil {
		return sum, err
	}
	anon, err := q.CountAnonymousEvidence(ctx, dbgen.CountAnonymousEvidenceParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
	if err != nil {
		return sum, err
	}
	sum.AnonymousQuotes = int(anon)

	var noteID uuid.NullUUID
	if n, err := q.GetLinkedNoteForRequest(ctx, dbgen.GetLinkedNoteForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID}); err == nil {
		noteID = uuid.NullUUID{UUID: n.ID, Valid: true}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return sum, err
	}

	// People we can actually write to.
	type target struct {
		id       uuid.UUID
		email    string
		evidence []uuid.UUID
	}
	var targets []target
	for _, r := range reqs {
		if !r.Email.Valid || strings.TrimSpace(r.Email.String) == "" {
			sum.NoEmail++
			continue
		}
		targets = append(targets, target{r.ID, strings.ToLower(r.Email.String), r.EvidenceIds})
	}
	if len(targets) == 0 {
		return sum, nil // nobody to write to: no batch, nothing to review
	}

	batch, err := q.InsertBatch(ctx, dbgen.InsertBatchParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, ReleaseNoteID: noteID, CreatedBy: t.UserID})
	if errors.Is(err, pgx.ErrNoRows) { // an open batch already exists (the event was replayed)
		batch, err = q.GetOpenBatchForRequest(ctx, dbgen.GetOpenBatchForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
	}
	if err != nil {
		return sum, err
	}
	sum.BatchID = batch.ID

	drafting := 0
	for _, tg := range targets {
		isSuppressed, err := suppressed(ctx, q, s.HashKey, t.WorkspaceID, tg.email)
		if err != nil {
			return sum, err
		}
		state := "drafting"
		if isSuppressed {
			state = "suppressed"
		}
		id, err := q.InsertMessage(ctx, dbgen.InsertMessageParams{
			WorkspaceID: t.WorkspaceID, BatchID: batch.ID, RequestID: requestID, PersonID: tg.id, ToEmail: tg.email, EvidenceIds: tg.evidence, State: state})
		if errors.Is(err, pgx.ErrNoRows) {
			sum.AlreadyContacted++ // this person already has a message for this request
			continue
		}
		if err != nil {
			return sum, err
		}
		if isSuppressed {
			sum.Suppressed++
			continue
		}
		sum.WillContact++
		drafting++
		if _, err := s.Jobs.InsertTx(ctx, tx, DraftArgs{WorkspaceID: t.WorkspaceID, MessageID: id, UserID: t.UserID}, nil); err != nil {
			return sum, fmt.Errorf("enqueue draft: %w", err)
		}
	}
	if drafting == 0 && batch.State == "drafting" {
		if err := q.SetBatchState(ctx, dbgen.SetBatchStateParams{WorkspaceID: t.WorkspaceID, ID: batch.ID, State: "review"}); err != nil {
			return sum, err
		}
	}
	return sum, nil
}

// CancelOpenForRequest withdraws a batch that has not been approved yet, for
// example when a request is moved back out of "shipped".
func (s *Service) CancelOpenForRequest(ctx context.Context, q *dbgen.Queries, t store.Tenant, requestID uuid.UUID) error {
	b, err := q.GetOpenBatchForRequest(ctx, dbgen.GetOpenBatchForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if b.State == "approved" {
		return nil // already approved: messages are on their way and cannot be recalled
	}
	// Unsent drafts are removed, not kept: if the request ships again later, the
	// same people must be able to get a fresh draft.
	if err := q.DeleteUnsentMessagesInBatch(ctx, dbgen.DeleteUnsentMessagesInBatchParams{WorkspaceID: t.WorkspaceID, BatchID: b.ID}); err != nil {
		return err
	}
	return q.SetBatchState(ctx, dbgen.SetBatchStateParams{WorkspaceID: t.WorkspaceID, ID: b.ID, State: "cancelled"})
}

func (s *Service) List(ctx context.Context, t store.Tenant, states []string, limit int) ([]BatchRow, error) {
	if len(states) == 0 {
		states = []string{"drafting", "review", "approved"}
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	var out []BatchRow
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListBatches(ctx, dbgen.ListBatchesParams{WorkspaceID: t.WorkspaceID, States: states, PageSize: int32(limit)})
		for _, r := range rows {
			out = append(out, BatchRow{ID: r.ID, RequestID: r.RequestID, RequestTitle: r.RequestTitle, State: r.State, MessageCount: int(r.MessageCount), ReadyToSend: int(r.ReadyToSend), LeftOut: int(r.LeftOut), Failed: int(r.Failed), CreatedAt: r.CreatedAt})
		}
		return err
	})
	return out, err
}

func (s *Service) Get(ctx context.Context, t store.Tenant, batchID uuid.UUID) (BatchView, error) {
	var v BatchView
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		b, err := q.GetBatch(ctx, dbgen.GetBatchParams{WorkspaceID: t.WorkspaceID, ID: batchID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		req, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: b.RequestID})
		if err != nil {
			return err
		}
		v = BatchView{ID: b.ID, RequestID: b.RequestID, RequestTitle: req.Title, State: b.State, CreatedAt: b.CreatedAt}
		msgs, err := q.ListBatchMessages(ctx, dbgen.ListBatchMessagesParams{WorkspaceID: t.WorkspaceID, BatchID: batchID})
		if err != nil {
			return err
		}
		for _, m := range msgs {
			mv := MessageView{ID: m.ID, PersonID: m.PersonID, PersonName: m.PersonName, ToEmail: m.ToEmail, State: m.State, Subject: m.Subject, Body: m.Body,
				Edited: m.State != "drafting" && (m.Subject != m.GeneratedSubject || m.Body != m.GeneratedBody)}
			if m.AccountName.Valid {
				mv.AccountName = m.AccountName.String
			}
			if m.DraftedBy.Valid {
				mv.DraftedBy = m.DraftedBy.String
			}
			if m.SentAt.Valid {
				at := m.SentAt.Time
				mv.SentAt = &at
			}
			if m.LastErrorClass.Valid {
				mv.Error = m.LastErrorClass.String
			}
			evs, err := q.ListEvidenceByIDs(ctx, dbgen.ListEvidenceByIDsParams{WorkspaceID: t.WorkspaceID, Ids: m.EvidenceIds})
			if err != nil {
				return err
			}
			for _, e := range evs {
				mv.Quotes = append(mv.Quotes, QuoteView{EvidenceID: e.ID, Text: e.QuoteText})
			}
			if m.State == "draft" {
				v.ReadyToSend++
			}
			v.Messages = append(v.Messages, mv)
		}
		// People the request cannot reach, so nobody assumes they were told.
		reqs, err := q.ListRequesters(ctx, dbgen.ListRequestersParams{WorkspaceID: t.WorkspaceID, RequestID: b.RequestID})
		if err != nil {
			return err
		}
		for _, r := range reqs {
			if !r.Email.Valid || strings.TrimSpace(r.Email.String) == "" {
				v.NoEmail++
			}
		}
		anon, err := q.CountAnonymousEvidence(ctx, dbgen.CountAnonymousEvidenceParams{WorkspaceID: t.WorkspaceID, RequestID: b.RequestID})
		v.Anonymous = int(anon)
		return err
	})
	return v, err
}

// EditMessage changes the subject and body of a draft. Only drafts in a batch
// still under review can be edited.
func (s *Service) EditMessage(ctx context.Context, t store.Tenant, messageID uuid.UUID, subject, body string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	subject, body = strings.TrimSpace(subject), strings.TrimSpace(body)
	if subject == "" || utf8.RuneCountInString(subject) > 200 || strings.ContainsAny(subject, "\r\n") {
		return ErrInvalid("the subject must be one line of 1 to 200 characters")
	}
	if body == "" || utf8.RuneCountInString(body) > 4000 {
		return ErrInvalid("the message must be 1 to 4,000 characters")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.EditMessage(ctx, dbgen.EditMessageParams{WorkspaceID: t.WorkspaceID, ID: messageID, Subject: subject, Body: body})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		return nil
	})
}

// SendTest sends one draft to the signed-in person, never to the customer. It exists so a
// reviewer can see the real thing in an inbox before approving; it never changes message state.
func (s *Service) SendTest(ctx context.Context, t store.Tenant, messageID uuid.UUID, to, inputSubject, inputBody string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	to = strings.TrimSpace(to)
	if to == "" || strings.ContainsAny(to, "\r\n") {
		return ErrInvalid("there is no verified email address to send the test to")
	}
	if s.Mail == nil || s.FromAddress == "" {
		return ErrEmailNotConfigured
	}
	inputSubject, inputBody = strings.TrimSpace(inputSubject), strings.TrimSpace(inputBody)
	if inputSubject != "" || inputBody != "" {
		if inputSubject == "" || utf8.RuneCountInString(inputSubject) > 200 || strings.ContainsAny(inputSubject, "\r\n") {
			return ErrInvalid("the subject must be one line of 1 to 200 characters")
		}
		if inputBody == "" || utf8.RuneCountInString(inputBody) > 4000 {
			return ErrInvalid("the message must be 1 to 4,000 characters")
		}
	}
	var subject, body, fromName string
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMessage(ctx, dbgen.GetMessageParams{WorkspaceID: t.WorkspaceID, ID: messageID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.State != "draft" {
			return ErrConflict
		}
		ws, err := q.GetWorkspaceSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		subject, body, fromName = m.Subject, m.Body, senderName(ws.SenderName, ws.Name)
		if inputSubject != "" && inputBody != "" {
			subject, body = inputSubject, inputBody
		}
		return nil
	})
	if err != nil {
		return err
	}
	_, sendErr := s.Mail.Send(ctx, email.Message{
		From:    fmt.Sprintf("%s <%s>", fromName, s.FromAddress),
		ReplyTo: s.ReplyTo,
		To:      []string{to},
		Subject: "[Test] " + subject,
		Text:    body + "\n\n--\nThis is a test sent to you. The email to the customer also ends with a link they can use to stop updates.",
		// A test is deliberately repeatable: a stable key would make the provider drop the second one.
		IdempotencyKey: fmt.Sprintf("outreach-test-%s-%d", messageID, time.Now().UnixNano()),
		Tags:           map[string]string{"kind": "outreach_test"},
	})
	if errors.Is(sendErr, email.ErrTransient) || errors.Is(sendErr, email.ErrPermanent) {
		return ErrSendFailed
	}
	return sendErr
}

func (s *Service) Exclude(ctx context.Context, t store.Tenant, messageID uuid.UUID) error {
	return s.toggle(ctx, t, messageID, true)
}

func (s *Service) Include(ctx context.Context, t store.Tenant, messageID uuid.UUID) error {
	return s.toggle(ctx, t, messageID, false)
}

func (s *Service) toggle(ctx context.Context, t store.Tenant, messageID uuid.UUID, exclude bool) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var n int64
		var err error
		if exclude {
			n, err = q.ExcludeMessage(ctx, dbgen.ExcludeMessageParams{WorkspaceID: t.WorkspaceID, ID: messageID})
		} else {
			n, err = q.IncludeMessage(ctx, dbgen.IncludeMessageParams{WorkspaceID: t.WorkspaceID, ID: messageID})
		}
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		return nil
	})
}

// Approve is the one decision that lets mail leave the building. Every draft
// that is still a draft becomes approved, recorded against the approver, and
// one send job is queued per message in the same transaction.
func (s *Service) Approve(ctx context.Context, t store.Tenant, batchID uuid.UUID) (queued int, err error) {
	if !t.CanWrite() {
		return 0, store.ErrForbidden
	}
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		b, err := q.GetBatchForUpdate(ctx, dbgen.GetBatchForUpdateParams{WorkspaceID: t.WorkspaceID, ID: batchID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		switch b.State {
		case "drafting":
			return ErrStillDrafting
		case "review":
		default:
			return ErrConflict // already approved, finished or cancelled
		}
		ids, err := q.ApproveDraftMessages(ctx, dbgen.ApproveDraftMessagesParams{WorkspaceID: t.WorkspaceID, BatchID: batchID, ApprovedBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return ErrNothingToSend
		}
		if err := q.ApproveBatch(ctx, dbgen.ApproveBatchParams{WorkspaceID: t.WorkspaceID, ID: batchID, ApprovedBy: uuid.NullUUID{UUID: t.UserID, Valid: true}}); err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := s.Jobs.InsertTx(ctx, tx, SendArgs{WorkspaceID: t.WorkspaceID, MessageID: id, UserID: t.UserID}, nil); err != nil {
				return fmt.Errorf("enqueue send: %w", err)
			}
		}
		queued = len(ids)
		return nil
	})
	return queued, err
}

// Cancel withdraws a batch that has not been approved.
func (s *Service) Cancel(ctx context.Context, t store.Tenant, batchID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		b, err := q.GetBatchForUpdate(ctx, dbgen.GetBatchForUpdateParams{WorkspaceID: t.WorkspaceID, ID: batchID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if b.State != "drafting" && b.State != "review" {
			return ErrConflict
		}
		if err := q.DeleteUnsentMessagesInBatch(ctx, dbgen.DeleteUnsentMessagesInBatchParams{WorkspaceID: t.WorkspaceID, BatchID: batchID}); err != nil {
			return err
		}
		return q.SetBatchState(ctx, dbgen.SetBatchStateParams{WorkspaceID: t.WorkspaceID, ID: batchID, State: "cancelled"})
	})
}

// RetryFailed puts one failed message back in the queue (it was approved before).
func (s *Service) RetryFailed(ctx context.Context, t store.Tenant, messageID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		n, err := q.RetryFailedMessage(ctx, dbgen.RetryFailedMessageParams{WorkspaceID: t.WorkspaceID, ID: messageID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		_, err = s.Jobs.InsertTx(ctx, tx, SendArgs{WorkspaceID: t.WorkspaceID, MessageID: messageID, UserID: t.UserID}, nil)
		return err
	})
}

// RecordSuppression stops all further email to an address, whatever the reason,
// and withdraws anything pending for it. Used by unsubscribe links and, later,
// bounce and complaint notifications.
func (s *Service) RecordSuppression(ctx context.Context, workspaceID uuid.UUID, email, reason string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return ErrInvalid("an email address is required")
	}
	t := store.Tenant{WorkspaceID: workspaceID, UserID: uuid.Nil, Role: store.RoleMember}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if err := q.UpsertSuppression(ctx, dbgen.UpsertSuppressionParams{WorkspaceID: workspaceID, Email: email, Reason: reason}); err != nil {
			return err
		}
		if err := q.SuppressPendingSurveyInvitesForEmail(ctx, dbgen.SuppressPendingSurveyInvitesForEmailParams{WorkspaceID: workspaceID, ToEmail: email}); err != nil {
			return err
		}
		batches, err := q.SuppressPendingMessagesForEmail(ctx, dbgen.SuppressPendingMessagesForEmailParams{WorkspaceID: workspaceID, ToEmail: email})
		if err != nil {
			return err
		}
		// Withdrawing the last waiting message can finish an approved batch.
		seen := map[uuid.UUID]bool{}
		for _, b := range batches {
			if !seen[b] {
				seen[b] = true
				if err := finishBatchIfDone(ctx, q, t, b); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func pgText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

// AddressFor is the email address a verified unsubscribe token refers to. A
// message that no longer exists (its person was deleted) is a bad link.
func (s *Service) AddressFor(ctx context.Context, u Unsubscriber, token string) (workspaceID uuid.UUID, email string, err error) {
	ws, msg, err := u.Verify(token)
	if err != nil {
		return uuid.Nil, "", err
	}
	t := store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, gerr := q.GetMessage(ctx, dbgen.GetMessageParams{WorkspaceID: ws, ID: msg})
		if errors.Is(gerr, pgx.ErrNoRows) {
			// Not a message about a request: it may be a survey invitation (same kind of link).
			if addr, ierr := q.GetSurveyInviteAddress(ctx, dbgen.GetSurveyInviteAddressParams{WorkspaceID: ws, ID: msg}); ierr == nil {
				email = addr
				return nil
			}
		}
		if gerr != nil {
			// The message is gone (its person was deleted). A tombstone means the link was real.
			if _, terr := q.GetTombstone(ctx, dbgen.GetTombstoneParams{WorkspaceID: ws, MessageID: msg}); terr != nil {
				return ErrBadToken
			}
			return nil // genuine link, no address left to show
		}
		email = m.ToEmail
		return nil
	})
	return ws, email, err
}

// Unsubscribe handles a click on the link at the bottom of an email. The token
// proves which message, in which workspace, it was issued for.
func (s *Service) Unsubscribe(ctx context.Context, u Unsubscriber, token string) error {
	ws, addr, err := s.AddressFor(ctx, u, token)
	if err != nil {
		return err
	}
	if addr == "" { // the person was deleted: opt out by fingerprint
		_, msg, _ := u.Verify(token)
		t := store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
		return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
			h, err := q.GetTombstone(ctx, dbgen.GetTombstoneParams{WorkspaceID: ws, MessageID: msg})
			if err != nil {
				return ErrBadToken
			}
			return q.UpsertSuppressionHash(ctx, dbgen.UpsertSuppressionHashParams{WorkspaceID: ws, EmailHash: h, Reason: "unsubscribed"})
		})
	}
	return s.RecordSuppression(ctx, ws, addr, "unsubscribed")
}
