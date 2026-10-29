// Package release manages release notes: write, link to the requests they
// close, publish or schedule, and serve a public page. Nothing about a
// customer, a request or the workspace's internals appears publicly.
package release

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/hooks"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var ErrNotFound = errors.New("release: not found")

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

type LinkedRequest struct {
	ID    uuid.UUID
	Title string
}

type Note struct {
	ID           uuid.UUID
	Title        string
	Body         string
	State        string // draft, scheduled, published, unpublished
	Type         string // new, improved, fixed
	ScheduledFor *time.Time
	PublishedAt  *time.Time
	LiveNow      bool // visible on the public page right now
	Requests     []LinkedRequest
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type PublicNote struct {
	ID          uuid.UUID
	Title       string
	Body        string
	Type        string
	PublishedAt time.Time
}

type PublicPage struct {
	WorkspaceName string
	Notes         []PublicNote
}

// Counts is how many notes the workspace has in each state, for the list filters.
type Counts struct {
	All         int
	Draft       int
	Scheduled   int
	Published   int
	Unpublished int
}

// ListFilter narrows the note list. An empty State, Q or Type means "no filter".
type ListFilter struct {
	State string
	Q     string
	Type  string
}

// NoteTypes are the kinds a note can be, in the order a changelog shows them.
var NoteTypes = []string{"new", "improved", "fixed"}

func validNoteType(t string) bool {
	return t == "new" || t == "improved" || t == "fixed"
}

// kindOf turns an empty kind into "new" and refuses anything else.
func kindOf(t string) (string, error) {
	if t == "" {
		return "new", nil
	}
	if !validNoteType(t) {
		return "", ErrInvalid("the note type must be new, improved or fixed")
	}
	return t, nil
}

type Service struct{ Pool *pgxpool.Pool }

func cleanNote(title, body string) (string, string, error) {
	title, body = strings.TrimSpace(title), strings.TrimSpace(body)
	if title == "" || utf8.RuneCountInString(title) > 200 || strings.ContainsAny(title, "\r\n") {
		return "", "", ErrInvalid("the title must be one line of 1 to 200 characters")
	}
	if utf8.RuneCountInString(body) > 20000 {
		return "", "", ErrInvalid("the note is too long (limit 20,000 characters)")
	}
	return title, strings.ReplaceAll(body, "\r\n", "\n"), nil
}

func (s *Service) Create(ctx context.Context, t store.Tenant, title, body, kind string) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	title, body, err := cleanNote(title, body)
	if err != nil {
		return uuid.Nil, err
	}
	kind, err = kindOf(kind)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.CreateNote(ctx, dbgen.CreateNoteParams{WorkspaceID: t.WorkspaceID, Title: title, Body: body, Type: kind, CreatedBy: t.UserID})
		id = n.ID
		return err
	})
	return id, err
}

func (s *Service) Update(ctx context.Context, t store.Tenant, id uuid.UUID, title, body, kind string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	title, body, err := cleanNote(title, body)
	if err != nil {
		return err
	}
	kind, err = kindOf(kind)
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateNote(ctx, dbgen.UpdateNoteParams{WorkspaceID: t.WorkspaceID, ID: id, Title: title, Body: body, Type: kind})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
}

// SetRequests replaces the list of requests the note closes.
func (s *Service) SetRequests(ctx context.Context, t store.Tenant, id uuid.UUID, requestIDs []uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if len(requestIDs) > 100 {
		return ErrInvalid("a note can be linked to at most 100 requests")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if err := q.ClearNoteRequests(ctx, dbgen.ClearNoteRequestsParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id}); err != nil {
			return err
		}
		for _, r := range requestIDs {
			if err := q.LinkNoteRequest(ctx, dbgen.LinkNoteRequestParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id, RequestID: r}); err != nil {
				var pe *pgconn.PgError
				if errors.As(err, &pe) && pe.Code == "23503" {
					return ErrInvalid("one of those requests does not exist in this workspace")
				}
				return err
			}
		}
		return nil
	})
}

// Publish makes the note public now, or at a future instant. The instant is
// absolute (UTC), so time zones and daylight saving cannot move it.
func (s *Service) Publish(ctx context.Context, t store.Tenant, id uuid.UUID, at *time.Time) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if at != nil {
		if !at.After(time.Now().Add(30 * time.Second)) {
			return ErrInvalid("choose a time in the future, or publish now")
		}
		if at.After(time.Now().AddDate(1, 0, 0)) {
			return ErrInvalid("a note can be scheduled at most a year ahead")
		}
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		var n int64
		var err error
		if at == nil {
			n, err = q.PublishNote(ctx, dbgen.PublishNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		} else {
			n, err = q.ScheduleNote(ctx, dbgen.ScheduleNoteParams{WorkspaceID: t.WorkspaceID, ID: id, ScheduledFor: pgtype.Timestamptz{Time: at.UTC(), Valid: true}})
		}
		if err != nil {
			return err
		}
		if n == 0 {
			if _, gerr := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(gerr, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return ErrConflict("this note is already published")
		}
		if at != nil {
			return nil // it goes public later, by the scheduler
		}
		note, err := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		return hooks.Emit(ctx, tx, t.WorkspaceID, hooks.ReleaseNotePublished, map[string]any{"noteId": id, "title": note.Title})
	})
}

