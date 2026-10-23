package outreach

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/ai"
	"product/api/internal/email"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ---------------------------------------------------------------- drafting

// DraftWorker writes one draft. If the model cannot produce a safe message it
// falls back to a plain, honest template rather than leaving the person empty
// handed or, worse, passing an unsafe message on.
type DraftWorker struct {
	river.WorkerDefaults[DraftArgs]
	Pool      *pgxpool.Pool
	Completer Completer // nil means: always use the plain template
}

func (w *DraftWorker) Work(ctx context.Context, job *river.Job[DraftArgs]) error {
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}
	ctx = store.WithContext(ctx, t) // so the AI event recorder writes to this workspace

	var in Input
	var state string
	var batchID uuid.UUID
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMessage(ctx, dbgen.GetMessageParams{WorkspaceID: t.WorkspaceID, ID: a.MessageID})
		if err != nil {
			return err
		}
		state, batchID = m.State, m.BatchID
		if m.State != "drafting" {
			return nil
		}
		b, err := q.GetBatch(ctx, dbgen.GetBatchParams{WorkspaceID: t.WorkspaceID, ID: m.BatchID})
		if err != nil {
			return err
		}
		req, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: m.RequestID})
		if err != nil {
			return err
		}
		p, err := q.GetPersonBasics(ctx, dbgen.GetPersonBasicsParams{WorkspaceID: t.WorkspaceID, ID: m.PersonID})
		if err != nil {
			return err
		}
		evs, err := q.ListEvidenceByIDs(ctx, dbgen.ListEvidenceByIDsParams{WorkspaceID: t.WorkspaceID, Ids: m.EvidenceIds})
		if err != nil {
			return err
		}
		ws, err := q.GetWorkspaceSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		names, err := q.ListWorkspaceNamesForGuard(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		in = Input{FirstName: FirstName(p.Name), Title: req.Title, SenderName: senderName(ws.SenderName, ws.Name)}
		for _, e := range evs {
			in.Quotes = append(in.Quotes, e.QuoteText)
		}
		if b.ReleaseNoteID.Valid {
			if title, err := q.GetNoteTitle(ctx, dbgen.GetNoteTitleParams{WorkspaceID: t.WorkspaceID, ID: b.ReleaseNoteID.UUID}); err == nil {
				in.NoteTitle = title
			}
		}
		// Never mention anyone but this recipient and their own company.
		own := strings.ToLower(p.Name) + "|" + strings.ToLower(p.AccountName.String)
		for _, n := range names {
			if n != "" && !strings.Contains(own, n) {
				in.Forbidden = append(in.Forbidden, n)
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("load message: %w", err)
	}
	if state != "drafting" {
		return nil // already drafted, approved or withdrawn
	}

	draft, by := Fallback(in), "fallback"
	if verr := Validate(draft.Subject, draft.Body, in); verr != nil { // a title can carry a link or an address
		draft, by = Plain(in), "fallback"
	}
	if w.Completer != nil {
		d, genErr := Generate(ctx, w.Completer, in)
		switch {
		case genErr == nil:
			draft, by = d, "model"
		case errors.Is(genErr, ai.ErrNoRoute) || errors.Is(genErr, ai.ErrBudgetExceeded) || errors.Is(genErr, ai.ErrInvalidOutput) || errors.Is(genErr, ai.ErrRefused) || errors.Is(genErr, ai.ErrBadRequest):
			// Not worth retrying: use the plain template and let a person improve it.
		case ctx.Err() != nil:
			return ctx.Err()
		default:
			if job.Attempt < job.MaxAttempts {
				return fmt.Errorf("draft: %w", genErr) // provider trouble: try again later
			}
		}
	}
	return store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		if err := q.SetMessageDraft(ctx, dbgen.SetMessageDraftParams{WorkspaceID: t.WorkspaceID, ID: a.MessageID, Subject: draft.Subject, Body: draft.Body, DraftedBy: pgText(by)}); err != nil {
			return err
		}
		return moveToReviewIfDrafted(ctx, q, t, batchID)
	})
}

// moveToReviewIfDrafted locks the batch first so two drafts finishing at the
// same moment queue up; the second one then sees the first one's result and
// moves the batch on. Counting before locking would let both see the other as
// still being written and leave the batch stuck.
func moveToReviewIfDrafted(ctx context.Context, q *dbgen.Queries, t store.Tenant, batchID uuid.UUID) error {
	b, err := q.GetBatchForUpdate(ctx, dbgen.GetBatchForUpdateParams{WorkspaceID: t.WorkspaceID, ID: batchID})
	if err != nil {
		return err
	}
	if b.State != "drafting" {
		return nil
	}
	counts, err := q.CountBatchMessagesByState(ctx, dbgen.CountBatchMessagesByStateParams{WorkspaceID: t.WorkspaceID, BatchID: batchID})
	if err != nil {
		return err
	}
	for _, c := range counts {
		if c.State == "drafting" && c.N > 0 {
			return nil
		}
	}
	return q.SetBatchState(ctx, dbgen.SetBatchStateParams{WorkspaceID: t.WorkspaceID, ID: batchID, State: "review"})
}

func senderName(configured, workspaceName string) string {
	for _, s := range []string{configured, workspaceName} {
		if c := cleanLine(s); c != "" {
			return c
		}
	}
	return "The team"
}

