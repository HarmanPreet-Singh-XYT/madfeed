// Package workspaces creates workspaces and lists a user's memberships.
package workspaces

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

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

type Service struct{ Pool *pgxpool.Pool }

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
