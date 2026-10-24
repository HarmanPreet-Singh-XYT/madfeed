package inbox

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/email"
	"product/api/internal/outreach"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ReplyWorker sends one email reply that a teammate wrote and sent. It sends only what a person queued, never
// twice (the provider is given a stable key), and never to an address on the opt-out list (bounced, complained
// or asked not to be written to): that reply is marked failed with the reason, for the team to see.
type ReplyWorker struct {
	river.WorkerDefaults[ReplyArgs]
	Pool        *pgxpool.Pool
	Sender      email.Sender // nil: email is not configured, so nothing is claimed
	FromAddress string
	ReplyTo     string
	HashKey     []byte
}

var errNotConfigured = errors.New("inbox: email is not configured")

func (w *ReplyWorker) Work(ctx context.Context, job *river.Job[ReplyArgs]) error {
	if w.Sender == nil || w.FromAddress == "" {
		return errNotConfigured // the reply stays queued; it is retried once email is set up
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}
	var msg dbgen.ConversationMessage
	var to, subject, fromName string
	claimed := false
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.ClaimReplyForSend(ctx, dbgen.ClaimReplyForSendParams{WorkspaceID: t.WorkspaceID, ID: a.MessageID})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		c, err := q.GetConversation(ctx, dbgen.GetConversationParams{WorkspaceID: t.WorkspaceID, ID: m.ConversationID})
		if err != nil {
			return err
		}
		if !c.CustomerEmail.Valid {
			return q.MarkReplyFailed(ctx, dbgen.MarkReplyFailedParams{WorkspaceID: t.WorkspaceID, ID: m.ID, LastError: pgtype.Text{String: "no email address to reply to", Valid: true}})
		}
		if sup, err := outreach.Suppressed(ctx, q, w.HashKey, t.WorkspaceID, c.CustomerEmail.String); err != nil {
			return err
		} else if sup {
			return q.MarkReplyFailed(ctx, dbgen.MarkReplyFailedParams{WorkspaceID: t.WorkspaceID, ID: m.ID, LastError: pgtype.Text{String: "this address asked not to be emailed, or its mail bounced", Valid: true}})
		}
		ws, err := q.GetWorkspaceSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		fromName = ws.SenderName
		if fromName == "" {
			fromName = ws.Name
		}
		subj := strings.TrimSpace(c.Subject)
		if subj == "" {
			subj = "Your message"
		}
		subject = "Re: " + subj + " [#" + c.Ref + "]"
		to = c.CustomerEmail.String
		msg, claimed = m, true
		return nil
	})
	if err != nil || !claimed {
		return err
	}
	providerID, sendErr := w.Sender.Send(ctx, email.Message{
		From: fmt.Sprintf("%s <%s>", fromName, w.FromAddress), ReplyTo: w.ReplyTo, To: []string{to},
		Subject: subject, Text: msg.Body, IdempotencyKey: "support-reply-" + msg.ID.String(),
		Tags: map[string]string{"kind": "support_reply"},
	})
	rec := context.WithoutCancel(ctx)
	var retryErr error
	err = store.WithTenant(rec, w.Pool, t, func(q *dbgen.Queries) error {
		switch {
		case sendErr == nil:
			return q.MarkReplySent(rec, dbgen.MarkReplySentParams{WorkspaceID: t.WorkspaceID, ID: msg.ID, ProviderMessageID: pgtype.Text{String: providerID, Valid: providerID != ""}})
		case errors.Is(sendErr, email.ErrTransient):
			retryErr = fmt.Errorf("send: %w", sendErr)
			return q.ReleaseReplyForRetry(rec, dbgen.ReleaseReplyForRetryParams{WorkspaceID: t.WorkspaceID, ID: msg.ID, LastError: pgtype.Text{String: "the mail service was busy; trying again", Valid: true}})
		default:
			return q.MarkReplyFailed(rec, dbgen.MarkReplyFailedParams{WorkspaceID: t.WorkspaceID, ID: msg.ID, LastError: pgtype.Text{String: "the mail service refused the message", Valid: true}})
		}
	})
	if err != nil {
		return err
	}
	return retryErr
}
