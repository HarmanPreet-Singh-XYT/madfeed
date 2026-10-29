// Package insights reads across every stored quote: a filtered table, tags over time, and how quotes feel
// (sentiment), by a model or by a person. A person's label always wins, and the two are kept apart so the
// model can be measured against people before anyone is asked to trust it.
package insights

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/fulltext"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var ErrNotFound = errors.New("insights: not found")

// ErrInvalid is input the caller must fix; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

var labels = map[string]bool{"positive": true, "neutral": true, "negative": true, "mixed": true}

// AgreementTarget is how often the model must match people before its labels are called trustworthy. It was set
// before any measurement, and changing it needs a written reason.
const AgreementTarget = 0.80

// EnoughLabelled is how many quotes people must have labelled (and the model too) for the measurement to count.
const EnoughLabelled = 200

type Service struct {
	Pool *pgxpool.Pool
	Jobs *river.Client[pgx.Tx]
	Now  func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

type Tag struct {
	ID    uuid.UUID
	Name  string
	Color string
}

type Quote struct {
	Kind            string // "evidence" or "highlight"
	ID              uuid.UUID
	At              time.Time
	Text            string
	SourceItemID    uuid.UUID
	SourceTitle     string
	SourceKind      string
	RequestID       *uuid.UUID
	RequestTitle    string
	Sentiment       string // "" when nobody has said
	SentimentSource string // "human" or "model"
	PersonName      string // "" when the source has no person
	AccountName     string // "" when that person has no account
	Tags            []Tag
}

type Filter struct {
	TagID      *uuid.UUID
	Sentiment  string // positive, neutral, negative, mixed, or none (not yet labelled)
	SourceKind string
	Kind       string // evidence, highlight, or empty for both
	Search     string
	Sort       string // newest (default) or oldest
	Since      *time.Time
	Before     *time.Time
	PersonID   *uuid.UUID
	AccountID  *uuid.UUID
	AfterAt    *time.Time
	AfterID    *uuid.UUID
	Limit      int
}

var sourceKinds = map[string]bool{"paste": true, "recording": true, "form": true, "api": true, "chat": true, "survey": true}

// quoteParams builds the filter both the list and the count use, so "128 quotes" always matches the rows.
func (s *Service) quoteParams(t store.Tenant, f Filter, limit int) (dbgen.ListQuotesParams, dbgen.CountQuotesParams, error) {
	if f.Sentiment != "" && f.Sentiment != "none" && !labels[f.Sentiment] {
		return dbgen.ListQuotesParams{}, dbgen.CountQuotesParams{}, ErrInvalid("unknown sentiment")
	}
	if f.SourceKind != "" && !sourceKinds[f.SourceKind] {
		return dbgen.ListQuotesParams{}, dbgen.CountQuotesParams{}, ErrInvalid("unknown source type")
	}
	if f.Kind != "" && f.Kind != "evidence" && f.Kind != "highlight" {
		return dbgen.ListQuotesParams{}, dbgen.CountQuotesParams{}, ErrInvalid("unknown quote type")
	}
	if f.Sort != "" && f.Sort != "newest" && f.Sort != "oldest" {
		return dbgen.ListQuotesParams{}, dbgen.CountQuotesParams{}, ErrInvalid("unknown order")
	}
	desc := f.Sort != "oldest"
	var tag uuid.NullUUID
	if f.TagID != nil {
		tag = uuid.NullUUID{UUID: *f.TagID, Valid: true}
	}
	var sent, src, search pgtype.Text
	if f.Sentiment != "" {
		sent = pgtype.Text{String: f.Sentiment, Valid: true}
	}
	if f.SourceKind != "" {
		src = pgtype.Text{String: f.SourceKind, Valid: true}
	}
	if q := fulltext.Query(f.Search); q != "" {
		search = pgtype.Text{String: q, Valid: true}
	}
	var person, account uuid.NullUUID
	if f.PersonID != nil {
		person = uuid.NullUUID{UUID: *f.PersonID, Valid: true}
	}
	if f.AccountID != nil {
		account = uuid.NullUUID{UUID: *f.AccountID, Valid: true}
	}
	var since, before pgtype.Timestamptz
	if f.Since != nil {
		since = pgtype.Timestamptz{Time: *f.Since, Valid: true}
	}
	if f.Before != nil {
		before = pgtype.Timestamptz{Time: *f.Before, Valid: true}
	}
	list := dbgen.ListQuotesParams{WorkspaceID: t.WorkspaceID, Kind: f.Kind, Descending: desc, PageSize: int32(limit + 1), TagID: tag, Sentiment: sent, SourceKind: src, Search: search, Since: since, Before: before, PersonID: person, AccountID: account}
	count := dbgen.CountQuotesParams{WorkspaceID: t.WorkspaceID, Kind: f.Kind, TagID: tag, Sentiment: sent, SourceKind: src, Search: search, Since: since, Before: before, PersonID: person, AccountID: account}
	return list, count, nil
}

// Quotes returns one page of quotes in the chosen order, and the cursor for the next page (nil at the end).
func (s *Service) Quotes(ctx context.Context, t store.Tenant, f Filter) ([]Quote, *Quote, error) {
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	p, _, err := s.quoteParams(t, f, limit)
	if err != nil {
		return nil, nil, err
	}
	if f.AfterAt != nil && f.AfterID != nil {
		p.AfterCreated = pgtype.Timestamptz{Time: *f.AfterAt, Valid: true}
		p.AfterID = uuid.NullUUID{UUID: *f.AfterID, Valid: true}
	}
	var out []Quote
	var next *Quote
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListQuotes(ctx, p)
		if err != nil {
			return err
		}
		if len(rows) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			next = &Quote{ID: last.ID, At: last.CreatedAt}
		}
		var ev, hl []uuid.UUID
		for _, r := range rows {
			qt := Quote{Kind: r.Kind, ID: r.ID, At: r.CreatedAt, Text: r.QuoteText, SourceItemID: r.SourceItemID, SourceTitle: r.SourceTitle, SourceKind: r.SourceKind, RequestTitle: r.RequestTitle, PersonName: r.PersonName, AccountName: r.AccountName}
			if r.RequestID != uuid.Nil {
				id := r.RequestID
				qt.RequestID = &id
			}
			if r.Sentiment != "" {
				qt.Sentiment, qt.SentimentSource = r.Sentiment, r.SentimentSource
			}
			out = append(out, qt)
			if r.Kind == "evidence" {
				ev = append(ev, r.ID)
			} else {
				hl = append(hl, r.ID)
			}
		}
		tags, err := q.ListTagsForQuotes(ctx, dbgen.ListTagsForQuotesParams{WorkspaceID: t.WorkspaceID, HighlightIds: hl, EvidenceIds: ev})
		if err != nil {
			return err
		}
		by := map[string][]Tag{}
		for _, g := range tags {
			k := g.Kind + g.QuoteID.String()
			by[k] = append(by[k], Tag{ID: g.TagID, Name: g.Name, Color: g.Color})
		}
		for i := range out {
			out[i].Tags = by[out[i].Kind+out[i].ID.String()]
		}
		return nil
	})
	return out, next, err
}

