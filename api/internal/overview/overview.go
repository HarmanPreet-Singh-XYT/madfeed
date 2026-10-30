// Package overview answers the workspace home screen: a small, accurate set of counts in one query.
package overview

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

type SeriesPoint struct {
	Day      time.Time
	Requests int
	Quotes   int
	Messages int
}

type Counts struct {
	OpenRequests    int
	ShippedRequests int
	People          int
	Accounts        int
	Quotes          int
	Suggestions     int
	Messages        int
	Findings        int
	SurveysOpen     int
	Releases        int
	RequestsLast7d  int
	QuotesLast7d    int
	PeopleLast7d    int
}

type Activity struct {
	Kind       string
	ID         uuid.UUID
	ParentID   *uuid.UUID
	ParentKind string
	Title      string
	Detail     string
	At         time.Time
}

type Service struct{ Pool *pgxpool.Pool }

func (s *Service) Counts(ctx context.Context, t store.Tenant) (Counts, error) {
	var c Counts
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.OverviewCounts(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		c = Counts{
			OpenRequests: int(row.OpenRequests), ShippedRequests: int(row.ShippedRequests),
			People: int(row.People), Accounts: int(row.Accounts), Quotes: int(row.Quotes),
			Suggestions: int(row.SuggestionsWaiting), Messages: int(row.MessagesWaiting),
			Findings: int(row.Findings), SurveysOpen: int(row.SurveysOpen), Releases: int(row.ReleasesPublished),
			RequestsLast7d: int(row.RequestsLast7d), QuotesLast7d: int(row.QuotesLast7d), PeopleLast7d: int(row.PeopleLast7d),
		}
		return nil
	})
	return c, err
}

func (s *Service) Activity(ctx context.Context, t store.Tenant, limit int) ([]Activity, error) {
	if limit < 1 || limit > 30 {
		limit = 12
	}
	var out []Activity
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.OverviewActivity(ctx, dbgen.OverviewActivityParams{WorkspaceID: t.WorkspaceID, RowLimit: int32(limit)})
		if err != nil {
			return err
		}
		for _, r := range rows {
			a := Activity{Kind: r.Kind, ID: r.ID, Title: r.Title, Detail: r.Detail, At: r.At}
			if r.ParentID.Valid {
				id := r.ParentID.UUID
				a.ParentID = &id
			}
			if r.ParentKind.Valid {
				a.ParentKind = r.ParentKind.String
			}
			out = append(out, a)
		}
		return nil
	})
	return out, err
}

func (s *Service) Series(ctx context.Context, t store.Tenant, days int) ([]SeriesPoint, error) {
	if days != 7 && days != 30 && days != 90 {
		days = 30
	}
	var out []SeriesPoint
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.OverviewSeries(ctx, dbgen.OverviewSeriesParams{WorkspaceID: t.WorkspaceID, WindowDays: int32(days)})
		if err != nil {
			return err
		}
		for _, r := range rows {
			out = append(out, SeriesPoint{Day: r.Day.Time, Requests: int(r.Requests), Quotes: int(r.Quotes), Messages: int(r.Messages)})
		}
		return nil
	})
	return out, err
}

type ActivityCursor struct {
	At time.Time
	ID uuid.UUID
}

func activityOfRow(kind string, id uuid.UUID, parentID uuid.NullUUID, parentKind pgtype.Text, title, detail string, at time.Time) Activity {
	a := Activity{Kind: kind, ID: id, Title: title, Detail: detail, At: at}
	if parentID.Valid {
		v := parentID.UUID
		a.ParentID = &v
	}
	if parentKind.Valid {
		a.ParentKind = parentKind.String
	}
	return a
}

func (s *Service) ActivityPage(ctx context.Context, t store.Tenant, kind string, before *ActivityCursor, limit int) ([]Activity, *ActivityCursor, error) {
	if limit < 1 || limit > 50 {
		limit = 20
	}
	params := dbgen.WorkspaceActivityParams{
		WorkspaceID: t.WorkspaceID, Kind: kind, PageSize: int32(limit + 1), RowLimit: int32(limit + 1),
	}
	if before != nil {
		params.HasCursor = true
		params.BeforeAt = before.At
		params.BeforeID = before.ID
	}
	var out []Activity
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.WorkspaceActivity(ctx, params)
		if err != nil {
			return err
		}
		for _, r := range rows {
			out = append(out, activityOfRow(r.Kind, r.ID, r.ParentID, r.ParentKind, r.Title, r.Detail, r.At))
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	var next *ActivityCursor
	if len(out) > limit {
		out = out[:limit]
		next = &ActivityCursor{At: out[len(out)-1].At, ID: out[len(out)-1].ID}
	}
	return out, next, nil
}