// ----------------------------------------------------------------- sending

// SendWorker is the only code in the product that emails a customer about a
// request. It refuses everything that has not been approved by a person, never
// sends twice, and never writes to an address that asked not to be contacted.
type SendWorker struct {
	river.WorkerDefaults[SendArgs]
	Pool        *pgxpool.Pool
	Sender      email.Sender // nil: email is not configured, so nothing is ever claimed
	FromAddress string       // verified sending address, e.g. updates@mail.example.com
	ReplyTo     string
	Unsub       Unsubscriber
}

var errNotConfigured = errors.New("outreach: email is not configured")

func (w *SendWorker) Work(ctx context.Context, job *river.Job[SendArgs]) error {
	if w.Sender == nil || w.FromAddress == "" || len(w.Unsub.Secret) == 0 {
		return errNotConfigured // leaves the message approved; it is retried once configured
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}

	// 1. Claim: only a message that a person approved can move to "sending", and
	//    only one worker can win it. Everything else is a no-op.
	var msg dbgen.OutreachMessage
	var subject, body, fromName string
	claimed := false
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.ClaimMessageForSend(ctx, dbgen.ClaimMessageForSendParams{WorkspaceID: t.WorkspaceID, ID: a.MessageID})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		isSuppressed, err := suppressed(ctx, q, w.Unsub.Secret, t.WorkspaceID, m.ToEmail)
		if err != nil {
			return err
		}
		if isSuppressed {
			if err := q.SetMessageSuppressed(ctx, dbgen.SetMessageSuppressedParams{WorkspaceID: t.WorkspaceID, ID: m.ID}); err != nil {
				return err
			}
			return finishBatchIfDone(ctx, q, t, m.BatchID)
		}
		ws, err := q.GetWorkspaceSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		msg, subject, body, fromName, claimed = m, m.Subject, m.Body, senderName(ws.SenderName, ws.Name), true
		return nil
	})
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}

	// 2. Send, outside any transaction. The provider de-duplicates on the key,
	//    so a crash between sending and recording cannot cause a second email.
	footer := "\n\n--\nYou are receiving this because you asked us for this. To stop getting updates like this, unsubscribe: " + w.Unsub.URL(t.WorkspaceID, msg.ID)
	link := "<" + w.Unsub.URL(t.WorkspaceID, msg.ID) + ">"
	providerID, sendErr := w.Sender.Send(ctx, email.Message{
		From: fmt.Sprintf("%s <%s>", fromName, w.FromAddress), ReplyTo: w.ReplyTo, To: []string{msg.ToEmail},
		Subject: subject, Text: body + footer, IdempotencyKey: "outreach-" + msg.ID.String(),
		Tags:    map[string]string{"kind": "loop_closing"},
		Headers: map[string]string{"List-Unsubscribe": link, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
	})

	// 3. Record the outcome. A failure to send is recorded and committed first;
	//    only then is the error returned so River retries. (Returning it from
	//    inside the transaction would roll the record back.)
	rec := context.WithoutCancel(ctx) // a cancelled request must not lose the record of an email already sent
	var retryErr error
	err = store.WithTenant(rec, w.Pool, t, func(q *dbgen.Queries) error {
		switch {
		case sendErr == nil:
			if err := q.MarkMessageSent(rec, dbgen.MarkMessageSentParams{WorkspaceID: t.WorkspaceID, ID: msg.ID, ProviderMessageID: pgText(providerID)}); err != nil {
				return err
			}
			return finishBatchIfDone(rec, q, t, msg.BatchID)
		case errors.Is(sendErr, email.ErrTransient):
			if err := q.ReleaseMessageForRetry(rec, dbgen.ReleaseMessageForRetryParams{WorkspaceID: t.WorkspaceID, ID: msg.ID, LastErrorClass: pgText("transient")}); err != nil {
				return err
			}
			retryErr = fmt.Errorf("send: %w", sendErr)
			return nil
		default:
			if err := q.MarkMessageFailed(rec, dbgen.MarkMessageFailedParams{WorkspaceID: t.WorkspaceID, ID: msg.ID, LastErrorClass: pgText("rejected")}); err != nil {
				return err
			}
			return finishBatchIfDone(rec, q, t, msg.BatchID)
		}
	})
	if err != nil {
		return err
	}
	return retryErr
}

// finishBatchIfDone closes an approved batch once nothing is waiting to go out.
func finishBatchIfDone(ctx context.Context, q *dbgen.Queries, t store.Tenant, batchID uuid.UUID) error {
	b, err := q.GetBatchForUpdate(ctx, dbgen.GetBatchForUpdateParams{WorkspaceID: t.WorkspaceID, ID: batchID})
	if err != nil || b.State != "approved" {
		return err
	}
	counts, err := q.CountBatchMessagesByState(ctx, dbgen.CountBatchMessagesByStateParams{WorkspaceID: t.WorkspaceID, BatchID: batchID})
	if err != nil {
		return err
	}
	for _, c := range counts {
		if (c.State == "approved" || c.State == "sending") && c.N > 0 {
			return nil
		}
	}
	return q.SetBatchState(ctx, dbgen.SetBatchStateParams{WorkspaceID: t.WorkspaceID, ID: batchID, State: "done"})
}
