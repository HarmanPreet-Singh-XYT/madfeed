// Package media handles recordings: a resumable upload into object storage, a
// background transcription, and the transcript becoming an ordinary text
// source (so quotes, highlights and questions all work on it with the same
// verbatim guarantees). Segments tie every passage of the transcript to a
// moment in the recording.
package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/outreach"
	"product/api/internal/storage"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("media: not found")
	// ErrOffset means the chunk does not start where the server expects; the
	// caller reads the current position and continues from there.
	ErrOffset = errors.New("media: chunk is not at the expected position")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

type ErrQuota string

func (e ErrQuota) Error() string { return string(e) }

// UndoWindow is how long a deleted recording can be brought back before its
// file and transcript are removed for good.
const UndoWindow = 30 * time.Second

const (
	DefaultMaxFileBytes = 1 << 30
	DefaultChunkBytes   = 4 << 20
	MaxChunkBytes       = 8 << 20
	DefaultDailyBytes   = 5 << 30
	DefaultOpenUploads  = 5
	DefaultUploadTTL    = 24 * time.Hour
)

type Service struct {
	Pool        *pgxpool.Pool
	Jobs        *river.Client[pgx.Tx]
	Store       storage.Store
	HashKey     []byte        // keys the fingerprints that keep opt-outs working after a person is deleted
	MaxFile     int64         // 0 means DefaultMaxFileBytes
	DailyBytes  int64         // 0 means DefaultDailyBytes
	OpenUploads int           // 0 means DefaultOpenUploads
	TTL         time.Duration // 0 means DefaultUploadTTL
	Now         func() time.Time
	// Erasers remove each tool's data about a person when the person is deleted (see DeletePerson).
	Erasers []PersonEraser
}

// A PersonEraser removes one tool's data about a person, inside the deletion's transaction and before the person
// row goes. email is the person's address if they have one.
type PersonEraser func(ctx context.Context, q *dbgen.Queries, ws, person uuid.UUID, email string) error

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// kinds maps what we accept to the file signatures that may start such a file.
var kinds = map[string]string{
	"audio/mpeg": "mp3", "audio/mp3": "mp3",
	"audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
	"audio/mp4": "mp4", "audio/x-m4a": "mp4", "audio/m4a": "mp4", "video/mp4": "mp4",
	"audio/ogg": "ogg", "audio/flac": "flac", "audio/x-flac": "flac",
	"audio/webm": "webm", "video/webm": "webm",
}

var extKinds = map[string]string{".mp3": "mp3", ".wav": "wav", ".m4a": "mp4", ".mp4": "mp4", ".ogg": "ogg", ".oga": "ogg", ".flac": "flac", ".webm": "webm"}

// sniff checks the first bytes of the file against the family it claims to be.
func sniff(kind string, head []byte) bool {
	switch kind {
	case "mp3":
		return bytes.HasPrefix(head, []byte("ID3")) || (len(head) >= 2 && head[0] == 0xFF && head[1]&0xE0 == 0xE0)
	case "wav":
		return len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WAVE"
	case "mp4":
		return len(head) >= 8 && string(head[4:8]) == "ftyp"
	case "ogg":
		return bytes.HasPrefix(head, []byte("OggS"))
	case "flac":
		return bytes.HasPrefix(head, []byte("fLaC"))
	case "webm":
		return len(head) >= 4 && head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3
	}
	return false
}

type Upload struct {
	ID            uuid.UUID
	Filename      string
	Title         string
	MimeType      string
	SizeBytes     int64
	ReceivedBytes int64
	ChunkBytes    int
	State         string
	FailureReason string
	DurationMS    int
	SourceItemID  *uuid.UUID
	PersonID      *uuid.UUID
	CreatedAt     time.Time
}