// Count is how many quotes match the filters, without a page limit.
func (s *Service) Count(ctx context.Context, t store.Tenant, f Filter) (int, error) {
	_, p, err := s.quoteParams(t, f, 0)
	if err != nil {
		return 0, err
	}
	var n int
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountQuotes(ctx, p)
		n = int(c)
		return err
	})
	return n, err
}

// Quote is one quote by id, with its tags, for the detail panel and a shareable link.
func (s *Service) Quote(ctx context.Context, t store.Tenant, kind string, id uuid.UUID) (Quote, error) {
	if kind != "" && kind != "evidence" && kind != "highlight" {
		return Quote{}, ErrInvalid("unknown quote type")
	}
	var out Quote
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetQuote(ctx, dbgen.GetQuoteParams{WorkspaceID: t.WorkspaceID, QuoteID: id, Kind: kind})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = Quote{Kind: r.Kind, ID: r.ID, At: r.CreatedAt, Text: r.QuoteText, SourceItemID: r.SourceItemID, SourceTitle: r.SourceTitle, SourceKind: r.SourceKind, RequestTitle: r.RequestTitle, PersonName: r.PersonName, AccountName: r.AccountName}
		if r.RequestID != uuid.Nil {
			rid := r.RequestID
			out.RequestID = &rid
		}
		if r.Sentiment != "" {
			out.Sentiment, out.SentimentSource = r.Sentiment, r.SentimentSource
		}
		ev, hl := []uuid.UUID{}, []uuid.UUID{}
		if r.Kind == "evidence" {
			ev = append(ev, r.ID)
		} else {
			hl = append(hl, r.ID)
		}
		tags, err := q.ListTagsForQuotes(ctx, dbgen.ListTagsForQuotesParams{WorkspaceID: t.WorkspaceID, HighlightIds: hl, EvidenceIds: ev})
		if err != nil {
			return err
		}
		for _, g := range tags {
			out.Tags = append(out.Tags, Tag{ID: g.TagID, Name: g.Name, Color: g.Color})
		}
		return nil
	})
	return out, err
}

// ---- tags over time ----

type WeekCount struct {
	Week time.Time
	N    int
}

