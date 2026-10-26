package account

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The operator's side: reading the queue and finishing a request. These run with a privileged connection (they
// read across people and workspaces), used only from cmd/accountdeletion, never by the API.

type Pending struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Email       string
	RequestedAt time.Time
	Workspaces  []Membership
}

type Membership struct {
	ID    uuid.UUID
	Name  string
	Role  string
	Alone bool // the only member
	// LastAdmin is true when the person is the workspace's only admin and others would be left without one.
	LastAdmin bool
}

func memberships(ctx context.Context, q pgx.Tx, user uuid.UUID) ([]Membership, error) {
	rows, err := q.Query(ctx, `
		SELECT w.id, w.name, m.role,
		       NOT EXISTS (SELECT 1 FROM member o WHERE o.workspace_id = w.id AND o.user_id <> m.user_id),
		       m.role = 'admin' AND NOT EXISTS (SELECT 1 FROM member o WHERE o.workspace_id = w.id AND o.user_id <> m.user_id AND o.role = 'admin')
		         AND EXISTS (SELECT 1 FROM member o WHERE o.workspace_id = w.id AND o.user_id <> m.user_id)
		FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE m.user_id = $1 ORDER BY w.name`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Membership
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.ID, &m.Name, &m.Role, &m.Alone, &m.LastAdmin); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListOpen is every open request with the workspaces the person belongs to.
func ListOpen(ctx context.Context, pool *pgxpool.Pool) ([]Pending, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT id, user_id, email, requested_at FROM account_deletion_request WHERE status = 'open' ORDER BY requested_at`)
	if err != nil {
		return nil, err
	}
	var out []Pending
	for rows.Next() {
		var p Pending
		if err := rows.Scan(&p.ID, &p.UserID, &p.Email, &p.RequestedAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Workspaces, err = memberships(ctx, tx, out[i].UserID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Complete removes the person from this app and marks the request done. It refuses while the person is the last
// admin of a workspace others use, or the only member of one (that workspace's data would be left with nobody
// to answer for it) unless keepEmptyWorkspaces is set. The sign-in account itself is deleted by the operator in
// the identity service afterwards; the request is the reminder.
func Complete(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, keepEmptyWorkspaces bool) (Pending, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Pending{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var p Pending
	p.ID = id
	err = tx.QueryRow(ctx, `SELECT user_id, email, requested_at FROM account_deletion_request WHERE id = $1 AND status = 'open' FOR UPDATE`, id).Scan(&p.UserID, &p.Email, &p.RequestedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return p, fmt.Errorf("no open request with that id")
		}
		return p, err
	}
	if p.Workspaces, err = memberships(ctx, tx, p.UserID); err != nil {
		return p, err
	}
	var blockers []string
	for _, m := range p.Workspaces {
		switch {
		case m.LastAdmin:
			blockers = append(blockers, fmt.Sprintf("%q: they are its only admin and others use it (make someone else an admin, or have it deleted)", m.Name))
		case m.Alone && !keepEmptyWorkspaces:
			blockers = append(blockers, fmt.Sprintf("%q: they are its only member (have them delete it in Settings, or pass -keep-workspaces to leave its data without an owner)", m.Name))
		}
	}
	if len(blockers) > 0 {
		return p, fmt.Errorf("not done:\n  %s", strings.Join(blockers, "\n  "))
	}
	for _, q := range []string{
		`UPDATE api_key SET revoked_at = now() WHERE created_by = $1 AND revoked_at IS NULL`,
		`UPDATE oauth_grant SET revoked_at = now() WHERE approved_by = $1 AND revoked_at IS NULL`,
		`DELETE FROM request_vote WHERE voter_id = $1`,
		`UPDATE conversation SET assignee = NULL WHERE assignee = $1`,
		`DELETE FROM member WHERE user_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, p.UserID); err != nil {
			return p, err
		}
	}
	// the address is kept only to find the account; once the work is done it goes
	if _, err := tx.Exec(ctx, `UPDATE account_deletion_request SET status = 'done', handled_at = now(), email = '' WHERE id = $1`, id); err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}