func view(m dbgen.Medium) Upload {
	u := Upload{ID: m.ID, Filename: m.Filename, Title: m.Title.String, MimeType: m.MimeType, SizeBytes: m.SizeBytes, ReceivedBytes: m.ReceivedBytes, ChunkBytes: DefaultChunkBytes,
		State: m.State, FailureReason: m.FailureReason.String, DurationMS: int(m.DurationMs.Int32), CreatedAt: m.CreatedAt}
	if m.SourceItemID.Valid {
		id := m.SourceItemID.UUID
		u.SourceItemID = &id
	}
	if m.PersonID.Valid {
		id := m.PersonID.UUID
		u.PersonID = &id
	}
	return u
}

func cleanName(name string) string {
	name = strings.TrimSpace(path.Base(strings.ReplaceAll(name, "\\", "/")))
	var b strings.Builder
	for _, r := range name {
		if r >= 0x20 && r != 0x7f {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Start opens an upload session. Nothing is stored until chunks arrive.
func (s *Service) Start(ctx context.Context, t store.Tenant, filename, mimeType string, size int64, person *uuid.UUID) (Upload, error) {
	var out Upload
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	name := cleanName(filename)
	if name == "" || utf8.RuneCountInString(name) > 200 {
		return out, ErrInvalid("the file needs a name of at most 200 characters")
	}
	mimeType = strings.ToLower(strings.TrimSpace(strings.SplitN(mimeType, ";", 2)[0]))
	kind, ok := kinds[mimeType]
	if !ok {
		return out, ErrInvalid("that file type is not supported; use MP3, WAV, M4A, MP4, OGG, FLAC or WebM")
	}
	if ek, ok := extKinds[strings.ToLower(path.Ext(name))]; !ok || ek != kind {
		return out, ErrInvalid("the file name does not match its type; check that it is really " + strings.ToUpper(kind))
	}
	max := s.MaxFile
	if max <= 0 {
		max = DefaultMaxFileBytes
	}
	if size <= 0 {
		return out, ErrInvalid("the file is empty")
	}
	if size > max {
		return out, ErrInvalid(fmt.Sprintf("the file is larger than the %d MB limit", max>>20))
	}
	daily, open, ttl := s.DailyBytes, s.OpenUploads, s.TTL
	if daily <= 0 {
		daily = DefaultDailyBytes
	}
	if open <= 0 {
		open = DefaultOpenUploads
	}
	if ttl <= 0 {
		ttl = DefaultUploadTTL
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		used, err := q.SumMediaBytesSince(ctx, dbgen.SumMediaBytesSinceParams{WorkspaceID: t.WorkspaceID, CreatedAt: s.now().Add(-24 * time.Hour)})
		if err != nil {
			return err
		}
		if used+size > daily {
			return ErrQuota("your workspace has reached today's upload limit; try again tomorrow")
		}
		rows, err := q.ListMedia(ctx, dbgen.ListMediaParams{WorkspaceID: t.WorkspaceID, PageSize: 200})
		if err != nil {
			return err
		}
		n := 0
		for _, r := range rows {
			if r.State == "uploading" {
				n++
			}
		}
		if n >= open {
			return ErrQuota("too many uploads are unfinished; finish or cancel one first")
		}
		id := uuid.New()
		p := dbgen.InsertMediaParams{WorkspaceID: t.WorkspaceID, UploadedBy: t.UserID, Filename: name, MimeType: mimeType, SizeBytes: size,
			StorageKey: storage.Key(t.WorkspaceID, id), ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(ttl), Valid: true}}
		if person != nil {
			p.PersonID = uuid.NullUUID{UUID: *person, Valid: true}
		}
		m, err := q.InsertMedia(ctx, p)
		if err != nil {
			return err
		}
		out = view(m)
		return nil
	})
	var invalid interface{ SQLState() string }
	if errors.As(err, &invalid) && invalid.SQLState() == "23503" {
		return Upload{}, ErrInvalid("that person does not exist in this workspace")
	}
	return out, err
}

// Append stores the next chunk. `offset` must equal the bytes already
// received, so a repeated or skipped chunk is refused and the caller learns
// where to continue (ErrOffset with the current position in the Upload).
func (s *Service) Append(ctx context.Context, t store.Tenant, id uuid.UUID, offset int64, body io.Reader) (Upload, error) {
	var out Upload
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	ttl := s.TTL
	if ttl <= 0 {
		ttl = DefaultUploadTTL
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UploadedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		if m.DeletedAt.Valid {
			return ErrNotFound
		}
		if m.State != "uploading" {
			return ErrConflict("this upload is already finished")
		}
		// Storage can be ahead of the database if an earlier commit failed after the bytes landed.
		received := m.ReceivedBytes
		if sz, err := s.Store.Size(ctx, m.StorageKey); err == nil && sz > received && sz <= m.SizeBytes {
			received = sz
		} else if err != nil && !errors.Is(err, storage.ErrNotFound) {
			return err
		}
		if offset != received {
			out = view(m)
			out.ReceivedBytes = received
			return ErrOffset
		}
		room := m.SizeBytes - received
		if room <= 0 {
			return ErrConflict("all of the file has already been received")
		}
		limited := io.LimitReader(body, min64(room, MaxChunkBytes)+1)
		head, r := peek(limited, 16, offset == 0)
		if offset == 0 && !sniff(kinds[m.MimeType], head) {
			return ErrInvalid("the file does not look like the type it claims to be")
		}
		cr := &countingReader{r: r}
		if _, err := s.Store.Append(ctx, m.StorageKey, received, cr); err != nil {
			return fmt.Errorf("store chunk: %w", err)
		}
		if cr.n == 0 {
			return ErrInvalid("the chunk is empty")
		}
		if cr.n > MaxChunkBytes || cr.n > room {
			// Over the limit: take it back out so the next attempt starts clean.
			_ = s.rewind(ctx, m.StorageKey, received)
			return ErrInvalid("the chunk is larger than allowed")
		}
		received += cr.n
		if err := q.SetMediaReceived(ctx, dbgen.SetMediaReceivedParams{WorkspaceID: t.WorkspaceID, ID: id, ReceivedBytes: received,
			ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(ttl), Valid: true}}); err != nil {
			return err
		}
		m.ReceivedBytes = received
		out = view(m)
		return nil
	})
	if errors.Is(err, ErrOffset) {
		return out, err
	}
	return out, err
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// rewind removes bytes written past `size`, in place: nothing is read into memory and
// the stored prefix is never deleted and rewritten.
func (s *Service) rewind(ctx context.Context, key string, size int64) error {
	return s.Store.Truncate(ctx, key, size)
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// peek returns the first n bytes (when wanted) and a reader that still yields them.
func peek(r io.Reader, n int, want bool) ([]byte, io.Reader) {
	if !want {
		return nil, r
	}
	buf := make([]byte, n)
	got, _ := io.ReadFull(r, buf)
	buf = buf[:got]
	return buf, io.MultiReader(bytes.NewReader(buf), r)
}

// Complete closes the upload once every byte has arrived and queues the transcription.
func (s *Service) Complete(ctx context.Context, t store.Tenant, id uuid.UUID) (Upload, error) {
	var out Upload
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UploadedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		if m.DeletedAt.Valid {
			return ErrNotFound
		}
		if m.State != "uploading" {
			out = view(m)
			return nil // completing twice is harmless
		}
		sz, err := s.Store.Size(ctx, m.StorageKey)
		if err != nil && !errors.Is(err, storage.ErrNotFound) {
			return err
		}
		if sz != m.SizeBytes {
			return ErrConflict(fmt.Sprintf("the upload is not finished: %d of %d bytes received", sz, m.SizeBytes))
		}
		if err := q.SetMediaUploaded(ctx, dbgen.SetMediaUploadedParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		if _, err := s.Jobs.InsertTx(ctx, tx, TranscribeArgs{WorkspaceID: t.WorkspaceID, MediaID: id, UserID: t.UserID}, nil); err != nil {
			return fmt.Errorf("enqueue transcription: %w", err)
		}
		m.State, m.ReceivedBytes = "uploaded", sz
		out = view(m)
		return nil
	})
	return out, err
}

