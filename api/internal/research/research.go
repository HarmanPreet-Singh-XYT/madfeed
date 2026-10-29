// Package research holds the codebook (tags with definitions), highlights
// (verbatim passages someone marked in a source) and the grounded question
// answering over them. Every highlight is checked against the source text in
// Go and again by a database trigger, exactly like evidence.
package research

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/fulltext"
	"product/api/internal/redact"
	"product/api/internal/spans"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var ErrNotFound = errors.New("research: not found")

// ErrInvalid is a problem with what the caller sent; the text is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ErrConflict means the request is fine but clashes with what exists.
type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

var colors = map[string]bool{"gray": true, "red": true, "orange": true, "yellow": true, "green": true, "teal": true, "blue": true, "purple": true, "pink": true}

type Service struct {
	Pool *pgxpool.Pool
	Jobs *river.Client[pgx.Tx] // for background suggestions; nil switches them off
}

// ------------------------------------------------------------------- tags

type Tag struct {
	ID             uuid.UUID
	Name           string
	Definition     string
	Color          string
	Origin         string
	Archived       bool
	MergedInto     *uuid.UUID
	HighlightCount int
	RequestCount   int
	UndoMergeID    *uuid.UUID // set when this tag was merged away and the merge can still be undone
}

type TagInput struct {
	Name, Definition, Color string
}

func clean(in TagInput) (TagInput, error) {
	in.Name = strings.Join(strings.Fields(in.Name), " ")
	in.Definition = strings.TrimSpace(in.Definition)
	if in.Color == "" {
		in.Color = "gray"
	}
	switch {
	case in.Name == "" || utf8.RuneCountInString(in.Name) > 60:
		return in, ErrInvalid("a tag name must be 1 to 60 characters")
	case utf8.RuneCountInString(in.Definition) > 500:
		return in, ErrInvalid("a definition can be at most 500 characters")
	case !colors[in.Color]:
		return in, ErrInvalid("unknown colour")
	}
	return in, nil
}

func (s *Service) ListTags(ctx context.Context, t store.Tenant, includeArchived bool) ([]Tag, error) {
	var out []Tag
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListTags(ctx, dbgen.ListTagsParams{WorkspaceID: t.WorkspaceID, IncludeArchived: includeArchived})
		for _, r := range rows {
			tg := Tag{ID: r.ID, Name: r.Name, Definition: r.Definition, Color: r.Color, Origin: r.Origin, Archived: r.ArchivedAt.Valid,
				HighlightCount: int(r.HighlightCount), RequestCount: int(r.RequestCount)}
			if r.MergedInto.Valid {
				id := r.MergedInto.UUID
				tg.MergedInto = &id
			}
			if r.UndoMergeID != uuid.Nil {
				id := r.UndoMergeID
				tg.UndoMergeID = &id
			}
			out = append(out, tg)
		}
		return err
	})
	return out, err
}

func isUnique(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func (s *Service) CreateTag(ctx context.Context, t store.Tenant, in TagInput) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	in, err := clean(in)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		tg, err := q.InsertTag(ctx, dbgen.InsertTagParams{WorkspaceID: t.WorkspaceID, Btrim: in.Name, Definition: in.Definition, Color: in.Color, Origin: "human", CreatedBy: t.UserID})
		id = tg.ID
		return err
	})
	if isUnique(err) {
		return uuid.Nil, ErrConflict("a tag with that name already exists")
	}
	return id, err
}

func (s *Service) UpdateTag(ctx context.Context, t store.Tenant, id uuid.UUID, in TagInput) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	in, err := clean(in)
	if err != nil {
		return err
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateTag(ctx, dbgen.UpdateTagParams{WorkspaceID: t.WorkspaceID, ID: id, Btrim: in.Name, Definition: in.Definition, Color: in.Color})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
	if isUnique(err) {
		return ErrConflict("a tag with that name already exists")
	}
	return err
}

