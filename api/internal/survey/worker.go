package survey

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/email"
	"product/api/internal/intake"
	"product/api/internal/outreach"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// InviteMessage is the wording of every invitation. It is fixed text (no model writes it), so what a person
// approves is exactly what goes out, apart from the link.
func InviteMessage(sender, title, intro, link string) (subject, body string) {
	subject = fmt.Sprintf("%s would like your feedback: %s", sender, title)
	if utf8.RuneCountInString(subject) > 200 {
		subject = string([]rune(subject)[:200])
	}
	var b strings.Builder
	b.WriteString("Hello,\n\n")
	if strings.TrimSpace(intro) != "" {
		b.WriteString(strings.TrimSpace(intro) + "\n\n")
	} else {
		b.WriteString(sender + " would like to hear from you.\n\n")
	}
	b.WriteString("Your answers: " + link + "\n")
	return subject, b.String()
}

// SendWorker sends one approved invitation. It refuses anything a person has not approved, never sends twice,
// never writes to an address that asked not to be contacted, and does nothing for a survey that is not open.
type SendWorker struct {
	river.WorkerDefaults[SendArgs]
	Pool        *pgxpool.Pool
	Sender      email.Sender // nil: email is not configured, so nothing is ever claimed
	FromAddress string
	ReplyTo     string
	Unsub       outreach.Unsubscriber
	Links       Links
}

var errNotConfigured = errors.New("survey: email is not configured")

func (w *SendWorker) Work(ctx context.Context, job *river.Job[SendArgs]) error {
	if w.Sender == nil || w.FromAddress == "" || len(w.Unsub.Secret) == 0 || len(w.Links.Secret) == 0 {
		return errNotConfigured // leaves the invitation approved; it is retried once configured
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}

	// 1. Claim: only an approved invitation of an open survey moves to "sending", and only one worker wins it.
	var inv dbgen.SurveyInvite
	var subject, body, fromName string
	claimed := false
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.ClaimSurveyInviteForSend(ctx, dbgen.ClaimSurveyInviteForSendParams{WorkspaceID: t.WorkspaceID, ID: a.InviteID})
		if errors.Is(err, pgx.ErrNoRows) {
			// Not claimable. If the survey was closed meanwhile, say so rather than leaving it waiting.
			return q.ExcludeApprovedInvitesOfClosedSurvey(ctx, dbgen.ExcludeApprovedInvitesOfClosedSurveyParams{WorkspaceID: t.WorkspaceID, ID: a.InviteID})
		}
		if err != nil {
			return err
		}
		if sup, err := outreach.Suppressed(ctx, q, w.Unsub.Secret, t.WorkspaceID, m.ToEmail); err != nil {
			return err
		} else if sup {
			return q.SetSurveyInviteSuppressed(ctx, dbgen.SetSurveyInviteSuppressedParams{WorkspaceID: t.WorkspaceID, ID: m.ID})
		}
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: t.WorkspaceID, ID: m.SurveyID})
		if err != nil {
			return err
		}
		ws, err := q.GetWorkspaceSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		fromName = ws.SenderName
		if fromName == "" {
			fromName = ws.Name
		}
		subject, body = InviteMessage(fromName, sv.Title, sv.Intro, w.Links.URL(w.Links.InviteToken(t.WorkspaceID, m.ID)))
		inv, claimed = m, true
		return nil
	})
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}

	// 2. Send, outside any transaction. The provider de-duplicates on the key, so a crash between sending and
	//    recording cannot cause a second email.
	unsub := w.Unsub.URL(t.WorkspaceID, inv.ID)
	footer := "\n--\nYou are receiving this because you are a customer of " + fromName + ". To stop getting emails like this, unsubscribe: " + unsub
	providerID, sendErr := w.Sender.Send(ctx, email.Message{
		From: fmt.Sprintf("%s <%s>", fromName, w.FromAddress), ReplyTo: w.ReplyTo, To: []string{inv.ToEmail},
		Subject: subject, Text: body + footer, IdempotencyKey: "survey-invite-" + inv.ID.String(),
		Tags:    map[string]string{"kind": "survey_invite"},
		Headers: map[string]string{"List-Unsubscribe": "<" + unsub + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
	})

	// 3. Record the outcome first, then return any error so River retries.
	rec := context.WithoutCancel(ctx)
	var retryErr error
	err = store.WithTenant(rec, w.Pool, t, func(q *dbgen.Queries) error {
		switch {
		case sendErr == nil:
			return q.MarkSurveyInviteSent(rec, dbgen.MarkSurveyInviteSentParams{WorkspaceID: t.WorkspaceID, ID: inv.ID, ProviderMessageID: pgtype.Text{String: providerID, Valid: providerID != ""}})
		case errors.Is(sendErr, email.ErrTransient):
			retryErr = fmt.Errorf("send: %w", sendErr)
			return q.ReleaseSurveyInviteForRetry(rec, dbgen.ReleaseSurveyInviteForRetryParams{WorkspaceID: t.WorkspaceID, ID: inv.ID, LastErrorClass: pgtype.Text{String: "transient", Valid: true}})
		default:
			return q.MarkSurveyInviteFailed(rec, dbgen.MarkSurveyInviteFailedParams{WorkspaceID: t.WorkspaceID, ID: inv.ID, LastErrorClass: pgtype.Text{String: "rejected", Valid: true}})
		}
	})
	if err != nil {
		return err
	}
	return retryErr
}