func (s *Service) Get(ctx context.Context, t store.Tenant, id uuid.UUID) (Upload, error) {
	var out Upload
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMedia(ctx, dbgen.GetMediaParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		out = view(m)
		if err == nil {
			if sz, serr := s.Store.Size(ctx, m.StorageKey); serr == nil && m.State == "uploading" && sz > m.ReceivedBytes && sz <= m.SizeBytes {
				out.ReceivedBytes = sz // where an interrupted upload really stands
			}
		}
		return err
	})
	return out, err
}

func (s *Service) List(ctx context.Context, t store.Tenant) ([]Upload, error) {
	var out []Upload
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListMedia(ctx, dbgen.ListMediaParams{WorkspaceID: t.WorkspaceID, PageSize: 50})
		for _, r := range rows {
			out = append(out, view(r))
		}
		return err
	})
	return out, err
}

// Cursor points at the last recording of a page. It is opaque to the client.
type Cursor struct {
	Created time.Time
	ID      uuid.UUID
}

// ListOptions narrows one page of the library. Every field is optional.
type ListOptions struct {
	Q         string
	State     string
	Attention bool
	Cursor    *Cursor
	Limit     int
}

var mediaStates = map[string]bool{"uploading": true, "uploaded": true, "transcribing": true, "done": true, "failed": true}