// ArchiveTag hides a tag from pickers without touching what it is applied
// to; RestoreTag brings it back. Nothing is ever lost.
func (s *Service) ArchiveTag(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.ArchiveTag(ctx, dbgen.ArchiveTagParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
}

func (s *Service) RestoreTag(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.RestoreTag(ctx, dbgen.RestoreTagParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
	if isUnique(err) {
		return ErrConflict("another tag now has that name; rename one of them first")
	}
	return err
}

type MergeResult struct {
	MergeID    uuid.UUID
	Highlights int
	Requests   int
}

// MergeTags moves everything tagged `source` onto `target`, then archives
// `source` (pointing at the target). It is one transaction and is recorded so
// UndoMerge can put things back exactly.
func (s *Service) MergeTags(ctx context.Context, t store.Tenant, source, target uuid.UUID) (MergeResult, error) {
	var res MergeResult
	if !t.Can(store.PermManage) {
		return res, store.ErrForbidden
	}
	if source == target {
		return res, ErrInvalid("choose two different tags")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		// Lock in a fixed order so two merges cannot deadlock.
		first, second := source, target
		if strings.Compare(first.String(), second.String()) > 0 {
			first, second = second, first
		}
		tags := map[uuid.UUID]dbgen.Tag{}
		for _, id := range []uuid.UUID{first, second} {
			tg, err := q.GetTagForUpdate(ctx, dbgen.GetTagForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
			tags[id] = tg
		}
		if tags[source].ArchivedAt.Valid || tags[target].ArchivedAt.Valid {
			return ErrConflict("an archived tag cannot be merged; restore it first")
		}
		keptH, err := q.HighlightsWithBothTags(ctx, dbgen.HighlightsWithBothTagsParams{WorkspaceID: t.WorkspaceID, TagID: source, TagID_2: target})
		if err != nil {
			return err
		}
		keptR, err := q.RequestsWithBothTags(ctx, dbgen.RequestsWithBothTagsParams{WorkspaceID: t.WorkspaceID, TagID: source, TagID_2: target})
		if err != nil {
			return err
		}
		hs, err := q.MoveHighlightTags(ctx, dbgen.MoveHighlightTagsParams{WorkspaceID: t.WorkspaceID, TagID: source, TagID_2: target})
		if err != nil {
			return err
		}
		rs, err := q.MoveRequestTags(ctx, dbgen.MoveRequestTagsParams{WorkspaceID: t.WorkspaceID, TagID: source, TagID_2: target})
		if err != nil {
			return err
		}
		if err := q.MarkTagMerged(ctx, dbgen.MarkTagMergedParams{WorkspaceID: t.WorkspaceID, ID: source, MergedInto: uuid.NullUUID{UUID: target, Valid: true}}); err != nil {
			return err
		}
		m, err := q.InsertTagMerge(ctx, dbgen.InsertTagMergeParams{
			WorkspaceID: t.WorkspaceID, SourceTagID: source, TargetTagID: target,
			HighlightIds: nonNil(hs), RequestIds: nonNil(rs), KeptHighlightIds: nonNil(keptH), KeptRequestIds: nonNil(keptR), MergedBy: t.UserID,
		})
		res = MergeResult{MergeID: m.ID, Highlights: len(hs), Requests: len(rs)}
		return err
	})
	return res, err
}

func nonNil(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}

// UndoMerge restores the source tag and gives it back to exactly the items it
// was moved from. Items that already had the target tag keep it.
func (s *Service) UndoMerge(ctx context.Context, t store.Tenant, mergeID uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetTagMergeForUpdate(ctx, dbgen.GetTagMergeForUpdateParams{WorkspaceID: t.WorkspaceID, ID: mergeID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UndoneAt.Valid {
			return ErrConflict("this merge was already undone")
		}
		if n, err := q.RestoreTag(ctx, dbgen.RestoreTagParams{WorkspaceID: t.WorkspaceID, ID: m.SourceTagID}); err != nil {
			if isUnique(err) {
				return ErrConflict("another tag now has the old name; rename it first")
			}
			return err
		} else if n == 0 {
			return ErrConflict("the merged tag is no longer archived")
		}
		toRemoveH := minus(m.HighlightIds, m.KeptHighlightIds)
		toRemoveR := minus(m.RequestIds, m.KeptRequestIds)
		if err := q.RemoveTagFromHighlights(ctx, dbgen.RemoveTagFromHighlightsParams{WorkspaceID: t.WorkspaceID, TagID: m.TargetTagID, HighlightIds: toRemoveH}); err != nil {
			return err
		}
		if err := q.RemoveTagFromRequests(ctx, dbgen.RemoveTagFromRequestsParams{WorkspaceID: t.WorkspaceID, TagID: m.TargetTagID, RequestIds: toRemoveR}); err != nil {
			return err
		}
		if err := q.AddTagToHighlights(ctx, dbgen.AddTagToHighlightsParams{WorkspaceID: t.WorkspaceID, TagID: m.SourceTagID, HighlightIds: m.HighlightIds}); err != nil {
			return err
		}
		if err := q.AddTagToRequests(ctx, dbgen.AddTagToRequestsParams{WorkspaceID: t.WorkspaceID, TagID: m.SourceTagID, RequestIds: m.RequestIds}); err != nil {
			return err
		}
		return q.MarkTagMergeUndone(ctx, dbgen.MarkTagMergeUndoneParams{WorkspaceID: t.WorkspaceID, ID: mergeID})
	})
}

func minus(all, drop []uuid.UUID) []uuid.UUID {
	skip := map[uuid.UUID]bool{}
	for _, d := range drop {
		skip[d] = true
	}
	out := []uuid.UUID{}
	for _, a := range all {
		if !skip[a] {
			out = append(out, a)
		}
	}
	return out
}

// LatestMerge returns the most recent merge of this (now archived) tag that
// can still be undone, or ErrNotFound.
func (s *Service) LatestMerge(ctx context.Context, t store.Tenant, source uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.LatestMergeForSource(ctx, dbgen.LatestMergeForSourceParams{WorkspaceID: t.WorkspaceID, SourceTagID: source})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		id = m.ID
		return err
	})
	return id, err
}

