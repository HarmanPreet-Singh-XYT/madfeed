package views

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// QuoteView is a saved way of looking at the quote list: the same filters the
// list has, stored so a question like "negative security quotes from email"
// does not have to be retyped.
type QuoteView struct {
	ID         uuid.UUID
	Name       string
	Kind       string
	TagID      *uuid.UUID
	Sentiment  string
	SourceKind string
	Search     string
	Meaning    string
	Days       int
	Sort       string
	PersonID   *uuid.UUID
	AccountID  *uuid.UUID
	CreatedBy  uuid.UUID
	CreatedAt  time.Time
}

// QuoteInput is what a person chose when they saved the view.
type QuoteInput struct {
	Name       string
	Kind       string
	TagID      *uuid.UUID
	Sentiment  string
	SourceKind string
	Search     string
	Meaning    string
	Days       int
	Sort       string
	PersonID   *uuid.UUID
	AccountID  *uuid.UUID
}

func quoteRow(v dbgen.QuoteView) QuoteView {
	out := QuoteView{ID: v.ID, Name: v.Name, Kind: v.Kind, Sentiment: v.Sentiment, SourceKind: v.SourceKind, Search: v.Search, Meaning: v.Meaning, Days: int(v.Days), Sort: v.Sort, CreatedBy: v.CreatedBy, CreatedAt: v.CreatedAt}
	if v.TagID.Valid {
		id := v.TagID.UUID
		out.TagID = &id
	}
	if v.PersonID.Valid {
		id := v.PersonID.UUID
		out.PersonID = &id
	}
	if v.AccountID.Valid {
		id := v.AccountID.UUID
		out.AccountID = &id
	}
	return out
}

// CleanQuoteSearch trims and bounds a word search the same way for views and for live filtering.
func CleanQuoteSearch(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > 200 {
		s = string([]rune(s)[:200])
	}
	return s
}

// CleanMeaning trims and bounds a meaning search.
func CleanMeaning(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > 300 {
		s = string([]rune(s)[:300])
	}
	return s
}

var quoteKinds = map[string]bool{"": true, "evidence": true, "highlight": true}
var quoteSentiments = map[string]bool{"": true, "positive": true, "neutral": true, "negative": true, "mixed": true, "none": true}
var quoteSources = map[string]bool{"": true, "paste": true, "recording": true, "form": true, "api": true, "chat": true, "survey": true}

func normalizedQuote(in QuoteInput) (QuoteInput, error) {
	in.Name = strings.Join(strings.Fields(in.Name), " ")
	in.Search = CleanQuoteSearch(in.Search)
	in.Meaning = CleanMeaning(in.Meaning)
	if in.Sort == "" {
		in.Sort = "newest"
	}
	switch {
	case in.Name == "" || utf8.RuneCountInString(in.Name) > 60:
		return in, ErrInvalid("a view name must be 1 to 60 characters")
	case !quoteKinds[in.Kind]:
		return in, ErrInvalid("unknown quote type")
	case !quoteSentiments[in.Sentiment]:
		return in, ErrInvalid("unknown feeling")
	case !quoteSources[in.SourceKind]:
		return in, ErrInvalid("unknown source type")
	case in.Days != 0 && in.Days != 7 && in.Days != 30 && in.Days != 90:
		return in, ErrInvalid("the date range must be 7, 30 or 90 days")
	case in.Sort != "newest" && in.Sort != "oldest":
		return in, ErrInvalid("sort must be newest or oldest")
	case in.Kind == "" && in.TagID == nil && in.Sentiment == "" && in.SourceKind == "" && in.Search == "" && in.Meaning == "" && in.Days == 0 && in.PersonID == nil && in.AccountID == nil && in.Sort == "newest":
		return in, ErrInvalid("choose a filter or a different order first; a view with none of these is the plain list")
	}
	return in, nil
}

// MaxQuoteViews is how many saved quote views one workspace may have.
const MaxQuoteViews = 50

func (s *Service) ListQuotes(ctx context.Context, t store.Tenant) ([]QuoteView, error) {
	var out []QuoteView
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListQuoteViews(ctx, t.WorkspaceID)
		for _, r := range rows {
			out = append(out, quoteRow(r))
		}
		return err
	})
	return out, err
}