// ListPage returns one page of the library, newest first, and where the next
// page starts. Keyset paging means a recording uploaded while reading never
// shifts or repeats a row.
func (s *Service) ListPage(ctx context.Context, t store.Tenant, opts ListOptions) ([]Upload, *Cursor, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	search := strings.TrimSpace(opts.Q)
	if utf8.RuneCountInString(search) > 200 {
		return nil, nil, ErrInvalid("the search is too long")
	}
	state := strings.TrimSpace(opts.State)
	if state != "" && !mediaStates[state] {
		return nil, nil, ErrInvalid("that is not a recording state")
	}
	beforeCreated, beforeID := time.Unix(0, 0), uuid.Nil
	if opts.Cursor != nil {
		beforeCreated, beforeID = opts.Cursor.Created, opts.Cursor.ID
	}
	var out []Upload
	var next *Cursor
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListMediaPage(ctx, dbgen.ListMediaPageParams{
			WorkspaceID: t.WorkspaceID, Q: search, State: state, Attention: opts.Attention,
			BeforeCreated: beforeCreated, BeforeID: beforeID, PageSize: int32(limit),
		})
		if err != nil {
			return err
		}
		for _, r := range rows {
			out = append(out, view(r))
		}
		if len(rows) == limit {
			last := rows[len(rows)-1]
			next = &Cursor{Created: last.CreatedAt, ID: last.ID}
		}
		return nil
	})
	return out, next, err
}