// -------------------------------------------------------------- highlights

type TagRef struct {
	ID    uuid.UUID
	Name  string
	Color string
}

type Highlight struct {
	ID           uuid.UUID
	SourceItemID uuid.UUID
	SourceTitle  string
	SpanStart    int
	SpanEnd      int
	Quote        string
	Note         string
	Tags         []TagRef
	CreatedAt    time.Time
	StartMS      *int // where in the recording this was said; nil for a pasted conversation
}

type HighlightInput struct {
	SourceItemID uuid.UUID
	SpanStart    int // byte offsets into the source text
	SpanEnd      int
	Quote        string // what the client believes is there; must match exactly
	Note         string
	TagIDs       []uuid.UUID
}

const maxTagsPerHighlight = 10

// CreateHighlight stores a passage of a source. The quote is read from the
// source itself, never taken from the client; a client quote that differs is
// refused, which catches stale or tampered offsets.
func (s *Service) CreateHighlight(ctx context.Context, t store.Tenant, in HighlightInput) (Highlight, error) {
	var out Highlight
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		out, err = createHighlight(ctx, q, t, in)
		return err
	})
	return out, err
}

func createHighlight(ctx context.Context, q *dbgen.Queries, t store.Tenant, in HighlightInput) (Highlight, error) {
	var out Highlight
	in.Note = redact.Text(strings.TrimSpace(in.Note)).Text
	if utf8.RuneCountInString(in.Note) > 1000 {
		return out, ErrInvalid("a note can be at most 1,000 characters")
	}
	if len(in.TagIDs) > maxTagsPerHighlight {
		return out, ErrInvalid("a highlight can have at most 10 tags")
	}
	src, err := q.GetSourceItem(ctx, dbgen.GetSourceItemParams{WorkspaceID: t.WorkspaceID, ID: in.SourceItemID})
	if errors.Is(err, pgx.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if err := spans.Validate(src.RawText, in.SpanStart, in.SpanEnd, in.Quote); err != nil {
		return out, ErrInvalid("that passage no longer matches the conversation; reload and select it again")
	}
	if in.SpanEnd-in.SpanStart > 2000 {
		return out, ErrInvalid("a highlight can be at most 2,000 characters; select a shorter passage")
	}
	ch, err := q.FindChunkForOffset(ctx, dbgen.FindChunkForOffsetParams{WorkspaceID: t.WorkspaceID, SourceItemID: in.SourceItemID, StartOffset: int32(in.SpanStart)})
	if err != nil {
		return out, err
	}
	h, err := q.InsertHighlight(ctx, dbgen.InsertHighlightParams{
		WorkspaceID: t.WorkspaceID, SourceItemID: in.SourceItemID, ChunkID: ch.ID,
		SpanStart: int32(in.SpanStart), SpanEnd: int32(in.SpanEnd), QuoteText: in.Quote, Note: in.Note, AuthorID: t.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) { // already highlighted: return the existing one
		h, err = q.GetHighlightBySpan(ctx, dbgen.GetHighlightBySpanParams{WorkspaceID: t.WorkspaceID, SourceItemID: in.SourceItemID, SpanStart: int32(in.SpanStart), SpanEnd: int32(in.SpanEnd)})
	}
	if err != nil {
		return out, err
	}
	for _, tid := range in.TagIDs {
		tg, err := q.GetTag(ctx, dbgen.GetTagParams{WorkspaceID: t.WorkspaceID, ID: tid})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && tg.ArchivedAt.Valid) {
			return out, ErrInvalid("one of the tags does not exist or is archived")
		}
		if err != nil {
			return out, err
		}
		if err := q.SetHighlightTag(ctx, dbgen.SetHighlightTagParams{WorkspaceID: t.WorkspaceID, HighlightID: h.ID, TagID: tid}); err != nil {
			return out, err
		}
	}
	out = Highlight{ID: h.ID, SourceItemID: h.SourceItemID, SourceTitle: src.Title, SpanStart: int(h.SpanStart), SpanEnd: int(h.SpanEnd), Quote: h.QuoteText, Note: h.Note, CreatedAt: h.CreatedAt}
	tags, err := tagsFor(ctx, q, t.WorkspaceID, []uuid.UUID{h.ID})
	out.Tags = tags[h.ID]
	return out, err
}

func tagsFor(ctx context.Context, q *dbgen.Queries, ws uuid.UUID, ids []uuid.UUID) (map[uuid.UUID][]TagRef, error) {
	m := map[uuid.UUID][]TagRef{}
	if len(ids) == 0 {
		return m, nil
	}
	rows, err := q.ListTagsForHighlights(ctx, dbgen.ListTagsForHighlightsParams{WorkspaceID: ws, HighlightIds: ids})
	for _, r := range rows {
		m[r.HighlightID] = append(m[r.HighlightID], TagRef{ID: r.ID, Name: r.Name, Color: r.Color})
	}
	return m, err
}

func (s *Service) DeleteHighlight(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.DeleteHighlight(ctx, dbgen.DeleteHighlightParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
}

// SetHighlightTags replaces the tags on a highlight with exactly `tagIDs`.
func (s *Service) SetHighlightTags(ctx context.Context, t store.Tenant, id uuid.UUID, tagIDs []uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if len(tagIDs) > maxTagsPerHighlight {
		return ErrInvalid("a highlight can have at most 10 tags")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.GetHighlight(ctx, dbgen.GetHighlightParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		want := map[uuid.UUID]bool{}
		for _, tid := range tagIDs {
			tg, err := q.GetTag(ctx, dbgen.GetTagParams{WorkspaceID: t.WorkspaceID, ID: tid})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && tg.ArchivedAt.Valid) {
				return ErrInvalid("one of the tags does not exist or is archived")
			}
			if err != nil {
				return err
			}
			want[tid] = true
		}
		current, err := tagsFor(ctx, q, t.WorkspaceID, []uuid.UUID{id})
		if err != nil {
			return err
		}
		for _, c := range current[id] {
			if !want[c.ID] {
				if err := q.UnsetHighlightTag(ctx, dbgen.UnsetHighlightTagParams{WorkspaceID: t.WorkspaceID, HighlightID: id, TagID: c.ID}); err != nil {
					return err
				}
			}
		}
		for tid := range want {
			if err := q.SetHighlightTag(ctx, dbgen.SetHighlightTagParams{WorkspaceID: t.WorkspaceID, HighlightID: id, TagID: tid}); err != nil {
				return err
			}
		}
		return nil
	})
}

type ListFilter struct {
	TagIDs       []uuid.UUID // any of these tags; empty means no tag filter
	SourceItemID *uuid.UUID
	Untagged     bool   // only highlights nobody has tagged yet
	Search       string // words that must appear in the quote
	AfterCreated *time.Time
	AfterID      *uuid.UUID
	Limit        int
}

// HighlightPage is one page of highlights, plus how many match the filter as a
// whole (so the page can say "showing 30 of 128" without a second request).
type HighlightPage struct {
	Highlights []Highlight
	Total      int
}

func (s *Service) ListHighlights(ctx context.Context, t store.Tenant, f ListFilter) (HighlightPage, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 50
	}
	var out HighlightPage
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		tagIDs := f.TagIDs
		if tagIDs == nil {
			tagIDs = []uuid.UUID{}
		}
		p := dbgen.ListHighlightsParams{WorkspaceID: t.WorkspaceID, PageSize: int32(f.Limit), TagIds: tagIDs, Untagged: f.Untagged}
		if q := fulltext.Query(f.Search); q != "" {
			p.Search = pgtype.Text{String: q, Valid: true}
		}
		if f.SourceItemID != nil {
			p.SourceItemID = uuid.NullUUID{UUID: *f.SourceItemID, Valid: true}
		}
		if f.AfterCreated != nil && f.AfterID != nil {
			p.AfterCreated = pgtype.Timestamptz{Time: *f.AfterCreated, Valid: true}
			p.AfterID = uuid.NullUUID{UUID: *f.AfterID, Valid: true}
		}
		rows, err := q.ListHighlights(ctx, p)
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
			out.Total = int(r.TotalCount)
		}
		tags, err := tagsFor(ctx, q, t.WorkspaceID, ids)
		if err != nil {
			return err
		}
		for _, r := range rows {
			h := Highlight{ID: r.ID, SourceItemID: r.SourceItemID, SourceTitle: r.SourceTitle, SpanStart: int(r.SpanStart), SpanEnd: int(r.SpanEnd),
				Quote: r.QuoteText, Note: r.Note, Tags: tags[r.ID], CreatedAt: r.CreatedAt}
			if r.StartMs >= 0 {
				ms := int(r.StartMs)
				h.StartMS = &ms
			}
			out.Highlights = append(out.Highlights, h)
		}
		return nil
	})
	return out, err
}