func (s *Service) CreateQuote(ctx context.Context, t store.Tenant, in QuoteInput) (QuoteView, error) {
	var out QuoteView
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	in, err := normalizedQuote(in)
	if err != nil {
		return out, err
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		all, err := q.ListQuoteViews(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if len(all) >= MaxQuoteViews {
			return ErrConflict("this workspace already has the most saved views allowed (50); delete one first")
		}
		p := dbgen.InsertQuoteViewParams{WorkspaceID: t.WorkspaceID, Btrim: in.Name, Kind: in.Kind, Sentiment: in.Sentiment, SourceKind: in.SourceKind, Search: in.Search, Meaning: in.Meaning, Days: int32(in.Days), Sort: in.Sort, CreatedBy: t.UserID}
		if in.TagID != nil {
			p.TagID = uuid.NullUUID{UUID: *in.TagID, Valid: true}
		}
		if in.PersonID != nil {
			p.PersonID = uuid.NullUUID{UUID: *in.PersonID, Valid: true}
		}
		if in.AccountID != nil {
			p.AccountID = uuid.NullUUID{UUID: *in.AccountID, Valid: true}
		}
		v, err := q.InsertQuoteView(ctx, p)
		out = quoteRow(v)
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch pe.Code {
		case "23505":
			return QuoteView{}, ErrConflict("a view with that name already exists")
		case "23503":
			return QuoteView{}, ErrInvalid("that tag, person or account does not exist in this workspace")
		}
	}
	return out, err
}

// GetQuote reads one saved view, for replacing its filters.
func (s *Service) GetQuote(ctx context.Context, t store.Tenant, id uuid.UUID) (QuoteView, error) {
	var out QuoteView
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		v, err := q.GetQuoteView(ctx, dbgen.GetQuoteViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return ErrNotFound
		}
		out = quoteRow(v)
		return nil
	})
	return out, err
}

// UpdateQuote replaces every filter a saved view stands for. Only its creator, or an admin, may change it.
func (s *Service) UpdateQuote(ctx context.Context, t store.Tenant, id uuid.UUID, in QuoteInput) (QuoteView, error) {
	var out QuoteView
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	in, err := normalizedQuote(in)
	if err != nil {
		return out, err
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		cur, err := q.GetQuoteView(ctx, dbgen.GetQuoteViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return ErrNotFound
		}
		if cur.CreatedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		p := dbgen.UpdateQuoteViewParams{WorkspaceID: t.WorkspaceID, ID: id, Btrim: in.Name, Kind: in.Kind, Sentiment: in.Sentiment, SourceKind: in.SourceKind, Search: in.Search, Meaning: in.Meaning, Days: int32(in.Days), Sort: in.Sort}
		if in.TagID != nil {
			p.TagID = uuid.NullUUID{UUID: *in.TagID, Valid: true}
		}
		if in.PersonID != nil {
			p.PersonID = uuid.NullUUID{UUID: *in.PersonID, Valid: true}
		}
		if in.AccountID != nil {
			p.AccountID = uuid.NullUUID{UUID: *in.AccountID, Valid: true}
		}
		v, err := q.UpdateQuoteView(ctx, p)
		out = quoteRow(v)
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch pe.Code {
		case "23505":
			return QuoteView{}, ErrConflict("a view with that name already exists")
		case "23503":
			return QuoteView{}, ErrInvalid("that tag, person or account does not exist in this workspace")
		}
	}
	return out, err
}

// RenameQuote changes only the name. Only the person who made it, or an admin, may rename it.
func (s *Service) RenameQuote(ctx context.Context, t store.Tenant, id uuid.UUID, name string) (QuoteView, error) {
	var out QuoteView
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	clean := strings.Join(strings.Fields(name), " ")
	if clean == "" || utf8.RuneCountInString(clean) > 60 {
		return out, ErrInvalid("a view name must be 1 to 60 characters")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		cur, err := q.GetQuoteView(ctx, dbgen.GetQuoteViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return ErrNotFound
		}
		if cur.CreatedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		v, err := q.UpdateQuoteViewName(ctx, dbgen.UpdateQuoteViewNameParams{WorkspaceID: t.WorkspaceID, ID: id, Btrim: clean})
		if err != nil {
			return err
		}
		out = quoteRow(v)
		return nil
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return QuoteView{}, ErrConflict("a view with that name already exists")
	}
	return out, err
}

// DeleteQuote removes a saved quote view. Only the person who made it, or an admin, may remove it.
func (s *Service) DeleteQuote(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		cur, err := q.GetQuoteView(ctx, dbgen.GetQuoteViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return ErrNotFound
		}
		if cur.CreatedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		n, err := q.DeleteQuoteView(ctx, dbgen.DeleteQuoteViewParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}
