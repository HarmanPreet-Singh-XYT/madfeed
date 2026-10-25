package team

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/email"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// MailArgs asks for one invitation email. Seq changes each time the invitation is sent again, so a resend is a
// new message while a retry of the same send is not.
type MailArgs struct {
	WorkspaceID  uuid.UUID `json:"workspaceId"`
	InvitationID uuid.UUID `json:"invitationId"`
	Seq          int       `json:"seq"`
}

func (MailArgs) Kind() string { return "team_invite_mail" }

// MailWorker sends an invitation to the invited address. The wording is fixed text, so what an admin invited is
// what goes out, apart from the link. Revoked, used and expired invitations send nothing.
type MailWorker struct {
	river.WorkerDefaults[MailArgs]
	Pool        *pgxpool.Pool
	Sender      email.Sender // nil: email is not configured
	FromAddress string
	ReplyTo     string
	Links       Links
}

var errNotConfigured = errors.New("team: email is not configured")

// Message is the invitation's wording.
func Message(workspace, inviter, role, link string) (subject, body string) {
	subject = "You are invited to join " + workspace
	if len([]rune(subject)) > 200 {
		subject = string([]rune(subject)[:200])
	}
	who := inviter
	if who == "" {
		who = "A teammate"
	}
	var b strings.Builder
	b.WriteString("Hello,\n\n")
	b.WriteString(who + " invited you to join the " + workspace + " workspace as " + article(role) + " " + role + ".\n\n")
	b.WriteString("To join, open this link and sign in (or create an account) with this email address:\n" + link + "\n\n")
	b.WriteString("The link works for 7 days. If you were not expecting this, you can ignore this email and nothing will happen.\n")
	return subject, b.String()
}

func article(role string) string {
	if role == "admin" {
		return "an"
	}
	return "a"
}

func (w *MailWorker) Work(ctx context.Context, job *river.Job[MailArgs]) error {
	if w.Sender == nil || w.FromAddress == "" || len(w.Links.Secret) == 0 {
		return errNotConfigured
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: uuid.Nil, Role: store.RoleMember}
	var to, role, wsName, sender, inviter string
	var skip bool
	err := store.WithTenantTx(ctx, w.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		var expires time.Time
		var by uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT email, role, expires_at, created_by FROM invitation
			WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, a.WorkspaceID, a.InvitationID).Scan(&to, &role, &expires, &by)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !expires.After(time.Now())) {
			skip = true
			return nil
		}
		if err != nil {
			return err
		}
		ws, err := q.GetWorkspaceSettings(ctx, a.WorkspaceID)
		if err != nil {
			return err
		}
		wsName, sender = ws.Name, ws.SenderName
		_ = tx.QueryRow(ctx, `SELECT display_name FROM member WHERE workspace_id = $1 AND user_id = $2`, a.WorkspaceID, by).Scan(&inviter)
		return nil
	})
	if err != nil || skip {
		return err
	}
	if sender == "" {
		sender = wsName
	}
	subject, body := Message(wsName, inviter, role, w.Links.URL(w.Links.Token(a.WorkspaceID, a.InvitationID)))
	_, sendErr := w.Sender.Send(ctx, email.Message{
		From: fmt.Sprintf("%s <%s>", sender, w.FromAddress), ReplyTo: w.ReplyTo, To: []string{to},
		Subject: subject, Text: body, IdempotencyKey: fmt.Sprintf("team-invite-%s-%d", a.InvitationID, a.Seq),
		Tags: map[string]string{"kind": "team_invite"},
	})
	switch {
	case sendErr == nil:
		return store.WithTenantTx(context.WithoutCancel(ctx), w.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
			_, err := tx.Exec(ctx, `UPDATE invitation SET last_sent_at = now() WHERE workspace_id = $1 AND id = $2`, a.WorkspaceID, a.InvitationID)
			return err
		})
	case errors.Is(sendErr, email.ErrTransient):
		return fmt.Errorf("send: %w", sendErr)
	default:
		return nil // rejected for good: the admin can copy the link instead
	}
}
