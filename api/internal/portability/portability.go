// Package portability exports a workspace's data in an open JSON format and
// reads that format back into an empty workspace. Customers own their data, and
// the round trip is how we prove nothing is lost or invented.
//
// The format carries accounts, people, source texts, requests, evidence, the
// tag codebook, highlights and the tags on requests and highlights. It leaves
// out derived or transient data: chunks (rebuilt from the text), the review
// queue, briefs, questions and answers, and AI events. It also carries the
// opt-out list, so a restored workspace never writes to someone who asked to
// stop. It does not yet carry statuses, release notes or outreach messages.
package portability

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/spans"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	Version   = "workspace-export-v1"
	batchSize = 1000
	chunkSize = 6000
)

var (
	ErrNotAdmin  = errors.New("portability: only an admin can export or import a workspace")
	ErrNotEmpty  = errors.New("portability: the workspace already has data; import into an empty workspace")
	ErrBadFormat = errors.New("portability: this is not a valid workspace export")
)

type Account struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Domain      *string   `json:"domain,omitempty"`
	Revenue     *string   `json:"revenue,omitempty"`
	Plan        *string   `json:"plan,omitempty"`
	RenewalDate *string   `json:"renewalDate,omitempty"`
}

type Person struct {
	ID        uuid.UUID  `json:"id"`
	Name      string     `json:"name"`
	Email     *string    `json:"email,omitempty"`
	AccountID *uuid.UUID `json:"accountId,omitempty"`
}

type Source struct {
	ID        uuid.UUID  `json:"id"`
	Title     string     `json:"title"`
	Text      string     `json:"text"`
	OriginURL *string    `json:"originUrl,omitempty"`
	PersonID  *uuid.UUID `json:"personId,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type Request struct {
	ID         uuid.UUID   `json:"id"`
	Title      string      `json:"title"`
	Summary    string      `json:"summary,omitempty"`
	CreatedVia string      `json:"createdVia"`
	CreatedAt  time.Time   `json:"createdAt"`
	TagIDs     []uuid.UUID `json:"tagIds,omitempty"`
	StatusID   *uuid.UUID  `json:"statusId,omitempty"`
}

type Status struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Bucket   string    `json:"bucket"`
	Position int       `json:"position"`
}

type ReleaseNote struct {
	ID           uuid.UUID   `json:"id"`
	Title        string      `json:"title"`
	Body         string      `json:"body"`
	State        string      `json:"state"`
	ScheduledFor *time.Time  `json:"scheduledFor,omitempty"`
	PublishedAt  *time.Time  `json:"publishedAt,omitempty"`
	RequestIDs   []uuid.UUID `json:"requestIds,omitempty"`
	CreatedAt    time.Time   `json:"createdAt"`
}

type Tag struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Definition string    `json:"definition,omitempty"`
	Color      string    `json:"color"`
	Origin     string    `json:"origin"`
	Archived   bool      `json:"archived,omitempty"`
}

type Highlight struct {
	ID        uuid.UUID   `json:"id"`
	SourceID  uuid.UUID   `json:"sourceId"`
	Quote     string      `json:"quote"`
	SpanStart int         `json:"spanStart"` // byte offsets into the source text
	SpanEnd   int         `json:"spanEnd"`
	Note      string      `json:"note,omitempty"`
	TagIDs    []uuid.UUID `json:"tagIds,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
}

type Suppression struct {
	Email     string    `json:"email"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

type Evidence struct {
	ID         uuid.UUID  `json:"id"`
	RequestID  uuid.UUID  `json:"requestId"`
	SourceID   uuid.UUID  `json:"sourceId"`
	PersonID   *uuid.UUID `json:"personId,omitempty"`
	Quote      string     `json:"quote"`
	SpanStart  int        `json:"spanStart"` // byte offsets into the source text
	SpanEnd    int        `json:"spanEnd"`
	Confidence *float32   `json:"confidence,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type Document struct {
	Version    string    `json:"version"`
	ExportedAt time.Time `json:"exportedAt"`
	Workspace  struct {
		Name string `json:"name"`
	} `json:"workspace"`
	Accounts []Account  `json:"accounts"`
	People   []Person   `json:"people"`
	Sources  []Source   `json:"sources"`
	Requests []Request  `json:"requests"`
	Evidence []Evidence `json:"evidence"`
	// Added after v1 shipped; absent in older exports, which still import.
	Tags         []Tag         `json:"tags,omitempty"`
	Highlights   []Highlight   `json:"highlights,omitempty"`
	Suppressions []Suppression `json:"suppressions,omitempty"`
	Statuses     []Status      `json:"statuses,omitempty"`
	ReleaseNotes []ReleaseNote `json:"releaseNotes,omitempty"`
}