// EvidenceWorker turns a finished response's free text into a source item, so the usual review queue can turn it
// into cited evidence. Running it twice stores the text once.
type EvidenceWorker struct {
	river.WorkerDefaults[EvidenceArgs]
	Pool   *pgxpool.Pool
	Intake *intake.Service
}

func (w *EvidenceWorker) Work(ctx context.Context, job *river.Job[EvidenceArgs]) error {
	if w.Intake == nil {
		return errors.New("survey: intake is not configured")
	}
	a := job.Args
	t := systemTenant(a.WorkspaceID)
	var text, title string
	var person *uuid.UUID
	var skip bool
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		resp, err := q.GetSurveyResponseForUpdate(ctx, dbgen.GetSurveyResponseForUpdateParams{WorkspaceID: a.WorkspaceID, ID: a.ResponseID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (resp.State != "complete" || resp.SourceItemID.Valid)) {
			skip = true // deleted meanwhile (its person was erased), unfinished, or already done
			return nil
		}
		if err != nil {
			return err
		}
		sv, err := q.GetSurvey(ctx, dbgen.GetSurveyParams{WorkspaceID: a.WorkspaceID, ID: resp.SurveyID})
		if err != nil {
			return err
		}
		qs, err := q.ListSurveyQuestions(ctx, dbgen.ListSurveyQuestionsParams{WorkspaceID: a.WorkspaceID, SurveyID: resp.SurveyID})
		if err != nil {
			return err
		}
		ans, err := q.ListSurveyAnswers(ctx, dbgen.ListSurveyAnswersParams{WorkspaceID: a.WorkspaceID, ResponseID: resp.ID})
		if err != nil {
			return err
		}
		text = ResponseText(qs, ans)
		title = "Survey: " + sv.Title
		if resp.PersonID.Valid {
			id := resp.PersonID.UUID
			person = &id
		}
		return nil
	})
	if err != nil || skip || text == "" {
		return err
	}
	res, err := w.Intake.IngestPaste(ctx, t, intake.PasteInput{
		Title: truncateRunes(title, 200), Text: text, Kind: "survey", PersonID: person, ExternalID: "survey-response:" + a.ResponseID.String(),
	})
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		return q.SetSurveyResponseSource(ctx, dbgen.SetSurveyResponseSourceParams{WorkspaceID: a.WorkspaceID, ID: a.ResponseID, SourceItemID: uuid.NullUUID{UUID: res.SourceItemID, Valid: true}})
	})
}

// ResponseText is the stored form of a response's free text: each question, then the answer under it. Quotes
// are taken from exactly this text, so it is what "verbatim" is checked against.
func ResponseText(qs []dbgen.SurveyQuestion, ans []dbgen.SurveyAnswer) string {
	byQ := map[uuid.UUID]string{}
	for _, a := range ans {
		if a.ValueText.Valid {
			byQ[a.QuestionID] = a.ValueText.String
		}
	}
	var b strings.Builder
	for _, q := range qs {
		if txt, ok := byQ[q.ID]; ok {
			b.WriteString(q.Prompt + "\n" + txt + "\n\n")
		}
	}
	return strings.TrimSpace(b.String())
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