// Update renames a recording (and its transcript, once there is one) and, when
// given, says who is speaking. Both places are written together so the list and
// the transcript never show different names.
func (s *Service) Update(ctx context.Context, t store.Tenant, id uuid.UUID, title *string, person *uuid.UUID) (Upload, error) {
	var out Upload
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UploadedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		if title == nil && person == nil {
			return ErrInvalid("say what to change: a name, who is speaking, or both")
		}
		if title != nil {
			name := strings.TrimSpace(*title)
			if name == "" || utf8.RuneCountInString(name) > 200 {
				return ErrInvalid("the name needs 1 to 200 characters")
			}
			if err := q.SetMediaTitle(ctx, dbgen.SetMediaTitleParams{WorkspaceID: t.WorkspaceID, ID: id, Title: pgtype.Text{String: name, Valid: true}}); err != nil {
				return err
			}
			if m.SourceItemID.Valid {
				if err := q.SetSourceTitle(ctx, dbgen.SetSourceTitleParams{WorkspaceID: t.WorkspaceID, ID: m.SourceItemID.UUID, Title: name}); err != nil {
					return err
				}
			}
			m.Title = pgtype.Text{String: name, Valid: true}
		}
		if person != nil {
			if err := q.SetMediaPerson(ctx, dbgen.SetMediaPersonParams{WorkspaceID: t.WorkspaceID, ID: id, PersonID: uuid.NullUUID{UUID: *person, Valid: true}}); err != nil {
				return err
			}
			if m.SourceItemID.Valid {
				if err := q.SetSourcePerson(ctx, dbgen.SetSourcePersonParams{WorkspaceID: t.WorkspaceID, ID: m.SourceItemID.UUID, PersonID: uuid.NullUUID{UUID: *person, Valid: true}}); err != nil {
					return err
				}
			}
			m.PersonID = uuid.NullUUID{UUID: *person, Valid: true}
		}
		out = view(m)
		return nil
	})
	var invalid interface{ SQLState() string }
	if errors.As(err, &invalid) && invalid.SQLState() == "23503" {
		return Upload{}, ErrInvalid("that person does not exist in this workspace")
	}
	return out, err
}

// Retry queues a failed transcription again. The file is still stored, so
// nothing is uploaded twice.
func (s *Service) Retry(ctx context.Context, t store.Tenant, id uuid.UUID) (Upload, error) {
	var out Upload
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UploadedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		if m.State != "failed" {
			return ErrConflict("only a failed transcription can be tried again")
		}
		sz, err := s.Store.Size(ctx, m.StorageKey)
		if err != nil || sz != m.SizeBytes {
			return ErrConflict("the file is no longer stored; add the recording again")
		}
		if err := q.ResetMediaForRetry(ctx, dbgen.ResetMediaForRetryParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		if _, err := s.Jobs.InsertTx(ctx, tx, TranscribeArgs{WorkspaceID: t.WorkspaceID, MediaID: id, UserID: t.UserID}, nil); err != nil {
			return fmt.Errorf("enqueue transcription: %w", err)
		}
		m.State, m.FailureReason = "uploaded", pgtype.Text{}
		out = view(m)
		return nil
	})
	return out, err
}

// Open returns the stored file for playback. Anyone in the workspace may play it.
func (s *Service) Open(ctx context.Context, t store.Tenant, id uuid.UUID) (storage.Object, Upload, error) {
	var m dbgen.Medium
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		m, err = q.GetMedia(ctx, dbgen.GetMediaParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return nil, Upload{}, err
	}
	if m.State == "uploading" {
		return nil, Upload{}, ErrNotFound
	}
	o, err := s.Store.Open(ctx, m.StorageKey)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, Upload{}, ErrNotFound
	}
	return o, view(m), err
}

// Delete removes the recording, its transcript source (with every quote,
// highlight and segment built on it) and the stored file. The file goes first:
// if that fails nothing else changes, so an object can never be left without a row.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UploadedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		if m.DeletedAt.Valid {
			return nil // deleting twice is harmless
		}
		if err := q.SetMediaDeleted(ctx, dbgen.SetMediaDeletedParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		// The purge job wakes after the undo window. It is harmless if the row comes back first.
		if _, err := s.Jobs.InsertTx(ctx, tx, PurgeMediaArgs{WorkspaceID: t.WorkspaceID, MediaID: id}, nil); err != nil {
			return fmt.Errorf("enqueue purge: %w", err)
		}
		return nil
	})
}

