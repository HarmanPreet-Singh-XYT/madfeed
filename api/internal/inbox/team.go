package inbox

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// MaxCannedReplies keeps the list short enough to choose from.
const MaxCannedReplies = 100

// ---- teammates ----

type Teammate struct {
	UserID uuid.UUID
	Name   string // what they chose to be called; empty when they have not
	Role   string
}

// Teammates lists everyone who can see this workspace, for choosing who gets a conversation.
func (s *Service) Teammates(ctx context.Context, t store.Tenant) ([]Teammate, error) {
	out := []Teammate{}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		rows, err := tx.Query(ctx, `SELECT user_id, display_name, role FROM member WHERE workspace_id = $1 ORDER BY created_at, user_id LIMIT 200`, t.WorkspaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m Teammate
			if err := rows.Scan(&m.UserID, &m.Name, &m.Role); err != nil {
				return err
			}
			out = append(out, m)
		}
		return rows.Err()
	})
	return out, err
}

// SetMyName sets the name teammates see for the caller.
func (s *Service) SetMyName(ctx context.Context, t store.Tenant, name string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > 80 || strings.ContainsAny(name, "\r\n\x00") {
		return ErrInvalid("a name is at most 80 characters on one line")
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		_, err := tx.Exec(ctx, `UPDATE member SET display_name = $3 WHERE workspace_id = $1 AND user_id = $2`, t.WorkspaceID, t.UserID, name)
		return err
	})
}

// AssignTo hands a conversation to a teammate who can reply. `expected` is who the caller saw as the assignee
// (nil for nobody): if that changed meanwhile, ErrStale.
func (s *Service) AssignTo(ctx context.Context, t store.Tenant, id, to uuid.UUID, expected *uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		var role string
		err := tx.QueryRow(ctx, `SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2`, t.WorkspaceID, to).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && role == "viewer") {
			return ErrInvalid("that person cannot take conversations")
		}
		if err != nil {
			return err
		}
		c, err := q.GetConversationForUpdate(ctx, dbgen.GetConversationForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if (c.Assignee.Valid) != (expected != nil) || (expected != nil && c.Assignee.UUID != *expected) {
			return ErrStale
		}
		_, err = q.SetConversationAssignee(ctx, dbgen.SetConversationAssigneeParams{WorkspaceID: t.WorkspaceID, ID: id, Assignee: uuid.NullUUID{UUID: to, Valid: true}})
		return err
	})
}

// ---- canned replies ----

type Canned struct {
	ID        uuid.UUID
	Name      string
	Body      string
	UpdatedAt time.Time
}

func (s *Service) CannedReplies(ctx context.Context, t store.Tenant) ([]Canned, error) {
	out := []Canned{}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		rows, err := tx.Query(ctx, `SELECT id, name, body, updated_at FROM canned_reply WHERE workspace_id = $1 ORDER BY lower(name), id LIMIT $2`, t.WorkspaceID, MaxCannedReplies)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c Canned
			if err := rows.Scan(&c.ID, &c.Name, &c.Body, &c.UpdatedAt); err != nil {
				return err
			}
			out = append(out, c)
		}
		return rows.Err()
	})
	return out, err
}

func cleanCanned(name, body string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 || strings.ContainsAny(name, "\r\n\x00") {
		return "", "", ErrInvalid("give the reply a short name (80 characters, one line)")
	}
	body, err := clean(body, MaxReplyText)
	if err != nil {
		return "", "", err
	}
	return name, body, nil
}

func isUnique(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func (s *Service) CreateCanned(ctx context.Context, t store.Tenant, name, body string) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	name, body, err := cleanCanned(name, body)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM canned_reply WHERE workspace_id = $1`, t.WorkspaceID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxCannedReplies {
			return ErrInvalid("there are already 100 saved replies; remove one first")
		}
		return tx.QueryRow(ctx, `INSERT INTO canned_reply (workspace_id, name, body, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, t.WorkspaceID, name, body, t.UserID).Scan(&id)
	})
	if isUnique(err) {
		return uuid.Nil, ErrInvalid("a saved reply with that name already exists")
	}
	return id, err
}

