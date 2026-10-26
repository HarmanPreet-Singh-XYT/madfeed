// Package account holds what a person can ask about their own sign-in account. Deleting the account itself is
// done by the operator (the identity service's admin key is never held here); a person can ask, see that the
// request is open, and take it back.
package account

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Request struct {
	ID          uuid.UUID
	RequestedAt time.Time
}

type Service struct{ Pool *pgxpool.Pool }

func (s *Service) inUserTx(ctx context.Context, user uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id', $1, true)`, user.String()); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Open is the person's open deletion request, or nil.
func (s *Service) Open(ctx context.Context, user uuid.UUID) (*Request, error) {
	var r *Request
	err := s.inUserTx(ctx, user, func(tx pgx.Tx) error {
		var x Request
		err := tx.QueryRow(ctx, `SELECT id, requested_at FROM account_deletion_request WHERE user_id = $1 AND status = 'open'`, user).Scan(&x.ID, &x.RequestedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		r = &x
		return nil
	})
	return r, err
}

// Request records that the person wants their account deleted. Asking twice keeps the first request.
func (s *Service) Request(ctx context.Context, user uuid.UUID, email string) (Request, bool, error) {
	var out Request
	created := false
	email = strings.ToLower(strings.TrimSpace(email))
	if len(email) > 320 {
		email = email[:320]
	}
	err := s.inUserTx(ctx, user, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id, requested_at FROM account_deletion_request WHERE user_id = $1 AND status = 'open'`, user).Scan(&out.ID, &out.RequestedAt)
		if err == nil {
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		created = true
		return tx.QueryRow(ctx, `INSERT INTO account_deletion_request (user_id, email) VALUES ($1, $2) RETURNING id, requested_at`, user, email).Scan(&out.ID, &out.RequestedAt)
	})
	return out, created, err
}

// Cancel takes the request back. It reports whether there was one to take back.
func (s *Service) Cancel(ctx context.Context, user uuid.UUID) (bool, error) {
	var n int64
	err := s.inUserTx(ctx, user, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE account_deletion_request SET status = 'cancelled', handled_at = now() WHERE user_id = $1 AND status = 'open'`, user)
		n = tag.RowsAffected()
		return err
	})
	return n > 0, err
}
