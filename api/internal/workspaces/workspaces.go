// Package workspaces creates workspaces and lists a user's memberships.
package workspaces

import (
	"context"
	"log/slog"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/storage"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// MaxPerUser stops one account from creating workspaces without limit.
const MaxPerUser = 10

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type Summary struct {
	ID   uuid.UUID
	Name string
	Role store.Role
}

type Service struct {
	Pool *pgxpool.Pool
	// Files, when set, is where recordings live; they are removed with the workspace.
	Files storage.Store
	Log   *slog.Logger
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Summary, error) {
	var out []Summary
	err := store.WithUser(ctx, s.Pool, userID, func(q *dbgen.Queries) error {
		rows, err := q.ListMyWorkspaces(ctx, userID)
		for _, r := range rows {
			out = append(out, Summary{ID: r.WorkspaceID, Name: r.Name, Role: store.Role(r.Role)})
		}
		return err
	})
	return out, err
}

// Create makes a workspace and its first admin in one transaction.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, name string) (Summary, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 200 {
		return Summary{}, ErrInvalid("workspace name must be 1 to 200 characters")
	}
	existing, err := s.List(ctx, userID)
	if err != nil {
		return Summary{}, err
	}
	if len(existing) >= MaxPerUser {
		return Summary{}, ErrInvalid("you have reached the workspace limit")
	}
	t := store.Tenant{WorkspaceID: uuid.New(), UserID: userID, Role: store.RoleAdmin}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: t.WorkspaceID, Name: name}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: t.WorkspaceID, UserID: userID, Role: string(store.RoleAdmin)})
	})
	if err != nil {
		return Summary{}, err
	}
	return Summary{ID: t.WorkspaceID, Name: name, Role: store.RoleAdmin}, nil
}

// Delete permanently removes a workspace and everything in it. Only an admin may, and only by typing the
// workspace's exact name. A workspace with a live subscription is refused: cancel it first, so nobody is
// charged for something that no longer exists. The database rows go in one transaction (every table's
// workspace_id cascades from the workspace row); the recordings' files are removed afterwards, and a failure
// there is logged, not returned, because the workspace is already gone and an orphan file holds no way back in.
func (s *Service) Delete(ctx context.Context, t store.Tenant, confirmName string) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	var keys []string
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var name string
		if err := tx.QueryRow(ctx, `SELECT name FROM workspace WHERE id = $1`, t.WorkspaceID).Scan(&name); err != nil {
			return err
		}
		if strings.TrimSpace(confirmName) != name {
			return ErrInvalid("type the workspace's name exactly to confirm")
		}
		var live bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM billing_account WHERE workspace_id = $1 AND stripe_subscription_id IS NOT NULL AND status NOT IN ('none', 'canceled'))`, t.WorkspaceID).Scan(&live); err != nil {
			return err
		}
		if live {
			return ErrInvalid("cancel your subscription in Settings first, then delete the workspace")
		}
		rows, err := tx.Query(ctx, `SELECT storage_key FROM media WHERE workspace_id = $1`, t.WorkspaceID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var k string
			if err := rows.Scan(&k); err != nil {
				rows.Close()
				return err
			}
			keys = append(keys, k)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, t.WorkspaceID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return store.ErrForbidden
		}
		return nil
	})
	if err != nil {
		return err
	}
	if s.Files != nil {
		log := s.Log
		if log == nil {
			log = slog.Default()
		}
		for _, k := range keys {
			if derr := s.Files.Delete(context.WithoutCancel(ctx), k); derr != nil {
				log.Error("a deleted workspace's recording file could not be removed", "key", k, "error", derr)
			}
		}
	}
	return nil
}