type TagTrend struct {
	Tag     Tag
	Total   int
	ByLabel map[string]int // positive, neutral, negative, mixed, none
	Weeks   []WeekCount
}

// Trends counts quotes per tag per week over the last `weeks` weeks (1 to 52, default 12).
func (s *Service) Trends(ctx context.Context, t store.Tenant, weeks int) ([]TagTrend, error) {
	if weeks <= 0 || weeks > 52 {
		weeks = 12
	}
	since := s.now().AddDate(0, 0, -7*weeks)
	var out []TagTrend
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		tags, err := q.ListTags(ctx, dbgen.ListTagsParams{WorkspaceID: t.WorkspaceID, IncludeArchived: false})
		if err != nil {
			return err
		}
		rows, err := q.TagTrends(ctx, dbgen.TagTrendsParams{WorkspaceID: t.WorkspaceID, CreatedAt: since})
		if err != nil {
			return err
		}
		idx := map[uuid.UUID]*TagTrend{}
		for _, tg := range tags {
			out = append(out, TagTrend{Tag: Tag{ID: tg.ID, Name: tg.Name, Color: tg.Color}, ByLabel: map[string]int{}})
		}
		for i := range out {
			idx[out[i].Tag.ID] = &out[i]
		}
		for _, r := range rows {
			tr := idx[r.TagID]
			if tr == nil {
				continue
			}
			tr.Total += int(r.N)
			tr.ByLabel[r.Label] += int(r.N)
			n := len(tr.Weeks)
			if n > 0 && tr.Weeks[n-1].Week.Equal(r.Week.Time) {
				tr.Weeks[n-1].N += int(r.N)
			} else {
				tr.Weeks = append(tr.Weeks, WeekCount{Week: r.Week.Time, N: int(r.N)})
			}
		}
		return nil
	})
	return out, err
}

// ---- sentiment ----

func (s *Service) Pending(ctx context.Context, t store.Tenant) (int, error) {
	var n int
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountUnclassifiedQuotes(ctx, t.WorkspaceID)
		n = int(c)
		return err
	})
	return n, err
}

// Classify asks the model to label the quotes nobody has labelled, a few hundred at a time. It returns how many
// are waiting, so a person sees the size of the job they started.
func (s *Service) Classify(ctx context.Context, t store.Tenant) (int, error) {
	if !t.CanWrite() {
		return 0, store.ErrForbidden
	}
	n, err := s.Pending(ctx, t)
	if err != nil || n == 0 {
		return 0, err
	}
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		_, err := s.Jobs.InsertTx(ctx, tx, SentimentArgs{WorkspaceID: t.WorkspaceID, UserID: t.UserID, Max: MaxPerJob}, nil)
		return err
	})
	return n, err
}