func (s *Service) Unpublish(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UnpublishNote(ctx, dbgen.UnpublishNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			if _, gerr := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(gerr, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return ErrConflict("this note is not published")
		}
		return nil
	})
}

// Unschedule puts a scheduled note back among the drafts, without it ever
// having been public. Taking a note down is Unpublish, which keeps the fact
// that it was live.
func (s *Service) Unschedule(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UnscheduleNote(ctx, dbgen.UnscheduleNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			if _, gerr := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(gerr, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return ErrConflict("this note is not scheduled")
		}
		return nil
	})
}

func toNote(n dbgen.ReleaseNote) Note {
	out := Note{ID: n.ID, Title: n.Title, Body: n.Body, State: n.State, Type: n.Type, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt}
	if n.ScheduledFor.Valid {
		x := n.ScheduledFor.Time
		out.ScheduledFor = &x
	}
	if n.PublishedAt.Valid {
		x := n.PublishedAt.Time
		out.PublishedAt = &x
	}
	out.LiveNow = n.State == "published" || (n.State == "scheduled" && n.ScheduledFor.Valid && !n.ScheduledFor.Time.After(time.Now()))
	return out
}

func (s *Service) Get(ctx context.Context, t store.Tenant, id uuid.UUID) (Note, error) {
	var out Note
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = toNote(n)
		rs, err := q.ListNoteRequests(ctx, dbgen.ListNoteRequestsParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id})
		for _, r := range rs {
			out.Requests = append(out.Requests, LinkedRequest{ID: r.ID, Title: r.Title})
		}
		return err
	})
	return out, err
}

func (s *Service) List(ctx context.Context, t store.Tenant, beforeCreated time.Time, beforeID uuid.UUID, limit int, f ListFilter) ([]Note, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	var state, q, kind pgtype.Text
	if f.State == "draft" || f.State == "scheduled" || f.State == "published" || f.State == "unpublished" {
		state = pgtype.Text{String: f.State, Valid: true}
	}
	if f.Type != "" {
		if !validNoteType(f.Type) {
			return nil, ErrInvalid("the note type must be new, improved or fixed")
		}
		kind = pgtype.Text{String: f.Type, Valid: true}
	}
	if q2 := strings.TrimSpace(f.Q); q2 != "" {
		if utf8.RuneCountInString(q2) > 100 {
			return nil, ErrInvalid("the search text must be under 100 characters")
		}
		q = pgtype.Text{String: q2, Valid: true}
	}
	var out []Note
	err := store.WithTenant(ctx, s.Pool, t, func(qq *dbgen.Queries) error {
		rows, err := qq.ListNotes(ctx, dbgen.ListNotesParams{WorkspaceID: t.WorkspaceID, BeforeCreatedAt: beforeCreated, BeforeID: beforeID, State: state, Q: q, Type: kind, PageSize: int32(limit)})
		for _, r := range rows {
			out = append(out, toNote(r))
		}
		return err
	})
	return out, err
}

// Counts returns the number of notes in each state, for the filter tabs.
func (s *Service) Counts(ctx context.Context, t store.Tenant) (Counts, error) {
	var out Counts
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountNotes(ctx, t.WorkspaceID)
		out = Counts{All: int(c.Total), Draft: int(c.Drafts), Scheduled: int(c.Scheduled), Published: int(c.Published), Unpublished: int(c.Unpublished)}
		return err
	})
	return out, err
}

// DeleteDraft removes a draft for good. A note that has ever been public is not
// deleted here: messages may already refer to it, so it can only be taken down.
func (s *Service) DeleteDraft(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if n.State != "draft" {
			return ErrConflict("a note that has been public can be taken down but not deleted")
		}
		rows, err := q.DeleteDraftNote(ctx, dbgen.DeleteDraftNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if rows == 0 {
			return ErrConflict("a note that has been public can be taken down but not deleted")
		}
		return nil
	})
}

// Duplicate starts a new draft with the same text and the same linked requests.
// Nothing about the original changes, so it works for any state.
func (s *Service) Duplicate(ctx context.Context, t store.Tenant, id uuid.UUID) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	var out uuid.UUID
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		n, err := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		created, err := q.CreateNote(ctx, dbgen.CreateNoteParams{WorkspaceID: t.WorkspaceID, Title: copyTitle(n.Title), Body: n.Body, Type: n.Type, CreatedBy: t.UserID})
		if err != nil {
			return err
		}
		out = created.ID
		links, err := q.ListNoteRequests(ctx, dbgen.ListNoteRequestsParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id})
		if err != nil {
			return err
		}
		for _, l := range links {
			if err := q.LinkNoteRequest(ctx, dbgen.LinkNoteRequestParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: out, RequestID: l.ID}); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

// copyTitle adds " (copy)" without pushing a long title past the 200-character limit.
func copyTitle(title string) string {
	const suffix = " (copy)"
	r := []rune(title)
	keep := 200 - len([]rune(suffix))
	if len(r) > keep {
		r = r[:keep]
	}
	return strings.TrimSpace(string(r)) + suffix
}