func (s *Service) UpdateCanned(ctx context.Context, t store.Tenant, id uuid.UUID, name, body string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	name, body, err := cleanCanned(name, body)
	if err != nil {
		return err
	}
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		tag, err := tx.Exec(ctx, `UPDATE canned_reply SET name = $3, body = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id, name, body)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return err
	})
	if isUnique(err) {
		return ErrInvalid("a saved reply with that name already exists")
	}
	return err
}

func (s *Service) DeleteCanned(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		tag, err := tx.Exec(ctx, `DELETE FROM canned_reply WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return err
	})
}

// ---- how fast the team answers ----

type ReplyStats struct {
	Days             int
	Answered         int     // conversations started in the period that have had a team reply
	MedianMinutes    float64 // time to the first team reply; 0 when nothing was answered
	P90Minutes       float64
	Waiting          int // open conversations whose newest message is the customer's
	OldestWaitingMin float64
	TargetHours      int // 0: no target
	OverTarget       int // waiting longer than the target
}

// Stats reports first-reply times over the last 30 days and who is waiting now.
func (s *Service) Stats(ctx context.Context, t store.Tenant) (ReplyStats, error) {
	out := ReplyStats{Days: 30}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var med, p90 *float64
		if err := tx.QueryRow(ctx, `
			SELECT count(*)::int,
			  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_reply_at - created_at) / 60),
			  percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM first_reply_at - created_at) / 60)
			FROM conversation WHERE workspace_id = $1 AND first_reply_at IS NOT NULL AND created_at > now() - interval '30 days'`, t.WorkspaceID).Scan(&out.Answered, &med, &p90); err != nil {
			return err
		}
		if med != nil {
			out.MedianMinutes, out.P90Minutes = *med, *p90
		}
		if err := tx.QueryRow(ctx, `SELECT coalesce((SELECT reply_target_hours FROM inbox_setting WHERE workspace_id = $1), 0)`, t.WorkspaceID).Scan(&out.TargetHours); err != nil {
			return err
		}
		var oldest *float64
		err := tx.QueryRow(ctx, `
			WITH w AS (
			  SELECT c.id, (SELECT m.created_at FROM conversation_message m WHERE m.conversation_id = c.id AND m.direction <> 'note' ORDER BY m.seq DESC LIMIT 1) AS since,
			         (SELECT m.direction FROM conversation_message m WHERE m.conversation_id = c.id AND m.direction <> 'note' ORDER BY m.seq DESC LIMIT 1) AS dir
			  FROM conversation c WHERE c.workspace_id = $1 AND c.state = 'open')
			SELECT count(*)::int, max(extract(epoch FROM now() - since) / 60),
			       count(*) FILTER (WHERE $2 > 0 AND since < now() - make_interval(hours => $2))::int
			FROM w WHERE dir = 'in'`, t.WorkspaceID, out.TargetHours).Scan(&out.Waiting, &oldest, &out.OverTarget)
		if oldest != nil {
			out.OldestWaitingMin = *oldest
		}
		return err
	})
	return out, err
}

// SetReplyTarget (admins only) sets how many hours a customer should wait at most; 0 turns the target off.
func (s *Service) SetReplyTarget(ctx context.Context, t store.Tenant, hours int) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	if hours < 0 || hours > 720 {
		return ErrInvalid("the target is between 0 and 720 hours")
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		_, err := tx.Exec(ctx, `INSERT INTO inbox_setting (workspace_id, reply_target_hours) VALUES ($1,$2)
			ON CONFLICT (workspace_id) DO UPDATE SET reply_target_hours = EXCLUDED.reply_target_hours, updated_at = now()`, t.WorkspaceID, hours)
		return err
	})
}