const (
	maxBulkHighlights = 100
	maxTagsPerBulk    = 10
)

// AddTagsToHighlights puts tags on a batch of highlights at once. Everything is
// checked before anything is written, so a batch either applies to all of them
// or to none. It returns how many highlights were tagged.
func (s *Service) AddTagsToHighlights(ctx context.Context, t store.Tenant, highlightIDs, tagIDs []uuid.UUID) (int, error) {
	if !t.CanWrite() {
		return 0, store.ErrForbidden
	}
	ids := dedupe(highlightIDs)
	if len(ids) == 0 || len(ids) > maxBulkHighlights {
		return 0, ErrInvalid("choose between 1 and 100 highlights")
	}
	if len(tagIDs) == 0 || len(tagIDs) > maxTagsPerBulk {
		return 0, ErrInvalid("choose between 1 and 10 tags")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		for _, tid := range tagIDs {
			tg, err := q.GetTag(ctx, dbgen.GetTagParams{WorkspaceID: t.WorkspaceID, ID: tid})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && tg.ArchivedAt.Valid) {
				return ErrInvalid("one of the tags does not exist or is archived")
			}
			if err != nil {
				return err
			}
		}
		n, err := q.CountHighlightsByIDs(ctx, dbgen.CountHighlightsByIDsParams{WorkspaceID: t.WorkspaceID, Ids: ids})
		if err != nil {
			return err
		}
		if int(n) != len(ids) {
			return ErrNotFound
		}
		_, err = q.AddTagsToHighlights(ctx, dbgen.AddTagsToHighlightsParams{WorkspaceID: t.WorkspaceID, HighlightIds: ids, TagIds: tagIDs})
		return err
	})
	return len(ids), err
}