// Restore brings a deleted recording back before its undo window closes.
func (s *Service) Restore(ctx context.Context, t store.Tenant, id uuid.UUID) (Upload, error) {
	var out Upload
	if !t.CanWrite() {
		return out, store.ErrForbidden
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if m.UploadedBy != t.UserID && !t.Can(store.PermManage) {
			return store.ErrForbidden
		}
		if !m.DeletedAt.Valid {
			out = view(m)
			return nil // already back
		}
		if _, err := q.RestoreMedia(ctx, dbgen.RestoreMediaParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		m.DeletedAt = pgtype.Timestamptz{}
		out = view(m)
		return nil
	})
	return out, err
}

// Purge removes a deleted recording once its undo window has passed. It says
// whether it removed anything, and how long to wait when it is too early.
func (s *Service) Purge(ctx context.Context, t store.Tenant, id uuid.UUID, window time.Duration) (bool, time.Duration, error) {
	var purged bool
	var wait time.Duration
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // already gone
		}
		if err != nil {
			return err
		}
		if !m.DeletedAt.Valid {
			return nil // brought back
		}
		if age := s.now().Sub(m.DeletedAt.Time); age < window {
			wait = window - age
			return nil
		}
		purged = true
		return s.deleteLocked(ctx, q, t.WorkspaceID, m)
	})
	return purged, wait, err
}

func (s *Service) deleteLocked(ctx context.Context, q *dbgen.Queries, ws uuid.UUID, m dbgen.Medium) error {
	if err := s.Store.Delete(ctx, m.StorageKey); err != nil {
		return fmt.Errorf("delete stored file: %w", err)
	}
	if _, err := q.DeleteMedia(ctx, dbgen.DeleteMediaParams{WorkspaceID: ws, ID: m.ID}); err != nil {
		return err
	}
	if m.SourceItemID.Valid { // the transcript and everything built on it
		if _, err := q.DeleteSourceItem(ctx, dbgen.DeleteSourceItemParams{WorkspaceID: ws, ID: m.SourceItemID.UUID}); err != nil {
			return err
		}
	}
	return nil
}

// DeleteSource removes a source of any kind; for a recording that includes the file.
func (s *Service) DeleteSource(ctx context.Context, t store.Tenant, sourceID uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return s.deleteSourceTx(ctx, q, t.WorkspaceID, sourceID)
	})
}

func (s *Service) deleteSourceTx(ctx context.Context, q *dbgen.Queries, ws, sourceID uuid.UUID) error {
	if _, err := q.GetSourceItem(ctx, dbgen.GetSourceItemParams{WorkspaceID: ws, ID: sourceID}); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	ms, err := q.ListMediaForSource(ctx, dbgen.ListMediaForSourceParams{WorkspaceID: ws, SourceItemID: uuid.NullUUID{UUID: sourceID, Valid: true}})
	if err != nil {
		return err
	}
	for _, m := range ms {
		if err := s.Store.Delete(ctx, m.StorageKey); err != nil {
			return fmt.Errorf("delete stored file: %w", err)
		}
		if _, err := q.DeleteMedia(ctx, dbgen.DeleteMediaParams{WorkspaceID: ws, ID: m.ID}); err != nil {
			return err
		}
	}
	_, err = q.DeleteSourceItem(ctx, dbgen.DeleteSourceItemParams{WorkspaceID: ws, ID: sourceID})
	return err
}