type Service struct{ Pool *pgxpool.Pool }

// streamArray writes `,"key":[...]` one page at a time. Pages are fetched by
// id (keyset), so memory stays flat however large the workspace is.
func streamArray[T any](w io.Writer, key string, size int, fetch func(after uuid.UUID) ([]T, error), idOf func(T) uuid.UUID, conv func(T) any) error {
	if _, err := fmt.Fprintf(w, `,%q:[`, key); err != nil {
		return err
	}
	after, first := uuid.Nil, true
	for {
		rows, err := fetch(after)
		if err != nil {
			return err
		}
		for _, r := range rows {
			b, err := json.Marshal(conv(r))
			if err != nil {
				return err
			}
			if !first {
				if _, err := w.Write([]byte(",")); err != nil {
					return err
				}
			}
			first = false
			if _, err := w.Write(b); err != nil {
				return err
			}
			after = idOf(r)
		}
		if len(rows) < size {
			break
		}
	}
	_, err := w.Write([]byte("]"))
	return err
}

// Export streams the workspace as JSON from one consistent snapshot.
func (s *Service) Export(ctx context.Context, t store.Tenant, w io.Writer) error {
	if t.Role != store.RoleAdmin {
		return ErrNotAdmin
	}
	return store.WithTenantSnapshot(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		var name string
		if err := tx.QueryRow(ctx, `SELECT name FROM workspace WHERE id = $1`, t.WorkspaceID).Scan(&name); err != nil {
			return err
		}
		nameJSON, _ := json.Marshal(name)
		if _, err := fmt.Fprintf(w, `{"version":%q,"exportedAt":%q,"workspace":{"name":%s}`, Version, time.Now().UTC().Format(time.RFC3339), nameJSON); err != nil {
			return err
		}
		ws := t.WorkspaceID
		if err := streamArray(w, "accounts", batchSize,
			func(after uuid.UUID) ([]dbgen.Account, error) {
				return q.ExportAccountsPage(ctx, dbgen.ExportAccountsPageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.Account) uuid.UUID { return r.ID },
			func(r dbgen.Account) any {
				return Account{ID: r.ID, Name: r.Name, Domain: txt(r.Domain), Revenue: num(r.Revenue), Plan: txt(r.Plan), RenewalDate: date(r.RenewalDate)}
			}); err != nil {
			return err
		}
		if err := streamArray(w, "people", batchSize,
			func(after uuid.UUID) ([]dbgen.Person, error) {
				return q.ExportPeoplePage(ctx, dbgen.ExportPeoplePageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.Person) uuid.UUID { return r.ID },
			func(r dbgen.Person) any {
				return Person{ID: r.ID, Name: r.Name, Email: txt(r.Email), AccountID: nid(r.AccountID)}
			}); err != nil {
			return err
		}
		const sourcePage = 100 // source texts are large
		if err := streamArray(w, "sources", sourcePage,
			func(after uuid.UUID) ([]dbgen.SourceItem, error) {
				return q.ExportSourcesPage(ctx, dbgen.ExportSourcesPageParams{WorkspaceID: ws, ID: after, PageSize: sourcePage})
			},
			func(r dbgen.SourceItem) uuid.UUID { return r.ID },
			func(r dbgen.SourceItem) any {
				return Source{ID: r.ID, Title: r.Title, Text: r.RawText, OriginURL: txt(r.OriginUrl), PersonID: nid(r.PersonID), CreatedAt: r.CreatedAt}
			}); err != nil {
			return err
		}
		if err := streamArray(w, "statuses", batchSize,
			func(after uuid.UUID) ([]dbgen.Status, error) {
				return q.ExportStatusesPage(ctx, dbgen.ExportStatusesPageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.Status) uuid.UUID { return r.ID },
			func(r dbgen.Status) any {
				return Status{ID: r.ID, Name: r.Name, Bucket: r.Bucket, Position: int(r.Position)}
			}); err != nil {
			return err
		}
		if err := streamArray(w, "requests", batchSize,
			func(after uuid.UUID) ([]dbgen.ExportRequestsPageRow, error) {
				return q.ExportRequestsPage(ctx, dbgen.ExportRequestsPageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.ExportRequestsPageRow) uuid.UUID { return r.ID },
			func(r dbgen.ExportRequestsPageRow) any {
				st := r.StatusID
				return Request{ID: r.ID, Title: r.Title, Summary: r.Summary, CreatedVia: r.CreatedVia, CreatedAt: r.CreatedAt, TagIDs: r.TagIds, StatusID: &st}
			}); err != nil {
			return err
		}
		if err := streamArray(w, "evidence", batchSize,
			func(after uuid.UUID) ([]dbgen.Evidence, error) {
				return q.ExportEvidencePage(ctx, dbgen.ExportEvidencePageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.Evidence) uuid.UUID { return r.ID },
			func(r dbgen.Evidence) any {
				e := Evidence{ID: r.ID, RequestID: r.RequestID, SourceID: r.SourceItemID, PersonID: nid(r.PersonID), Quote: r.QuoteText, SpanStart: int(r.SpanStart), SpanEnd: int(r.SpanEnd), CreatedAt: r.CreatedAt}
				if r.Confidence.Valid {
					c := r.Confidence.Float32
					e.Confidence = &c
				}
				return e
			}); err != nil {
			return err
		}
		if err := streamArray(w, "tags", batchSize,
			func(after uuid.UUID) ([]dbgen.Tag, error) {
				return q.ExportTagsPage(ctx, dbgen.ExportTagsPageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.Tag) uuid.UUID { return r.ID },
			func(r dbgen.Tag) any {
				return Tag{ID: r.ID, Name: r.Name, Definition: r.Definition, Color: r.Color, Origin: r.Origin, Archived: r.ArchivedAt.Valid}
			}); err != nil {
			return err
		}
		if err := streamArray(w, "highlights", batchSize,
			func(after uuid.UUID) ([]dbgen.ExportHighlightsPageRow, error) {
				return q.ExportHighlightsPage(ctx, dbgen.ExportHighlightsPageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.ExportHighlightsPageRow) uuid.UUID { return r.ID },
			func(r dbgen.ExportHighlightsPageRow) any {
				return Highlight{ID: r.ID, SourceID: r.SourceItemID, Quote: r.QuoteText, SpanStart: int(r.SpanStart), SpanEnd: int(r.SpanEnd), Note: r.Note, TagIDs: r.TagIds, CreatedAt: r.CreatedAt}
			}); err != nil {
			return err
		}
		if err := streamArray(w, "releaseNotes", batchSize,
			func(after uuid.UUID) ([]dbgen.ExportNotesPageRow, error) {
				return q.ExportNotesPage(ctx, dbgen.ExportNotesPageParams{WorkspaceID: ws, ID: after, PageSize: batchSize})
			},
			func(r dbgen.ExportNotesPageRow) uuid.UUID { return r.ID },
			func(r dbgen.ExportNotesPageRow) any {
				n := ReleaseNote{ID: r.ID, Title: r.Title, Body: r.Body, State: r.State, RequestIDs: r.RequestIds, CreatedAt: r.CreatedAt}
				if r.ScheduledFor.Valid {
					n.ScheduledFor = &r.ScheduledFor.Time
				}
				if r.PublishedAt.Valid {
					n.PublishedAt = &r.PublishedAt.Time
				}
				return n
			}); err != nil {
			return err
		}
		// The opt-out list is keyed by address, not id, so it pages by address.
		if _, err := w.Write([]byte(`,"suppressions":[`)); err != nil {
			return err
		}
		after, first := "", true
		for {
			rows, err := q.ExportSuppressionsPage(ctx, dbgen.ExportSuppressionsPageParams{WorkspaceID: ws, Email: after, PageSize: batchSize})
			if err != nil {
				return err
			}
			for _, r := range rows {
				b, _ := json.Marshal(Suppression{Email: r.Email, Reason: r.Reason, CreatedAt: r.CreatedAt})
				if !first {
					_, _ = w.Write([]byte(","))
				}
				first = false
				if _, err := w.Write(b); err != nil {
					return err
				}
				after = r.Email
			}
			if len(rows) < batchSize {
				break
			}
		}
		_, err := w.Write([]byte("]}\n"))
		return err
	})
}

// Verify checks a document on its own, with no database: every quote must equal
// the source text at its span, and every reference must point at something in
// the file. It is what makes an export trustworthy to a customer or an auditor.
func Verify(d *Document) error {
	if d.Version != Version {
		return fmt.Errorf("%w: unknown version %q", ErrBadFormat, d.Version)
	}
	accounts, people, sources, requests := map[uuid.UUID]bool{}, map[uuid.UUID]bool{}, map[uuid.UUID]string{}, map[uuid.UUID]bool{}
	for _, a := range d.Accounts {
		accounts[a.ID] = true
	}
	for _, p := range d.People {
		if p.AccountID != nil && !accounts[*p.AccountID] {
			return fmt.Errorf("%w: person %s points at a missing account", ErrBadFormat, p.ID)
		}
		people[p.ID] = true
	}
	for _, s := range d.Sources {
		if s.PersonID != nil && !people[*s.PersonID] {
			return fmt.Errorf("%w: source %s points at a missing person", ErrBadFormat, s.ID)
		}
		sources[s.ID] = s.Text
	}
	statuses := map[uuid.UUID]bool{}
	for _, st := range d.Statuses {
		switch st.Bucket {
		case "open", "active", "done", "closed":
		default:
			return fmt.Errorf("%w: status %q has an unknown type", ErrBadFormat, st.Name)
		}
		if statuses[st.ID] {
			return fmt.Errorf("%w: status %s appears twice", ErrBadFormat, st.ID)
		}
		statuses[st.ID] = true
	}
	tags := map[uuid.UUID]bool{}
	for _, tg := range d.Tags {
		if tags[tg.ID] {
			return fmt.Errorf("%w: tag %s appears twice", ErrBadFormat, tg.ID)
		}
		tags[tg.ID] = true
	}
	for _, r := range d.Requests {
		requests[r.ID] = true
		if len(d.Statuses) > 0 && (r.StatusID == nil || !statuses[*r.StatusID]) {
			return fmt.Errorf("%w: request %s has no valid status", ErrBadFormat, r.ID)
		}
		for _, tid := range r.TagIDs {
			if !tags[tid] {
				return fmt.Errorf("%w: request %s points at a missing tag", ErrBadFormat, r.ID)
			}
		}
	}
	for _, n := range d.ReleaseNotes {
		switch n.State {
		case "draft", "published", "unpublished":
		case "scheduled":
			if n.ScheduledFor == nil {
				return fmt.Errorf("%w: scheduled note %s has no time", ErrBadFormat, n.ID)
			}
		default:
			return fmt.Errorf("%w: release note %s has an unknown state", ErrBadFormat, n.ID)
		}
		for _, rid := range n.RequestIDs {
			if !requests[rid] {
				return fmt.Errorf("%w: release note %s points at a missing request", ErrBadFormat, n.ID)
			}
		}
	}
	seen := map[string]bool{}
	for _, x := range d.Suppressions {
		if x.Email == "" || x.Email != strings.ToLower(x.Email) || seen[x.Email] {
			return fmt.Errorf("%w: opt-out list has a blank, mixed-case or repeated address", ErrBadFormat)
		}
		switch x.Reason {
		case "unsubscribed", "bounced", "complained", "manual":
		default:
			return fmt.Errorf("%w: unknown opt-out reason %q", ErrBadFormat, x.Reason)
		}
		seen[x.Email] = true
	}
	for _, h := range d.Highlights {
		text, ok := sources[h.SourceID]
		if !ok {
			return fmt.Errorf("%w: highlight %s points at a missing source", ErrBadFormat, h.ID)
		}
		for _, tid := range h.TagIDs {
			if !tags[tid] {
				return fmt.Errorf("%w: highlight %s points at a missing tag", ErrBadFormat, h.ID)
			}
		}
		if err := spans.Validate(text, h.SpanStart, h.SpanEnd, h.Quote); err != nil {
			return fmt.Errorf("%w: highlight %s: %v", ErrBadFormat, h.ID, err)
		}
	}
	for _, e := range d.Evidence {
		text, ok := sources[e.SourceID]
		if !ok || !requests[e.RequestID] || (e.PersonID != nil && !people[*e.PersonID]) {
			return fmt.Errorf("%w: evidence %s points at something missing", ErrBadFormat, e.ID)
		}
		if err := spans.Validate(text, e.SpanStart, e.SpanEnd, e.Quote); err != nil {
			return fmt.Errorf("%w: evidence %s: %v", ErrBadFormat, e.ID, err)
		}
	}
	return nil
}

// Import reads an export into an empty workspace with fresh ids, all or nothing.
// Quotes are re-checked by the database against the source text on the way in.
func (s *Service) Import(ctx context.Context, t store.Tenant, r io.Reader) error {
	if t.Role != store.RoleAdmin {
		return ErrNotAdmin
	}
	var d Document
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return fmt.Errorf("%w: %v", ErrBadFormat, err)
	}
	if err := Verify(&d); err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		empty, err := q.WorkspaceIsEmpty(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if !empty.Bool {
			return ErrNotEmpty
		}
		acct, ppl, src, req := map[uuid.UUID]uuid.UUID{}, map[uuid.UUID]uuid.UUID{}, map[uuid.UUID]uuid.UUID{}, map[uuid.UUID]uuid.UUID{}
		for _, a := range d.Accounts {
			id := uuid.New()
			acct[a.ID] = id
			var rev pgtype.Numeric
			if a.Revenue != nil {
				if err := rev.Scan(*a.Revenue); err != nil {
					return fmt.Errorf("%w: revenue", ErrBadFormat)
				}
			}
			var renewal pgtype.Date
			if a.RenewalDate != nil {
				dt, err := time.Parse("2006-01-02", *a.RenewalDate)
				if err != nil {
					return fmt.Errorf("%w: renewal date", ErrBadFormat)
				}
				renewal = pgtype.Date{Time: dt, Valid: true}
			}
			if _, err := tx.Exec(ctx, `INSERT INTO account (id, workspace_id, name, domain, revenue, plan, renewal_date) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				id, t.WorkspaceID, a.Name, a.Domain, rev, a.Plan, renewal); err != nil {
				return fmt.Errorf("account %q: %w", a.Name, err)
			}
		}
		for _, p := range d.People {
			id := uuid.New()
			ppl[p.ID] = id
			var acc any
			if p.AccountID != nil {
				acc = acct[*p.AccountID]
			}
			if _, err := tx.Exec(ctx, `INSERT INTO person (id, workspace_id, name, email, account_id) VALUES ($1,$2,$3,$4,$5)`, id, t.WorkspaceID, p.Name, p.Email, acc); err != nil {
				return fmt.Errorf("person %q: %w", p.Name, err)
			}
		}
		type chunkRef struct {
			id         uuid.UUID
			start, end int
		}
		chunks := map[uuid.UUID][]chunkRef{}
		for _, so := range d.Sources {
			id := uuid.New()
			src[so.ID] = id
			var person any
			if so.PersonID != nil {
				person = ppl[*so.PersonID]
			}
			sum := contentHash(so.Text)
			if _, err := tx.Exec(ctx, `INSERT INTO source_item (id, workspace_id, kind, title, raw_text, content_hash, person_id, origin_url, processing_state, created_by, created_at)
				VALUES ($1,$2,'paste',$3,$4,$5,$6,$7,'done',$8,$9)`, id, t.WorkspaceID, so.Title, so.Text, sum, person, so.OriginURL, t.UserID, so.CreatedAt); err != nil {
				return fmt.Errorf("source %q: %w", so.Title, err)
			}
			for _, c := range spans.Split(so.Text, chunkSize) {
				cid := uuid.New()
				if _, err := tx.Exec(ctx, `INSERT INTO chunk (id, workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
					cid, t.WorkspaceID, id, c.Ordinal, c.Start, c.End, c.Text); err != nil {
					return err
				}
				chunks[id] = append(chunks[id], chunkRef{cid, c.Start, c.End})
			}
		}
		statusID := map[uuid.UUID]uuid.UUID{}
		if len(d.Statuses) > 0 {
			// A new workspace starts with the default statuses; the file's own replace them.
			if err := q.DeleteAllStatuses(ctx, t.WorkspaceID); err != nil {
				return err
			}
			for _, st := range d.Statuses {
				id := uuid.New()
				statusID[st.ID] = id
				if _, err := tx.Exec(ctx, `INSERT INTO status (id, workspace_id, name, bucket, position) VALUES ($1,$2,$3,$4,$5)`, id, t.WorkspaceID, st.Name, st.Bucket, st.Position); err != nil {
					return fmt.Errorf("status %q: %w", st.Name, err)
				}
			}
		}
		tagID := map[uuid.UUID]uuid.UUID{}
		for _, tg := range d.Tags {
			id := uuid.New()
			tagID[tg.ID] = id
			if _, err := tx.Exec(ctx, `INSERT INTO tag (id, workspace_id, name, definition, color, origin, archived_at, created_by)
				VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() END,$8)`, id, t.WorkspaceID, tg.Name, tg.Definition, tg.Color, tg.Origin, tg.Archived, t.UserID); err != nil {
				return fmt.Errorf("tag %q: %w", tg.Name, err)
			}
		}
		for _, rq := range d.Requests {
			id := uuid.New()
			req[rq.ID] = id
			var st any // nil lets the database pick the default status
			if rq.StatusID != nil {
				st = statusID[*rq.StatusID]
			}
			if _, err := tx.Exec(ctx, `INSERT INTO request (id, workspace_id, title, summary, created_via, created_at, status_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				id, t.WorkspaceID, rq.Title, rq.Summary, rq.CreatedVia, rq.CreatedAt, st); err != nil {
				return fmt.Errorf("request %q: %w", rq.Title, err)
			}
			for _, tid := range rq.TagIDs {
				if _, err := tx.Exec(ctx, `INSERT INTO request_tag (workspace_id, request_id, tag_id) VALUES ($1,$2,$3)`, t.WorkspaceID, id, tagID[tid]); err != nil {
					return fmt.Errorf("request tag: %w", err)
				}
			}
		}
		for _, e := range d.Evidence {
			sid := src[e.SourceID]
			var chunk uuid.UUID
			for _, c := range chunks[sid] {
				if e.SpanStart >= c.start && e.SpanStart < c.end {
					chunk = c.id
				}
			}
			var person any
			if e.PersonID != nil {
				person = ppl[*e.PersonID]
			}
			if _, err := tx.Exec(ctx, `INSERT INTO evidence (id, workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, confidence, created_by, created_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, uuid.New(), t.WorkspaceID, req[e.RequestID], sid, chunk, person, e.Quote, e.SpanStart, e.SpanEnd, e.Confidence, t.UserID, e.CreatedAt); err != nil {
				return fmt.Errorf("evidence: %w", err)
			}
		}
		for _, n := range d.ReleaseNotes {
			nid := uuid.New()
			if _, err := tx.Exec(ctx, `INSERT INTO release_note (id, workspace_id, title, body, state, scheduled_for, published_at, created_by, created_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, nid, t.WorkspaceID, n.Title, n.Body, n.State, n.ScheduledFor, n.PublishedAt, t.UserID, n.CreatedAt); err != nil {
				return fmt.Errorf("release note %q: %w", n.Title, err)
			}
			for _, rid := range n.RequestIDs {
				if _, err := tx.Exec(ctx, `INSERT INTO release_note_request (workspace_id, release_note_id, request_id) VALUES ($1,$2,$3)`, t.WorkspaceID, nid, req[rid]); err != nil {
					return fmt.Errorf("release note link: %w", err)
				}
			}
		}
		for _, x := range d.Suppressions {
			if _, err := tx.Exec(ctx, `INSERT INTO suppression (workspace_id, email, reason, created_at) VALUES ($1,$2,$3,$4)`, t.WorkspaceID, x.Email, x.Reason, x.CreatedAt); err != nil {
				return fmt.Errorf("opt-out: %w", err)
			}
		}
		for _, h := range d.Highlights {
			sid := src[h.SourceID]
			var chunk uuid.UUID
			for _, c := range chunks[sid] {
				if h.SpanStart >= c.start && h.SpanStart < c.end {
					chunk = c.id
				}
			}
			hid := uuid.New()
			if _, err := tx.Exec(ctx, `INSERT INTO highlight (id, workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, note, author_id, created_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, hid, t.WorkspaceID, sid, chunk, h.SpanStart, h.SpanEnd, h.Quote, h.Note, t.UserID, h.CreatedAt); err != nil {
				return fmt.Errorf("highlight: %w", err)
			}
			for _, tid := range h.TagIDs {
				if _, err := tx.Exec(ctx, `INSERT INTO highlight_tag (workspace_id, highlight_id, tag_id) VALUES ($1,$2,$3)`, t.WorkspaceID, hid, tagID[tid]); err != nil {
					return fmt.Errorf("highlight tag: %w", err)
				}
			}
		}
		return nil
	})
}

func txt(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func num(n pgtype.Numeric) *string {
	if !n.Valid {
		return nil
	}
	v, err := n.Value()
	if err != nil || v == nil {
		return nil
	}
	s := fmt.Sprint(v)
	return &s
}

func date(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := d.Time.Format("2006-01-02")
	return &s
}

func nid(n uuid.NullUUID) *uuid.UUID {
	if !n.Valid {
		return nil
	}
	return &n.UUID
}