func dedupe(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func pgText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

// SetRequestTags replaces the tags on a request with exactly `tagIDs`.
func (s *Service) SetRequestTags(ctx context.Context, t store.Tenant, requestID uuid.UUID, tagIDs []uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if len(tagIDs) > maxTagsPerHighlight {
		return ErrInvalid("a request can have at most 10 tags")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.GetRequestImpact(ctx, dbgen.GetRequestImpactParams{WorkspaceID: t.WorkspaceID, RequestID: requestID}); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		want := map[uuid.UUID]bool{}
		for _, tid := range tagIDs {
			tg, err := q.GetTag(ctx, dbgen.GetTagParams{WorkspaceID: t.WorkspaceID, ID: tid})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && tg.ArchivedAt.Valid) {
				return ErrInvalid("one of the tags does not exist or is archived")
			}
			if err != nil {
				return err
			}
			want[tid] = true
		}
		current, err := q.ListTagsForRequest(ctx, dbgen.ListTagsForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		for _, c := range current {
			if !want[c.ID] {
				if err := q.UnsetRequestTag(ctx, dbgen.UnsetRequestTagParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, TagID: c.ID}); err != nil {
					return err
				}
			}
		}
		for tid := range want {
			if err := q.SetRequestTag(ctx, dbgen.SetRequestTagParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, TagID: tid}); err != nil {
				return err
			}
		}
		return nil
	})
}

// TagsForRequest lists the live tags on a request.
func (s *Service) TagsForRequest(ctx context.Context, t store.Tenant, requestID uuid.UUID) ([]TagRef, error) {
	var out []TagRef
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListTagsForRequest(ctx, dbgen.ListTagsForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		for _, r := range rows {
			out = append(out, TagRef{ID: r.ID, Name: r.Name, Color: r.Color})
		}
		return err
	})
	return out, err
}