// DeletePerson removes a person and everything that is theirs: the sources
// attributed to them (and recordings), the quotes from them, the messages
// written to them, and finally the person. An opt-out for their email address
// is deliberately kept, so deleting someone never makes it possible to write
// to them again.
func (s *Service) DeletePerson(ctx context.Context, t store.Tenant, personID uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		ids, err := q.ListSourceIDsForPerson(ctx, dbgen.ListSourceIDsForPersonParams{WorkspaceID: t.WorkspaceID, PersonID: uuid.NullUUID{UUID: personID, Valid: true}})
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := s.deleteSourceTx(ctx, q, t.WorkspaceID, id); err != nil {
				return err
			}
		}
		// Their quotes on other people's sources, and every message written to them.
		if err := q.DeleteEvidenceForPerson(ctx, dbgen.DeleteEvidenceForPersonParams{WorkspaceID: t.WorkspaceID, PersonID: uuid.NullUUID{UUID: personID, Valid: true}}); err != nil {
			return err
		}
		if err := outreach.RecordTombstones(ctx, q, s.HashKey, t.WorkspaceID, personID); err != nil {
			return err
		}
		// Each tool erases what it holds about the person. media does not know which tools exist: the server
		// wires them in (api.PersonErasers), so a new tool adds its own eraser and cannot be forgotten here.
		email := ""
		if p, perr := q.GetPerson(ctx, dbgen.GetPersonParams{WorkspaceID: t.WorkspaceID, ID: personID}); perr == nil {
			email = p.Email.String
		}
		for _, erase := range s.Erasers {
			if err := erase(ctx, q, t.WorkspaceID, personID, email); err != nil {
				return err
			}
		}
		if err := q.DeleteMessagesForPerson(ctx, dbgen.DeleteMessagesForPersonParams{WorkspaceID: t.WorkspaceID, PersonID: personID}); err != nil {
			return err
		}
		n, err := q.DeletePersonRow(ctx, dbgen.DeletePersonRowParams{WorkspaceID: t.WorkspaceID, ID: personID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// CleanupExpired deletes abandoned upload sessions and their partial files.
// It returns how many it removed. Run it from the worker on a timer.
func (s *Service) CleanupExpired(ctx context.Context) (int, error) {
	rows, err := s.Pool.Query(ctx, `SELECT workspace_id, id, uploaded_by, storage_key FROM expired_uploads($1, 100)`, s.now())
	if err != nil {
		return 0, err
	}
	type row struct {
		ws, id, by uuid.UUID
		key        string
	}
	var found []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.ws, &r.id, &r.by, &r.key); err != nil {
			rows.Close()
			return 0, err
		}
		found = append(found, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, r := range found {
		t := store.Tenant{WorkspaceID: r.ws, UserID: r.by, Role: store.RoleAdmin}
		err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
			m, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: r.ws, ID: r.id})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.State != "uploading") {
				return nil
			}
			if err != nil {
				return err
			}
			n++
			return s.deleteLocked(ctx, q, r.ws, m)
		})
		if err != nil {
			return n, err
		}
	}
	return n, nil
}

// Orphans lists stored files that no media row refers to. It should always be empty.
func (s *Service) Orphans(ctx context.Context) ([]string, error) {
	keys, err := s.Store.Keys(ctx)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, k := range keys {
		var exists bool
		if err := s.Pool.QueryRow(ctx, `SELECT media_key_exists($1)`, k).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			out = append(out, k)
		}
	}
	return out, nil
}

// Transcript returns the segments of a recording's transcript.
type Segment struct {
	Ordinal, StartMS, EndMS, SpanStart, SpanEnd int
	Speaker                                     string
}

func (s *Service) Segments(ctx context.Context, t store.Tenant, sourceID uuid.UUID) (mediaID uuid.UUID, segs []Segment, err error) {
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		m, err := q.GetMediaBySource(ctx, dbgen.GetMediaBySourceParams{WorkspaceID: t.WorkspaceID, SourceItemID: uuid.NullUUID{UUID: sourceID, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		mediaID = m.ID
		rows, err := q.ListSegments(ctx, dbgen.ListSegmentsParams{WorkspaceID: t.WorkspaceID, SourceItemID: sourceID})
		for _, r := range rows {
			segs = append(segs, Segment{Ordinal: int(r.Ordinal), StartMS: int(r.StartMs), EndMS: int(r.EndMs), Speaker: r.Speaker, SpanStart: int(r.SpanStart), SpanEnd: int(r.SpanEnd)})
		}
		return err
	})
	return
}
