package inbox

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

	"product/api/internal/intake"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ReplyArgs sends one queued email reply.
type ReplyArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	MessageID   uuid.UUID `json:"message_id"`
	UserID      uuid.UUID `json:"user_id"`
}

func (ReplyArgs) Kind() string { return "send_support_reply" }

// ---- views ----

type Summary struct {
	ID            uuid.UUID
	Channel       string
	State         string
	Subject       string
	CustomerName  string
	CustomerEmail string
	PersonID      *uuid.UUID
	Assignee      *uuid.UUID
	Preview       string
	Messages      int
	LastMessageAt time.Time
}

type Message struct {
	ID        uuid.UUID
	Seq       int
	Direction string // in, out, note
	Body      string
	AuthorID  *uuid.UUID
	State     string
	Error     string
	CreatedAt time.Time
	SentOn    bool // this customer message has been sent on to the review queue
	Files     []Attachment
}

// Card is where a message sent on as feedback stands now.
type Card struct {
	MessageID    uuid.UUID
	SourceItemID uuid.UUID
	Stage        string // "processing", "waiting" (suggestions to review), "nothing" or "linked"
	Waiting      int
	Requests     []CardRequest
}

type CardRequest struct {
	ID     uuid.UUID
	Title  string
	Status string
	Bucket string
}

type Conversation struct {
	Summary
	Ref      string
	Thread   []Message
	LastID   uuid.UUID // the newest message; send it back with a reply
	Cards    []Card
	CanReply bool
}

type Filter struct {
	State      string // open, closed or empty for both
	Mine       bool
	Unassigned bool
	AfterAt    *time.Time
	AfterID    *uuid.UUID
	Limit      int
}

func summaryOf(c dbgen.Conversation, preview string) Summary {
	s := Summary{ID: c.ID, Channel: c.Channel, State: c.State, Subject: c.Subject, CustomerName: c.CustomerName, CustomerEmail: c.CustomerEmail.String, Preview: preview, Messages: int(c.MessageCount), LastMessageAt: c.LastMessageAt}
	if c.PersonID.Valid {
		id := c.PersonID.UUID
		s.PersonID = &id
	}
	if c.Assignee.Valid {
		id := c.Assignee.UUID
		s.Assignee = &id
	}
	return s
}

func (s *Service) List(ctx context.Context, t store.Tenant, f Filter) ([]Summary, *Summary, error) {
	if f.State != "" && f.State != "open" && f.State != "closed" {
		return nil, nil, ErrInvalid("unknown state")
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	p := dbgen.ListConversationsParams{WorkspaceID: t.WorkspaceID, State: f.State, Mine: f.Mine, Me: t.UserID, Unassigned: f.Unassigned, PageSize: int32(limit + 1)}
	if f.AfterAt != nil && f.AfterID != nil {
		p.AfterAt = pgtype.Timestamptz{Time: *f.AfterAt, Valid: true}
		p.AfterID = uuid.NullUUID{UUID: *f.AfterID, Valid: true}
	}
	var out []Summary
	var next *Summary
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListConversations(ctx, p)
		if err != nil {
			return err
		}
		more := len(rows) > limit
		if more {
			rows = rows[:limit]
		}
		for _, r := range rows {
			out = append(out, summaryOf(dbgen.Conversation{ID: r.ID, WorkspaceID: r.WorkspaceID, Channel: r.Channel, State: r.State, Subject: r.Subject, CustomerName: r.CustomerName, CustomerEmail: r.CustomerEmail, PersonID: r.PersonID, Assignee: r.Assignee, MessageCount: r.MessageCount, LastMessageAt: r.LastMessageAt}, r.Preview))
		}
		if more {
			l := out[len(out)-1] // the page ends here; the next one starts after this conversation
			next = &l
		}
		return nil
	})
	return out, next, err
}

func (s *Service) Get(ctx context.Context, t store.Tenant, id uuid.UUID) (Conversation, error) {
	var out Conversation
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.GetConversation(ctx, dbgen.GetConversationParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		msgs, err := q.ListConversationMessages(ctx, dbgen.ListConversationMessagesParams{WorkspaceID: t.WorkspaceID, ConversationID: id, Seq: 0})
		if err != nil {
			return err
		}
		links, err := q.ListConversationCards(ctx, dbgen.ListConversationCardsParams{WorkspaceID: t.WorkspaceID, ConversationID: id})
		if err != nil {
			return err
		}
		files, err := filesByMessage(ctx, q, t.WorkspaceID, id)
		if err != nil {
			return err
		}
		out = Conversation{Summary: summaryOf(c, ""), Ref: c.Ref, CanReply: t.CanWrite()}
		sentOn := map[uuid.UUID]bool{}
		byMsg := map[uuid.UUID]*Card{}
		var order []uuid.UUID
		for _, l := range links {
			sentOn[l.MessageID] = true
			card := byMsg[l.MessageID]
			if card == nil {
				card = &Card{MessageID: l.MessageID, SourceItemID: l.SourceItemID, Waiting: int(l.Waiting)}
				switch {
				case l.ProcessingState == "pending" || l.ProcessingState == "processing":
					card.Stage = "processing"
				case l.Waiting > 0:
					card.Stage = "waiting"
				default:
					card.Stage = "nothing"
				}
				byMsg[l.MessageID] = card
				order = append(order, l.MessageID)
			}
			if l.RequestID.Valid {
				card.Stage = "linked"
				card.Requests = append(card.Requests, CardRequest{ID: l.RequestID.UUID, Title: l.RequestTitle.String, Status: l.StatusName.String, Bucket: l.StatusBucket.String})
			}
		}
		for _, id := range order {
			out.Cards = append(out.Cards, *byMsg[id])
		}
		for _, m := range msgs {
			msg := Message{ID: m.ID, Seq: int(m.Seq), Direction: m.Direction, Body: m.Body, State: m.State, Error: m.LastError.String, CreatedAt: m.CreatedAt, SentOn: sentOn[m.ID], Files: files[m.ID]}
			if m.AuthorID.Valid {
				a := m.AuthorID.UUID
				msg.AuthorID = &a
			}
			out.Thread = append(out.Thread, msg)
			out.LastID = m.ID
		}
		return nil
	})
	return out, err
}

