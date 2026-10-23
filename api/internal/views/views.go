// Package views stores saved ways of looking at the request list (a status, a
// tag, a title search and a sort). Everyone in the workspace sees them; any
// editor can add one; the person who made it, or an admin, can remove it.
package views

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var ErrNotFound = errors.New("views: not found")

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

const MaxViews = 50

type View struct {
	ID        uuid.UUID
	Name      string
	StatusID  *uuid.UUID
	TagID     *uuid.UUID
	Search    string
	Sort      string
	CreatedBy uuid.UUID
	CreatedAt time.Time
}

type Input struct {
	Name     string
	StatusID *uuid.UUID
	TagID    *uuid.UUID
	Search   string
	Sort     string
}

type Service struct{ Pool *pgxpool.Pool }

// CleanSearch trims and bounds a title search the same way for views and for live filtering.
func CleanSearch(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > 100 {
		s = string([]rune(s)[:100])
	}
	return s
}

// LikePattern escapes %, _ and \ so a search is always a plain substring match.
func LikePattern(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func row(v dbgen.SavedView) View {
	out := View{ID: v.ID, Name: v.Name, Search: v.Search, Sort: v.Sort, CreatedBy: v.CreatedBy, CreatedAt: v.CreatedAt}
	if v.StatusID.Valid {
		id := v.StatusID.UUID
		out.StatusID = &id
	}
	if v.TagID.Valid {
		id := v.TagID.UUID
		out.TagID = &id
	}
	return out
}

func (s *Service) List(ctx context.Context, t store.Tenant) ([]View, error) {
	var out []View
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListViews(ctx, t.WorkspaceID)
		for _, r := range rows {
			out = append(out, row(r))
		}
		return err
	})
	return out, err
}

func (s *Service) Create(ctx context.Context, t store.Tenant, in Input) (View, error) {
	var out View
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	in.Name = strings.Join(strings.Fields(in.Name), " ")
	in.Search = CleanSearch(in.Search)
	if in.Sort == "" {
		in.Sort = "newest"
	}
	switch {
	case in.Name == "" || utf8.RuneCountInString(in.Name) > 60:
		return out, ErrInvalid("a view name must be 1 to 60 characters")
	case in.Sort != "newest" && in.Sort != "value":
		return out, ErrInvalid("sort must be newest or value")
	case in.StatusID == nil && in.TagID == nil && in.Search == "" && in.Sort == "newest":
		return out, ErrInvalid("choose a status, a tag, a search or a different order first; a view with none of these is the plain list")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		all, err := q.ListViews(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if len(all) >= MaxViews {
			return ErrConflict("this workspace already has the most saved views allowed (50); delete one first")
		}
		p := dbgen.InsertViewParams{WorkspaceID: t.WorkspaceID, Btrim: in.Name, Search: in.Search, Sort: in.Sort, CreatedBy: t.UserID}
		if in.StatusID != nil {
			p.StatusID = uuid.NullUUID{UUID: *in.StatusID, Valid: true}
		}
		if in.TagID != nil {
			p.TagID = uuid.NullUUID{UUID: *in.TagID, Valid: true}
		}
		v, err := q.InsertView(ctx, p)
		out = row(v)
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch pe.Code {
		case "23505":
			return View{}, ErrConflict("a view with that name already exists")
		case "23503":
			return View{}, ErrInvalid("that status or tag does not exist in this workspace")
		}
	}
	return out, err
}

func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		v, err := q.GetView(ctx, dbgen.GetViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return ErrNotFound
		}
		if v.CreatedBy != t.UserID && t.Role != store.RoleAdmin {
			return store.ErrForbidden
		}
		_, err = q.DeleteView(ctx, dbgen.DeleteViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		return err
	})
}