// ForRequest lists the notes that mention a request (for its detail page).
func (s *Service) ForRequest(ctx context.Context, t store.Tenant, requestID uuid.UUID) ([]Note, error) {
	var out []Note
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListNotesForRequest(ctx, dbgen.ListNotesForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		for _, r := range rows {
			n := Note{ID: r.ID, Title: r.Title, State: r.State}
			if r.PublishedAt.Valid {
				x := r.PublishedAt.Time
				n.PublishedAt = &x
			}
			if r.ScheduledFor.Valid {
				x := r.ScheduledFor.Time
				n.ScheduledFor = &x
			}
			out = append(out, n)
		}
		return err
	})
	return out, err
}

// ---- workspace public identity ----

type Settings struct {
	Name       string
	PublicSlug string
	SenderName string
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,39}$`)

var reserved = map[string]bool{"admin": true, "api": true, "app": true, "login": true, "unsubscribe": true, "w": true, "r": true, "www": true, "static": true, "public": true, "settings": true, "help": true, "support": true}

func (s *Service) GetSettings(ctx context.Context, t store.Tenant) (Settings, error) {
	var out Settings
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		w, err := q.GetWorkspaceSettings(ctx, t.WorkspaceID)
		out = Settings{Name: w.Name, PublicSlug: w.PublicSlug.String, SenderName: w.SenderName}
		return err
	})
	return out, err
}

// UpdateSettings sets the public address of the release page and the name that
// signs outgoing messages. Admins only.
func (s *Service) UpdateSettings(ctx context.Context, t store.Tenant, slug, senderName string) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	slug, senderName = strings.ToLower(strings.TrimSpace(slug)), strings.TrimSpace(senderName)
	if slug != "" && (!slugRe.MatchString(slug) || reserved[slug]) {
		return ErrInvalid("the public address must be 3 to 40 letters, numbers or hyphens, and not a reserved word")
	}
	if utf8.RuneCountInString(senderName) > 100 || strings.ContainsAny(senderName, "\r\n<>\"") {
		return ErrInvalid("the sender name must be under 100 characters, without quotes, brackets or line breaks")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateWorkspaceSettings(ctx, dbgen.UpdateWorkspaceSettingsParams{ID: t.WorkspaceID, PublicSlug: pgtype.Text{String: slug, Valid: slug != ""}, SenderName: senderName})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return ErrConflict("that public address is taken")
	}
	return err
}

// ---- public pages (no sign-in) ----

// workspaceForSlug resolves a public address. It runs without any tenant
// context, through a function that returns nothing but the id.
func (s *Service) workspaceForSlug(ctx context.Context, slug string) (uuid.UUID, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !slugRe.MatchString(slug) {
		return uuid.Nil, ErrNotFound
	}
	var id uuid.NullUUID
	if err := s.Pool.QueryRow(ctx, `SELECT public_workspace_id($1)`, slug).Scan(&id); err != nil || !id.Valid {
		return uuid.Nil, ErrNotFound
	}
	return id.UUID, nil
}

func publicTenant(ws uuid.UUID) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleViewer}
}

// PublicList returns the live notes for a public address, newest first.
func (s *Service) PublicList(ctx context.Context, slug string, limit int) (PublicPage, error) {
	ws, err := s.workspaceForSlug(ctx, slug)
	if err != nil {
		return PublicPage{}, err
	}
	if limit < 1 || limit > 50 {
		limit = 50
	}
	var page PublicPage
	err = store.WithTenant(ctx, s.Pool, publicTenant(ws), func(q *dbgen.Queries) error {
		name, err := q.GetWorkspaceName(ctx, ws)
		if err != nil {
			return err
		}
		page.WorkspaceName = name
		rows, err := q.PublicListNotes(ctx, dbgen.PublicListNotesParams{WorkspaceID: ws, PageSize: int32(limit)})
		for _, r := range rows {
			page.Notes = append(page.Notes, PublicNote{ID: r.ID, Title: r.Title, Body: r.Body, Type: r.Type, PublishedAt: r.ShownAt})
		}
		return err
	})
	return page, err
}

// PublicGet returns one live note. A draft, an unpublished note, a note still
// waiting for its time, another workspace's note and a made-up id all look the same: not found.
func (s *Service) PublicGet(ctx context.Context, slug string, id uuid.UUID) (PublicNote, string, error) {
	ws, err := s.workspaceForSlug(ctx, slug)
	if err != nil {
		return PublicNote{}, "", err
	}
	var out PublicNote
	var name string
	err = store.WithTenant(ctx, s.Pool, publicTenant(ws), func(q *dbgen.Queries) error {
		n, err := q.PublicGetNote(ctx, dbgen.PublicGetNoteParams{WorkspaceID: ws, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = PublicNote{ID: n.ID, Title: n.Title, Body: n.Body, Type: n.Type, PublishedAt: n.ShownAt}
		name, err = q.GetWorkspaceName(ctx, ws)
		return err
	})
	return out, name, err
}
