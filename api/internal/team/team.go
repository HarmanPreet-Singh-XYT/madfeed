// Package team lets an admin invite teammates, change their roles and remove them, and lets an invited person
// join. Membership is the only thing here: what a role may do is enforced everywhere else.
package team

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/auth"
	"product/api/internal/cache"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	InviteDays  = 7
	MaxPending  = 50
	MaxMembers  = 200
	emailMaxLen = 320
)

var (
	ErrNotFound   = errors.New("team: not found")
	ErrLastAdmin  = errors.New("team: a workspace needs at least one admin")
	ErrWrongEmail = errors.New("team: that invitation was sent to a different address")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

var emailRe = regexp.MustCompile(`^[^\s@<>,;:"]{1,64}@[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?\.[A-Za-z]{2,63}$`)

type Service struct {
	Pool  *pgxpool.Pool
	Jobs  *river.Client[pgx.Tx]
	Links Links
	// MailEnabled says whether the worker can send email; without it an admin copies the link instead.
	MailEnabled bool
	Now         func() time.Time
	// Cache, when set, holds people's roles for a few seconds (store.ResolveTenantCached); a role change
	// or removal drops the entry as soon as it commits.
	Cache cache.Store
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

type Invitation struct {
	ID         uuid.UUID
	Email      string
	Role       string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastSentAt *time.Time
	Link       string
}

type Result struct {
	Invitation
	EmailQueued bool
}

func validRole(r string) bool { return r == "admin" || r == "member" || r == "viewer" }

func (s *Service) mailArgs(ws, inv uuid.UUID, seq int) MailArgs {
	return MailArgs{WorkspaceID: ws, InvitationID: inv, Seq: seq}
}

// Invite (admins only) invites an address with a role. Inviting an address that already has an open invitation
// updates its role, extends it and sends it again, so there is never more than one.
func (s *Service) Invite(ctx context.Context, t store.Tenant, emailAddr, role string) (Result, error) {
	if !t.Can(store.PermManage) {
		return Result{}, store.ErrForbidden
	}
	e := strings.ToLower(strings.TrimSpace(emailAddr))
	if len(e) > emailMaxLen || !emailRe.MatchString(e) {
		return Result{}, ErrInvalid("that email address does not look right")
	}
	if !validRole(role) {
		return Result{}, ErrInvalid("choose admin, member or viewer")
	}
	var out Result
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var members, pending int
		if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM member WHERE workspace_id = $1), (SELECT count(*) FROM invitation WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())`, t.WorkspaceID).Scan(&members, &pending); err != nil {
			return err
		}
		if members+pending >= MaxMembers {
			return ErrInvalid("this workspace has reached its limit of people")
		}
		expires := s.now().Add(InviteDays * 24 * time.Hour)
		var id uuid.UUID
		var seq int
		err := tx.QueryRow(ctx, `
			UPDATE invitation SET role = $3, expires_at = $4, send_count = send_count + 1
			WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL
			RETURNING id, send_count`, t.WorkspaceID, e, role, expires).Scan(&id, &seq)
		if errors.Is(err, pgx.ErrNoRows) {
			if pending >= MaxPending {
				return ErrInvalid("too many invitations are waiting; revoke some first")
			}
			err = tx.QueryRow(ctx, `
				INSERT INTO invitation (workspace_id, email, role, created_by, expires_at, send_count) VALUES ($1, $2, $3, $4, $5, 1)
				RETURNING id, send_count`, t.WorkspaceID, e, role, t.UserID, expires).Scan(&id, &seq)
		}
		if err != nil {
			return err
		}
		out = Result{Invitation: Invitation{ID: id, Email: e, Role: role, ExpiresAt: expires, CreatedAt: s.now(), Link: s.Links.URL(s.Links.Token(t.WorkspaceID, id))}}
		if s.MailEnabled && s.Jobs != nil {
			if _, err := s.Jobs.InsertTx(ctx, tx, s.mailArgs(t.WorkspaceID, id, seq), nil); err != nil {
				return err
			}
			out.EmailQueued = true
		}
		return nil
	})
	return out, err
}

// Pending (admins only) lists invitations that are neither accepted nor revoked, newest first.
func (s *Service) Pending(ctx context.Context, t store.Tenant) ([]Invitation, error) {
	if !t.Can(store.PermManage) {
		return nil, store.ErrForbidden
	}
	out := []Invitation{}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		rows, err := tx.Query(ctx, `
			SELECT id, email, role, created_at, expires_at, last_sent_at FROM invitation
			WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC, id LIMIT $2`, t.WorkspaceID, MaxPending)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var i Invitation
			if err := rows.Scan(&i.ID, &i.Email, &i.Role, &i.CreatedAt, &i.ExpiresAt, &i.LastSentAt); err != nil {
				return err
			}
			i.Link = s.Links.URL(s.Links.Token(t.WorkspaceID, i.ID))
			out = append(out, i)
		}
		return rows.Err()
	})
	return out, err
}

// Resend (admins only) extends an open invitation and sends it again.
func (s *Service) Resend(ctx context.Context, t store.Tenant, id uuid.UUID) (Result, error) {
	if !t.Can(store.PermManage) {
		return Result{}, store.ErrForbidden
	}
	var out Result
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var i Invitation
		var seq int
		err := tx.QueryRow(ctx, `
			UPDATE invitation SET expires_at = $3, send_count = send_count + 1
			WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
			RETURNING id, email, role, created_at, expires_at, last_sent_at, send_count`, t.WorkspaceID, id, s.now().Add(InviteDays*24*time.Hour)).
			Scan(&i.ID, &i.Email, &i.Role, &i.CreatedAt, &i.ExpiresAt, &i.LastSentAt, &seq)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		i.Link = s.Links.URL(s.Links.Token(t.WorkspaceID, i.ID))
		out = Result{Invitation: i}
		if s.MailEnabled && s.Jobs != nil {
			if _, err := s.Jobs.InsertTx(ctx, tx, s.mailArgs(t.WorkspaceID, id, seq), nil); err != nil {
				return err
			}
			out.EmailQueued = true
		}
		return nil
	})
	return out, err
}

// Revoke (admins only) cancels an open invitation; its link stops working.
func (s *Service) Revoke(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		tag, err := tx.Exec(ctx, `UPDATE invitation SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, t.WorkspaceID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// lockAdmins takes the admin rows so two changes cannot each think another admin is left.
func lockAdmins(ctx context.Context, tx pgx.Tx, ws uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := tx.Query(ctx, `SELECT user_id FROM member WHERE workspace_id = $1 AND role = 'admin' ORDER BY user_id FOR UPDATE`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]bool{}
	for rows.Next() {
		var u uuid.UUID
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out[u] = true
	}
	return out, rows.Err()
}

// SetRole (admins only) changes a teammate's role. The last admin cannot be demoted.
func (s *Service) SetRole(ctx context.Context, t store.Tenant, user uuid.UUID, role string) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	if !validRole(role) {
		return ErrInvalid("choose admin, member or viewer")
	}
	defer cache.ForgetTenant(ctx, s.Cache, t.WorkspaceID, user) // after the commit
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		admins, err := lockAdmins(ctx, tx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if admins[user] && role != "admin" && len(admins) == 1 {
			return ErrLastAdmin
		}
		tag, err := tx.Exec(ctx, `UPDATE member SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, t.WorkspaceID, user, role)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// Remove takes a teammate out of the workspace. Admins can remove anyone; anyone can remove themselves (leave).
// The last admin cannot go. Conversations assigned to the person become unassigned; what they wrote stays.
func (s *Service) Remove(ctx context.Context, t store.Tenant, user uuid.UUID) error {
	if !t.Can(store.PermManage) && user != t.UserID {
		return store.ErrForbidden
	}
	var ended []string // hashes of the keys the person made, which stop working with them
	defer func() { cache.ForgetAPIKeys(ctx, s.Cache, ended...) }()
	defer cache.ForgetTenant(ctx, s.Cache, t.WorkspaceID, user) // after the commit
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		admins, err := lockAdmins(ctx, tx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if admins[user] && len(admins) == 1 {
			return ErrLastAdmin
		}
		tag, err := tx.Exec(ctx, `DELETE FROM member WHERE workspace_id = $1 AND user_id = $2`, t.WorkspaceID, user)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if _, err = tx.Exec(ctx, `UPDATE conversation SET assignee = NULL WHERE workspace_id = $1 AND assignee = $2`, t.WorkspaceID, user); err != nil {
			return err
		}
		// What the person set up for outside programs goes with them: a key they made, or an assistant they
		// approved, would otherwise keep working for someone who no longer belongs here.
		rows, err := tx.Query(ctx, `UPDATE api_key SET revoked_at = now() WHERE workspace_id = $1 AND created_by = $2 AND revoked_at IS NULL RETURNING key_hash`, t.WorkspaceID, user)
		if err != nil {
			return err
		}
		for rows.Next() {
			var h string
			if err := rows.Scan(&h); err != nil {
				rows.Close()
				return err
			}
			ended = append(ended, h)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE oauth_grant SET revoked_at = now() WHERE workspace_id = $1 AND approved_by = $2 AND revoked_at IS NULL`, t.WorkspaceID, user)
		return err
	})
}