// Label records a person's judgement of a quote (label "" removes it). A person's label wins over the model's.
func (s *Service) Label(ctx context.Context, t store.Tenant, kind string, id uuid.UUID, label string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if label != "" && !labels[label] {
		return ErrInvalid("choose positive, neutral, negative or mixed")
	}
	if kind != "evidence" && kind != "highlight" {
		return ErrInvalid("unknown quote type")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		switch {
		case label == "" && kind == "evidence":
			err = q.ClearHumanSentimentEvidence(ctx, dbgen.ClearHumanSentimentEvidenceParams{WorkspaceID: t.WorkspaceID, EvidenceID: uuid.NullUUID{UUID: id, Valid: true}})
		case label == "":
			err = q.ClearHumanSentimentHighlight(ctx, dbgen.ClearHumanSentimentHighlightParams{WorkspaceID: t.WorkspaceID, HighlightID: uuid.NullUUID{UUID: id, Valid: true}})
		case kind == "evidence":
			err = q.UpsertSentimentEvidence(ctx, dbgen.UpsertSentimentEvidenceParams{WorkspaceID: t.WorkspaceID, EvidenceID: uuid.NullUUID{UUID: id, Valid: true}, Source: "human", Label: label, SetBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
		default:
			err = q.UpsertSentimentHighlight(ctx, dbgen.UpsertSentimentHighlightParams{WorkspaceID: t.WorkspaceID, HighlightID: uuid.NullUUID{UUID: id, Valid: true}, Source: "human", Label: label, SetBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
		}
		var pe interface{ SQLState() string }
		if errors.As(err, &pe) && pe.SQLState() == "23503" {
			return ErrNotFound
		}
		return err
	})
}

// LabelItem is one quote in a bulk label change.
type LabelItem struct {
	Kind string
	ID   uuid.UUID
}

// LabelMany sets the same feeling on up to 100 quotes in one transaction. Quotes that no longer exist are
// reported as failed rather than aborting the batch.
func (s *Service) LabelMany(ctx context.Context, t store.Tenant, items []LabelItem, label string) (int, []LabelItem, error) {
	if !t.CanWrite() {
		return 0, nil, store.ErrForbidden
	}
	if label != "" && !labels[label] {
		return 0, nil, ErrInvalid("choose positive, neutral, negative or mixed")
	}
	if len(items) == 0 || len(items) > 100 {
		return 0, nil, ErrInvalid("choose between 1 and 100 quotes")
	}
	updated := 0
	var failed []LabelItem
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		for _, it := range items {
			var err error
			switch {
			case it.Kind != "evidence" && it.Kind != "highlight":
				failed = append(failed, it)
				continue
			}
			// Look it up first: a foreign-key error would abort the whole transaction, losing the rest of the batch.
			if _, err := q.GetQuote(ctx, dbgen.GetQuoteParams{WorkspaceID: t.WorkspaceID, QuoteID: it.ID, Kind: it.Kind}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					failed = append(failed, it)
					continue
				}
				return err
			}
			switch {
			case label == "" && it.Kind == "evidence":
				err = q.ClearHumanSentimentEvidence(ctx, dbgen.ClearHumanSentimentEvidenceParams{WorkspaceID: t.WorkspaceID, EvidenceID: uuid.NullUUID{UUID: it.ID, Valid: true}})
			case label == "":
				err = q.ClearHumanSentimentHighlight(ctx, dbgen.ClearHumanSentimentHighlightParams{WorkspaceID: t.WorkspaceID, HighlightID: uuid.NullUUID{UUID: it.ID, Valid: true}})
			case it.Kind == "evidence":
				err = q.UpsertSentimentEvidence(ctx, dbgen.UpsertSentimentEvidenceParams{WorkspaceID: t.WorkspaceID, EvidenceID: uuid.NullUUID{UUID: it.ID, Valid: true}, Source: "human", Label: label, SetBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
			default:
				err = q.UpsertSentimentHighlight(ctx, dbgen.UpsertSentimentHighlightParams{WorkspaceID: t.WorkspaceID, HighlightID: uuid.NullUUID{UUID: it.ID, Valid: true}, Source: "human", Label: label, SetBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
			}
			var pe interface{ SQLState() string }
			if errors.As(err, &pe) && pe.SQLState() == "23503" {
				failed = append(failed, it)
				continue
			}
			if err != nil {
				return err
			}
			updated++
		}
		return nil
	})
	return updated, failed, err
}

type Sample struct {
	Kind string
	ID   uuid.UUID
	Text string
}

func (s *Service) LabelSample(ctx context.Context, t store.Tenant, n int, seed string) ([]Sample, int, error) {
	if n <= 0 || n > 50 {
		n = 20
	}
	var out []Sample
	var done int
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.SentimentSample(ctx, dbgen.SentimentSampleParams{WorkspaceID: t.WorkspaceID, Seed: seed, MaxRows: int32(n)})
		if err != nil {
			return err
		}
		for _, r := range rows {
			out = append(out, Sample{Kind: r.Kind, ID: r.ID, Text: r.QuoteText})
		}
		c, err := q.CountHumanLabels(ctx, t.WorkspaceID)
		done = int(c)
		return err
	})
	return out, done, err
}

type Pair struct {
	Human, Model string
	N            int
}

type Agreement struct {
	HumanLabelled int // quotes a person has labelled
	Compared      int // of those, quotes the model has also labelled
	Agreed        int
	Accuracy      float64 // Agreed / Compared; zero when nothing is compared
	Target        float64
	Enough        bool // enough quotes compared for the number to count
	MeetsTarget   bool // enough, and at or above the target
	Pairs         []Pair
}

// Agreement is how often the model's label matches a person's, on quotes both have labelled.
func (s *Service) Agreement(ctx context.Context, t store.Tenant) (Agreement, error) {
	a := Agreement{Target: AgreementTarget}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountHumanLabels(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		a.HumanLabelled = int(c)
		rows, err := q.SentimentAgreement(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		for _, r := range rows {
			a.Compared += int(r.N)
			if r.HumanLabel == r.ModelLabel {
				a.Agreed += int(r.N)
			}
			a.Pairs = append(a.Pairs, Pair{Human: r.HumanLabel, Model: r.ModelLabel, N: int(r.N)})
		}
		return nil
	})
	if a.Compared > 0 {
		a.Accuracy = float64(a.Agreed) / float64(a.Compared)
	}
	a.Enough = a.Compared >= EnoughLabelled
	a.MeetsTarget = a.Enough && a.Accuracy >= AgreementTarget
	return a, err
}

func (a Agreement) String() string {
	return fmt.Sprintf("%d of %d (%.0f%%)", a.Agreed, a.Compared, a.Accuracy*100)
}