// Reply sends the team's answer. seenLast is the newest message the person was looking at: if anything arrived
// since (a customer message, a note, or another teammate's reply) nothing is sent and ErrStale says so, so two
// people cannot answer the same message. A chat reply is visible to the visitor at once; an email reply is
// queued and sent by the worker.
func (s *Service) Reply(ctx context.Context, t store.Tenant, id, seenLast uuid.UUID, body string, files ...uuid.UUID) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	text := NoText
	if strings.TrimSpace(body) != "" || len(files) == 0 {
		var err error
		if text, err = clean(body, MaxReplyText); err != nil {
			return uuid.Nil, err
		}
	}
	var err error
	var msgID uuid.UUID
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		c, err := q.GetConversationForUpdate(ctx, dbgen.GetConversationForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		last, err := q.LastMessageID(ctx, id)
		if err != nil {
			return err
		}
		if last != seenLast {
			return ErrStale
		}
		if len(files) > 0 && c.Channel != "chat" {
			return ErrInvalid("files can be sent in website chat, not by email")
		}
		state := "sent"
		if c.Channel == "email" {
			if !c.CustomerEmail.Valid {
				return ErrInvalid("this conversation has no email address to reply to")
			}
			state = "queued"
		}
		m, err := q.InsertConversationMessage(ctx, dbgen.InsertConversationMessageParams{WorkspaceID: t.WorkspaceID, ConversationID: id, Direction: "out", Body: text, AuthorID: uuid.NullUUID{UUID: t.UserID, Valid: true}, State: state})
		if err != nil {
			return err
		}
		msgID = m.ID
		if err := attach(ctx, tx, t.WorkspaceID, id, m.ID, teamUploader(t.UserID), files); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE conversation SET first_reply_at = now() WHERE workspace_id = $1 AND id = $2 AND first_reply_at IS NULL`, t.WorkspaceID, id); err != nil {
			return err
		}
		if !c.Assignee.Valid {
			if _, err := q.SetConversationAssignee(ctx, dbgen.SetConversationAssigneeParams{WorkspaceID: t.WorkspaceID, ID: id, Assignee: uuid.NullUUID{UUID: t.UserID, Valid: true}}); err != nil {
				return err
			}
		}
		if err := q.TouchConversation(ctx, dbgen.TouchConversationParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		if state == "queued" {
			if _, err := s.Jobs.InsertTx(ctx, tx, ReplyArgs{WorkspaceID: t.WorkspaceID, MessageID: m.ID, UserID: t.UserID}, nil); err != nil {
				return fmt.Errorf("enqueue reply: %w", err)
			}
		}
		return nil
	})
	return msgID, err
}

// Retry puts a reply that failed back in the queue.
func (s *Service) Retry(ctx context.Context, t store.Tenant, messageID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		n, err := q.RequeueFailedReply(ctx, dbgen.RequeueFailedReplyParams{WorkspaceID: t.WorkspaceID, ID: messageID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		_, err = s.Jobs.InsertTx(ctx, tx, ReplyArgs{WorkspaceID: t.WorkspaceID, MessageID: messageID, UserID: t.UserID}, nil)
		return err
	})
}

// Note adds something only the team sees.
func (s *Service) Note(ctx context.Context, t store.Tenant, id uuid.UUID, body string) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	text, err := clean(body, MaxReplyText)
	if err != nil {
		return uuid.Nil, err
	}
	var msgID uuid.UUID
	err = store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		if _, err := q.GetConversationForUpdate(ctx, dbgen.GetConversationForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		m, err := q.InsertConversationMessage(ctx, dbgen.InsertConversationMessageParams{WorkspaceID: t.WorkspaceID, ConversationID: id, Direction: "note", Body: text, AuthorID: uuid.NullUUID{UUID: t.UserID, Valid: true}, State: "noted"})
		if err != nil {
			return err
		}
		msgID = m.ID
		return q.TouchConversation(ctx, dbgen.TouchConversationParams{WorkspaceID: t.WorkspaceID, ID: id})
	})
	return msgID, err
}

// Assign takes a conversation (to = the caller) or lets it go (to = nil). `expected` is who the caller saw as
// the assignee (nil for nobody): if someone else took it meanwhile, ErrStale. Only a person can take it for
// themselves, and only an admin can let go of someone else's.
func (s *Service) Assign(ctx context.Context, t store.Tenant, id uuid.UUID, take bool, expected *uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.GetConversationForUpdate(ctx, dbgen.GetConversationForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		cur := (*uuid.UUID)(nil)
		if c.Assignee.Valid {
			a := c.Assignee.UUID
			cur = &a
		}
		if (cur == nil) != (expected == nil) || (cur != nil && *cur != *expected) {
			return ErrStale
		}
		var to uuid.NullUUID
		if take {
			to = uuid.NullUUID{UUID: t.UserID, Valid: true}
		} else if cur != nil && *cur != t.UserID && t.Role != store.RoleAdmin {
			return store.ErrForbidden
		}
		_, err = q.SetConversationAssignee(ctx, dbgen.SetConversationAssigneeParams{WorkspaceID: t.WorkspaceID, ID: id, Assignee: to})
		return err
	})
}

func (s *Service) SetState(ctx context.Context, t store.Tenant, id uuid.UUID, state string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if state != "open" && state != "closed" {
		return ErrInvalid("unknown state")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.SetConversationState(ctx, dbgen.SetConversationStateParams{WorkspaceID: t.WorkspaceID, ID: id, State: state})
		if err != nil {
			return err
		}
		if n == 0 {
			if _, gerr := q.GetConversation(ctx, dbgen.GetConversationParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(gerr, pgx.ErrNoRows) {
				return ErrNotFound
			}
		}
		return nil
	})
}

// Convert sends a customer's message on to the review queue as feedback from that person. Doing it twice
// stores it once. The conversation then shows where it stands.
func (s *Service) Convert(ctx context.Context, t store.Tenant, id, messageID uuid.UUID) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	var m dbgen.ConversationMessage
	var c dbgen.Conversation
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		if c, err = q.GetConversation(ctx, dbgen.GetConversationParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return ErrNotFound
		}
		if m, err = q.GetConversationMessage(ctx, dbgen.GetConversationMessageParams{WorkspaceID: t.WorkspaceID, ID: messageID}); err != nil || m.ConversationID != id {
			return ErrNotFound
		}
		return nil
	}); err != nil {
		return uuid.Nil, err
	}
	if m.Direction != "in" {
		return uuid.Nil, ErrInvalid("only a customer's message can be sent on as feedback")
	}
	title := "Support: " + strings.TrimSpace(c.Subject)
	if utf8.RuneCountInString(title) > 200 {
		title = string([]rune(title)[:200])
	}
	in := intake.PasteInput{Title: title, Text: m.Body, Kind: "support", ExternalID: "support-message:" + m.ID.String(), SubmitterEmail: c.CustomerEmail.String}
	if c.PersonID.Valid {
		pid := c.PersonID.UUID
		in.PersonID = &pid
	}
	res, err := s.Intake.IngestPaste(ctx, t, in)
	if err != nil {
		return uuid.Nil, err
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.InsertConversationLink(ctx, dbgen.InsertConversationLinkParams{WorkspaceID: t.WorkspaceID, ConversationID: id, MessageID: messageID, SourceItemID: res.SourceItemID, CreatedBy: t.UserID})
	})
	return res.SourceItemID, err
}

// Delete removes a conversation with its messages, and the feedback made from its messages. Admins only.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error { return eraseConversation(ctx, q, t.WorkspaceID, id) })
}

func eraseConversation(ctx context.Context, q *dbgen.Queries, ws, id uuid.UUID) error {
	cards, err := q.ListConversationCards(ctx, dbgen.ListConversationCardsParams{WorkspaceID: ws, ConversationID: id})
	if err != nil {
		return err
	}
	seen := map[uuid.UUID]bool{}
	n, err := q.DeleteConversation(ctx, dbgen.DeleteConversationParams{WorkspaceID: ws, ID: id})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	for _, c := range cards {
		if !seen[c.SourceItemID] {
			seen[c.SourceItemID] = true
			if _, err := q.DeleteSourceItem(ctx, dbgen.DeleteSourceItemParams{WorkspaceID: ws, ID: c.SourceItemID}); err != nil {
				return err
			}
		}
	}
	return nil
}

// ErasePerson is called when a person is deleted, before the person row goes: every conversation with them
// (by their record or by their address) goes, with its messages and the feedback made from them.
func ErasePerson(ctx context.Context, q *dbgen.Queries, ws, person uuid.UUID, email string) error {
	ids, err := q.ConversationIDsForPerson(ctx, dbgen.ConversationIDsForPersonParams{WorkspaceID: ws, PersonID: uuid.NullUUID{UUID: person, Valid: true}, Email: strings.ToLower(email)})
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := eraseConversation(ctx, q, ws, id); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}