// ---- the invited person ----

type Preview struct {
	WorkspaceName string
	Role          string
	Email         string
	// State is open, expired, revoked or accepted.
	State         string
	AlreadyMember bool
	// CanAccept: the invitation is open and the signed-in person's confirmed address is the one invited.
	CanAccept bool
}

type invRow struct {
	email, role       string
	expires           time.Time
	accepted, revoked bool
	wsName            string
}

func (s *Service) load(ctx context.Context, tx pgx.Tx, ws, inv uuid.UUID) (invRow, error) {
	var r invRow
	err := tx.QueryRow(ctx, `
		SELECT i.email, i.role, i.expires_at, i.accepted_at IS NOT NULL, i.revoked_at IS NOT NULL, w.name
		FROM invitation i JOIN workspace w ON w.id = i.workspace_id
		WHERE i.workspace_id = $1 AND i.id = $2`, ws, inv).Scan(&r.email, &r.role, &r.expires, &r.accepted, &r.revoked, &r.wsName)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

func (r invRow) state(now time.Time) string {
	switch {
	case r.accepted:
		return "accepted"
	case r.revoked:
		return "revoked"
	case !r.expires.After(now):
		return "expired"
	}
	return "open"
}

func matches(id auth.Identity, invited string) bool {
	return id.EmailVerified && strings.EqualFold(strings.TrimSpace(id.Email), invited)
}

// Preview says what an invitation link is for, to the person holding it. The link is the secret, so it is
// enough to see which workspace and role it offers; joining needs the confirmed address as well.
func (s *Service) Preview(ctx context.Context, token string, id auth.Identity) (Preview, error) {
	ws, inv, err := s.Links.Verify(token)
	if err != nil {
		return Preview{}, ErrNotFound
	}
	var p Preview
	err = store.WithTenantTx(ctx, s.Pool, store.Tenant{WorkspaceID: ws, UserID: id.UserID, Role: store.RoleViewer}, func(tx pgx.Tx, _ *dbgen.Queries) error {
		r, err := s.load(ctx, tx, ws, inv)
		if err != nil {
			return err
		}
		p = Preview{WorkspaceName: r.wsName, Role: r.role, Email: r.email, State: r.state(s.now())}
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2)`, ws, id.UserID).Scan(&p.AlreadyMember); err != nil {
			return err
		}
		p.CanAccept = p.State == "open" && matches(id, r.email)
		return nil
	})
	return p, err
}

// Accept adds the signed-in person to the workspace with the invited role. It needs an open invitation and the
// confirmed address that was invited. Someone who is already a member keeps the role they have.
func (s *Service) Accept(ctx context.Context, token string, id auth.Identity) (uuid.UUID, error) {
	ws, inv, err := s.Links.Verify(token)
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	err = store.WithTenantTx(ctx, s.Pool, store.Tenant{WorkspaceID: ws, UserID: id.UserID, Role: store.RoleViewer}, func(tx pgx.Tx, _ *dbgen.Queries) error {
		r, err := s.load(ctx, tx, ws, inv)
		if err != nil {
			return err
		}
		switch r.state(s.now()) {
		case "expired":
			return ErrInvalid("this invitation has expired; ask an admin to send a new one")
		case "revoked":
			return ErrNotFound
		case "accepted":
			return ErrInvalid("this invitation has already been used")
		}
		if !matches(id, r.email) {
			return ErrWrongEmail
		}
		if _, err := tx.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO NOTHING`, ws, id.UserID, r.role); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE invitation SET accepted_at = now(), accepted_by = $3 WHERE workspace_id = $1 AND id = $2`, ws, inv, id.UserID)
		return err
	})
	return ws, err
}
