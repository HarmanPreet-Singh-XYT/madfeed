// Package findings holds findings documents: a title, paragraphs, and quote cards that point at stored quotes
// (evidence or highlights). A card always shows the quote as it is stored now, so it cannot drift from its
// source; when the quote is deleted the card says it was removed. A document can be shared through a link that
// shows the paragraphs and the quote text and nothing else, and that ends the moment it is taken down.
package findings

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("findings: not found")
	ErrConflict = errors.New("findings: not allowed in this state")
	ErrBadLink  = errors.New("findings: bad link")
	ErrNotSure  = errors.New("findings: publishing needs confirmation")
	// A shared link with a password answers this until the reader unlocks it.
	ErrPasswordRequired = errors.New("findings: password required")
	ErrBadPassword      = errors.New("findings: wrong password")
)

// ErrInvalid is input the caller must fix; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

const (
	MaxBlocks   = 200
	MaxText     = 5000
	MaxHeading  = 200
	MaxCardNote = 1000
)

type Service struct {
	Pool    *pgxpool.Pool
	Secret  []byte // signs public links
	BaseURL string // the web app's address
}

// ---- links ----

func (s *Service) mac(parts ...string) string {
	h := hmac.New(sha256.New, s.Secret)
	h.Write([]byte("finding-link\x00" + strings.Join(parts, "\x00")))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil)[:16])
}

func hexID(id uuid.UUID) string { return hex.EncodeToString(id[:]) }

func unhex(s string) (uuid.UUID, error) {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 16 {
		return uuid.Nil, ErrBadLink
	}
	var id uuid.UUID
	copy(id[:], b)
	return id, nil
}

// Token is the secret part of a document's public link.
func (s *Service) Token(ws, doc uuid.UUID, epoch int) string {
	return "f." + hexID(ws) + "." + hexID(doc) + "." + strconv.Itoa(epoch) + "." + s.mac(ws.String(), doc.String(), strconv.Itoa(epoch))
}

func (s *Service) linkURL(token string) string {
	return strings.TrimRight(s.BaseURL, "/") + "/f/" + token
}

const grantTTL = 8 * time.Hour

func (s *Service) grantMAC(token, expires string) string {
	return s.mac("unlock", token, expires)
}

func (s *Service) mintGrant(token string, until time.Time) string {
	expires := strconv.FormatInt(until.Unix(), 10)
	return base64.RawURLEncoding.EncodeToString([]byte(expires)) + "." + s.grantMAC(token, expires)
}

func (s *Service) grantValid(token, grant string) bool {
	parts := strings.Split(grant, ".")
	if len(parts) != 2 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expires := string(raw)
	exp, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || time.Now().Unix() >= exp {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(parts[1]), []byte(s.grantMAC(token, expires))) == 1
}

func (s *Service) verify(token string) (ws, doc uuid.UUID, epoch int, err error) {
	if len(s.Secret) == 0 || len(token) > 200 {
		return uuid.Nil, uuid.Nil, 0, ErrBadLink
	}
	p := strings.Split(token, ".")
	if len(p) != 5 || p[0] != "f" {
		return uuid.Nil, uuid.Nil, 0, ErrBadLink
	}
	ws, err1 := unhex(p[1])
	doc, err2 := unhex(p[2])
	epoch, err3 := strconv.Atoi(p[3])
	if err1 != nil || err2 != nil || err3 != nil || epoch < 0 || strconv.Itoa(epoch) != p[3] ||
		subtle.ConstantTimeCompare([]byte(p[4]), []byte(s.mac(ws.String(), doc.String(), p[3]))) != 1 {
		return uuid.Nil, uuid.Nil, 0, ErrBadLink
	}
	return ws, doc, epoch, nil
}

// ---- views ----

type Block struct {
	ID           uuid.UUID
	Kind         string // "text", "heading" or "quote"
	Body         string // a paragraph, or the note under a card
	QuoteKind    string // "evidence" or "highlight"
	QuoteID      *uuid.UUID
	Removed      bool // a card whose quote has been deleted
	Quote        string
	SourceTitle  string
	SourceItemID *uuid.UUID
	RequestTitle string
}

type Doc struct {
	ID                uuid.UUID
	Title             string
	State             string
	PublicLink        string
	PublishedAt       *time.Time
	UpdatedAt         time.Time
	DeletedAt         *time.Time
	ShareExpiresAt    *time.Time
	PasswordProtected bool
	Blocks            []Block
}

type Row struct {
	ID        uuid.UUID
	Title     string
	State     string
	Blocks    int
	UpdatedAt time.Time
	DeletedAt *time.Time
}

type BlockInput struct {
	ID        *uuid.UUID // an existing card to keep as it is (even one whose quote was removed)
	Kind      string
	Body      string
	QuoteKind string
	QuoteID   *uuid.UUID
}

func clean(title string) (string, error) {
	title = strings.TrimSpace(title)
	if n := utf8.RuneCountInString(title); n < 1 || n > 200 {
		return "", ErrInvalid("give the document a title of up to 200 characters")
	}
	return title, nil
}

func (s *Service) Create(ctx context.Context, t store.Tenant, title string) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	title, err := clean(title)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		d, err := q.InsertFindingDoc(ctx, dbgen.InsertFindingDocParams{WorkspaceID: t.WorkspaceID, Title: title, CreatedBy: t.UserID})
		id = d.ID
		return err
	})
	return id, err
}

func (s *Service) List(ctx context.Context, t store.Tenant, query string, deletedOnly bool) ([]Row, error) {
	if deletedOnly && !t.Can(store.PermManage) {
		return nil, store.ErrForbidden
	}
	query = strings.TrimSpace(query)
	var out []Row
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListFindingDocs(ctx, dbgen.ListFindingDocsParams{
			WorkspaceID: t.WorkspaceID, DeletedOnly: deletedOnly, Q: query, PageSize: 200,
		})
		for _, r := range rows {
			out = append(out, Row{ID: r.ID, Title: r.Title, State: r.State, Blocks: int(r.Blocks),
				UpdatedAt: r.UpdatedAt, DeletedAt: tsPtr(r.DeletedAt)})
		}
		return err
	})
	return out, err
}

func tsPtr(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	v := ts.Time
	return &v
}

func (s *Service) Get(ctx context.Context, t store.Tenant, id uuid.UUID) (Doc, error) {
	var out Doc
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDoc(ctx, dbgen.GetFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && d.DeletedAt.Valid) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		blocks, err := q.ListFindingBlocks(ctx, dbgen.ListFindingBlocksParams{WorkspaceID: t.WorkspaceID, DocID: id})
		if err != nil {
			return err
		}
		out = Doc{ID: d.ID, Title: d.Title, State: d.State, PublishedAt: tsPtr(d.PublishedAt), UpdatedAt: d.UpdatedAt,
			DeletedAt: tsPtr(d.DeletedAt), ShareExpiresAt: tsPtr(d.ShareExpiresAt), PasswordProtected: d.SharePasswordHash.Valid,
			Blocks: blocksOf(blocks)}
		if d.State == "published" {
			out.PublicLink = s.linkURL(s.Token(t.WorkspaceID, d.ID, int(d.ShareEpoch)))
		}
		return nil
	})
	return out, err
}

func blocksOf(rows []dbgen.ListFindingBlocksRow) []Block {
	out := make([]Block, 0, len(rows))
	for _, r := range rows {
		b := Block{ID: r.ID, Kind: r.Kind, Body: r.Body}
		if r.Kind == "quote" {
			b.QuoteKind = r.QuoteKind.String
			switch {
			case r.EvidenceID.Valid:
				id := r.EvidenceID.UUID
				b.QuoteID = &id
			case r.HighlightID.Valid:
				id := r.HighlightID.UUID
				b.QuoteID = &id
			}
			b.Removed = b.QuoteID == nil
			if !b.Removed {
				b.Quote, b.SourceTitle, b.RequestTitle = r.QuoteText, r.SourceTitle, r.RequestTitle
				if r.SourceItemID != uuid.Nil {
					id := r.SourceItemID
					b.SourceItemID = &id
				}
			}
		}
		out = append(out, b)
	}
	return out
}

func (s *Service) Rename(ctx context.Context, t store.Tenant, id uuid.UUID, title string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	title, err := clean(title)
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateFindingTitle(ctx, dbgen.UpdateFindingTitleParams{WorkspaceID: t.WorkspaceID, ID: id, Title: title})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// SetBlocks replaces the document's content. A published document cannot be edited: it would change what
// the public link shows without anyone confirming it. Take it down, edit, publish again.
func (s *Service) SetBlocks(ctx context.Context, t store.Tenant, id uuid.UUID, in []BlockInput) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if len(in) > MaxBlocks {
		return ErrInvalid(fmt.Sprintf("a document has at most %d blocks", MaxBlocks))
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDocForUpdate(ctx, dbgen.GetFindingDocForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if d.State == "published" {
			return ErrConflict
		}
		type row struct {
			kind, body, qk string
			ev, hl         uuid.NullUUID
		}
		rows := make([]row, 0, len(in))
		for i, b := range in {
			body := strings.TrimSpace(b.Body)
			switch b.Kind {
			case "text":
				if body == "" || utf8.RuneCountInString(body) > MaxText {
					return ErrInvalid(fmt.Sprintf("block %d needs text of up to %d characters", i+1, MaxText))
				}
				rows = append(rows, row{kind: "text", body: body})
			case "heading":
				if body == "" || utf8.RuneCountInString(body) > MaxHeading {
					return ErrInvalid(fmt.Sprintf("heading %d needs 1 to %d characters", i+1, MaxHeading))
				}
				rows = append(rows, row{kind: "heading", body: body})
			case "quote":
				if utf8.RuneCountInString(body) > MaxCardNote {
					return ErrInvalid(fmt.Sprintf("the note under card %d is too long (%d characters at most)", i+1, MaxCardNote))
				}
				r := row{kind: "quote", body: body}
				switch {
				case b.ID != nil:
					ref, err := q.GetFindingBlockRef(ctx, dbgen.GetFindingBlockRefParams{WorkspaceID: t.WorkspaceID, DocID: id, ID: *b.ID})
					if err != nil {
						return ErrInvalid(fmt.Sprintf("card %d is not part of this document", i+1))
					}
					r.qk, r.ev, r.hl = ref.QuoteKind.String, ref.EvidenceID, ref.HighlightID
				case b.QuoteID != nil && b.QuoteKind == "evidence":
					r.qk, r.ev = "evidence", uuid.NullUUID{UUID: *b.QuoteID, Valid: true}
				case b.QuoteID != nil && b.QuoteKind == "highlight":
					r.qk, r.hl = "highlight", uuid.NullUUID{UUID: *b.QuoteID, Valid: true}
				default:
					return ErrInvalid(fmt.Sprintf("card %d needs a quote", i+1))
				}
				rows = append(rows, r)
			default:
				return ErrInvalid(fmt.Sprintf("block %d has an unknown type", i+1))
			}
		}
		if err := q.DeleteFindingBlocks(ctx, dbgen.DeleteFindingBlocksParams{WorkspaceID: t.WorkspaceID, DocID: id}); err != nil {
			return err
		}
		for i, r := range rows {
			p := dbgen.InsertFindingBlockParams{WorkspaceID: t.WorkspaceID, DocID: id, Ordinal: int32(i), Kind: r.kind, Body: r.body, EvidenceID: r.ev, HighlightID: r.hl}
			if r.qk != "" {
				p.QuoteKind.String, p.QuoteKind.Valid = r.qk, true
			}
			if err := q.InsertFindingBlock(ctx, p); err != nil {
				return err
			}
		}
		if err := q.TouchFindingDoc(ctx, dbgen.TouchFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		return s.snapshot(ctx, q, t, id, d.Title, false)
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return ErrInvalid("a quote in this document does not exist in this workspace")
	}
	return err
}

// ---- history ----

type versionBlock struct {
	Kind        string     `json:"kind"`
	Body        string     `json:"body"`
	QuoteKind   string     `json:"quoteKind,omitempty"`
	EvidenceID  *uuid.UUID `json:"evidenceId,omitempty"`
	HighlightID *uuid.UUID `json:"highlightId,omitempty"`
}

// snapshot stores the document as it is now. Autosave calls it often, so a snapshot is kept at most once a
// minute unless force is set (a restore records both sides of the change). The newest 50 are kept.
func (s *Service) snapshot(ctx context.Context, q *dbgen.Queries, t store.Tenant, docID uuid.UUID, title string, force bool) error {
	last, err := q.LastFindingVersionAt(ctx, dbgen.LastFindingVersionAtParams{WorkspaceID: t.WorkspaceID, DocID: docID})
	if err != nil {
		return err
	}
	if !force && time.Since(last) < time.Minute {
		return nil
	}
	rows, err := q.ListFindingBlocks(ctx, dbgen.ListFindingBlocksParams{WorkspaceID: t.WorkspaceID, DocID: docID})
	if err != nil {
		return err
	}
	blocks := make([]versionBlock, 0, len(rows))
	for _, r := range rows {
		b := versionBlock{Kind: r.Kind, Body: r.Body}
		if r.QuoteKind.Valid {
			b.QuoteKind = r.QuoteKind.String
		}
		if r.EvidenceID.Valid {
			id := r.EvidenceID.UUID
			b.EvidenceID = &id
		}
		if r.HighlightID.Valid {
			id := r.HighlightID.UUID
			b.HighlightID = &id
		}
		blocks = append(blocks, b)
	}
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return err
	}
	if _, err := q.InsertFindingVersion(ctx, dbgen.InsertFindingVersionParams{
		WorkspaceID: t.WorkspaceID, DocID: docID, Title: title, Blocks: encoded, CreatedBy: t.UserID,
	}); err != nil {
		return err
	}
	return q.PruneFindingVersions(ctx, dbgen.PruneFindingVersionsParams{WorkspaceID: t.WorkspaceID, DocID: docID})
}

type Version struct {
	ID        uuid.UUID
	Title     string
	Blocks    int
	CreatedAt time.Time
}

func (s *Service) Versions(ctx context.Context, t store.Tenant, docID uuid.UUID) ([]Version, error) {
	var out []Version
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDoc(ctx, dbgen.GetFindingDocParams{WorkspaceID: t.WorkspaceID, ID: docID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && d.DeletedAt.Valid) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		rows, err := q.ListFindingVersions(ctx, dbgen.ListFindingVersionsParams{WorkspaceID: t.WorkspaceID, DocID: docID})
		if err != nil {
			return err
		}
		for _, r := range rows {
			out = append(out, Version{ID: r.ID, Title: r.Title, Blocks: int(r.Blocks), CreatedAt: r.CreatedAt})
		}
		return nil
	})
	return out, err
}

func (s *Service) RestoreVersion(ctx context.Context, t store.Tenant, docID, versionID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		d, err := q.GetFindingDocForUpdate(ctx, dbgen.GetFindingDocForUpdateParams{WorkspaceID: t.WorkspaceID, ID: docID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if d.State == "published" {
			return ErrConflict
		}
		v, err := q.GetFindingVersion(ctx, dbgen.GetFindingVersionParams{WorkspaceID: t.WorkspaceID, DocID: docID, ID: versionID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		var blocks []versionBlock
		if err := json.Unmarshal(v.Blocks, &blocks); err != nil {
			return err
		}
		if err := s.snapshot(ctx, q, t, docID, d.Title, true); err != nil {
			return err
		}
		if err := q.DeleteFindingBlocks(ctx, dbgen.DeleteFindingBlocksParams{WorkspaceID: t.WorkspaceID, DocID: docID}); err != nil {
			return err
		}
		for i, b := range blocks {
			p := dbgen.InsertFindingBlockParams{WorkspaceID: t.WorkspaceID, DocID: docID, Ordinal: int32(i), Kind: b.Kind, Body: b.Body}
			if b.QuoteKind != "" {
				p.QuoteKind = pgtype.Text{String: b.QuoteKind, Valid: true}
			}
			if b.EvidenceID != nil {
				p.EvidenceID = uuid.NullUUID{UUID: *b.EvidenceID, Valid: true}
			}
			if b.HighlightID != nil {
				p.HighlightID = uuid.NullUUID{UUID: *b.HighlightID, Valid: true}
			}
			if err := q.InsertFindingBlock(ctx, p); err != nil {
				return err
			}
		}
		if _, err := q.UpdateFindingTitle(ctx, dbgen.UpdateFindingTitleParams{WorkspaceID: t.WorkspaceID, ID: docID, Title: v.Title}); err != nil {
			return err
		}
		if err := q.TouchFindingDoc(ctx, dbgen.TouchFindingDocParams{WorkspaceID: t.WorkspaceID, ID: docID}); err != nil {
			return err
		}
		return s.snapshot(ctx, q, t, docID, v.Title, true)
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return ErrInvalid("a quote in that version has been deleted, so it cannot be restored")
	}
	return err
}

// Duplicate copies a live document and its cards into a new draft. Quote cards still point at the same
// stored words; a card whose quote was deleted is copied as a removed card.
func (s *Service) Duplicate(ctx context.Context, t store.Tenant, id uuid.UUID) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	var newID uuid.UUID
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		d, err := q.GetFindingDoc(ctx, dbgen.GetFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && d.DeletedAt.Valid) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		title := []rune(d.Title + " (copy)")
		if len(title) > 200 {
			title = title[:200]
		}
		nd, err := q.InsertFindingDoc(ctx, dbgen.InsertFindingDocParams{WorkspaceID: t.WorkspaceID, Title: string(title), CreatedBy: t.UserID})
		if err != nil {
			return err
		}
		blocks, err := q.ListFindingBlocks(ctx, dbgen.ListFindingBlocksParams{WorkspaceID: t.WorkspaceID, DocID: id})
		if err != nil {
			return err
		}
		for i, b := range blocks {
			p := dbgen.InsertFindingBlockParams{WorkspaceID: t.WorkspaceID, DocID: nd.ID, Ordinal: int32(i), Kind: b.Kind, Body: b.Body,
				QuoteKind: b.QuoteKind, EvidenceID: b.EvidenceID, HighlightID: b.HighlightID}
			if err := q.InsertFindingBlock(ctx, p); err != nil {
				return err
			}
		}
		newID = nd.ID
		return s.snapshot(ctx, q, t, nd.ID, nd.Title, true)
	})
	return newID, err
}

// Restore brings a deleted document back. Its old public link stays dead; publish again for a new one.
func (s *Service) Restore(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.RestoreFindingDoc(ctx, dbgen.RestoreFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// AddQuote appends one quote card to a draft document, after everything already there. It appends rather than
// replacing the block list so notes on existing cards are never lost.
func (s *Service) AddQuote(ctx context.Context, t store.Tenant, id uuid.UUID, quoteKind string, quoteID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	if quoteKind != "evidence" && quoteKind != "highlight" {
		return ErrInvalid("unknown quote type")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDocForUpdate(ctx, dbgen.GetFindingDocForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if d.State == "published" {
			return ErrConflict
		}
		ordinal, err := q.NextFindingBlockOrdinal(ctx, dbgen.NextFindingBlockOrdinalParams{WorkspaceID: t.WorkspaceID, DocID: id})
		if err != nil {
			return err
		}
		p := dbgen.InsertFindingBlockParams{WorkspaceID: t.WorkspaceID, DocID: id, Ordinal: ordinal, Kind: "quote", QuoteKind: pgtype.Text{String: quoteKind, Valid: true}}
		if quoteKind == "evidence" {
			p.EvidenceID = uuid.NullUUID{UUID: quoteID, Valid: true}
		} else {
			p.HighlightID = uuid.NullUUID{UUID: quoteID, Valid: true}
		}
		if err := q.InsertFindingBlock(ctx, p); err != nil {
			return err
		}
		return q.TouchFindingDoc(ctx, dbgen.TouchFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id})
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return ErrInvalid("that quote does not exist in this workspace")
	}
	return err
}

// Delete removes a document (admins only). A published one is taken down first, so its link stops at once.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.DeleteFindingDoc(ctx, dbgen.DeleteFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// Publish makes the document readable through a link. Admins only, and only after saying they have read the
// quotes: they are shown word for word, and customers' words can name people.
func (s *Service) Publish(ctx context.Context, t store.Tenant, id uuid.UUID, confirmed bool, expiresAt *time.Time, password string) (string, *time.Time, error) {
	if !t.Can(store.PermManage) {
		return "", nil, store.ErrForbidden
	}
	if !confirmed {
		return "", nil, ErrNotSure
	}
	if expiresAt != nil {
		now := time.Now()
		if !expiresAt.After(now) || expiresAt.After(now.Add(365*24*time.Hour)) {
			return "", nil, ErrInvalid("choose an expiry in the next year")
		}
	}
	var hash pgtype.Text
	if password != "" {
		if n := utf8.RuneCountInString(password); n < 8 || n > 200 {
			return "", nil, ErrInvalid("use a password of 8 to 200 characters")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return "", nil, err
		}
		hash = pgtype.Text{String: string(h), Valid: true}
	}
	var link string
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDocForUpdate(ctx, dbgen.GetFindingDocForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		blocks, err := q.ListFindingBlocks(ctx, dbgen.ListFindingBlocksParams{WorkspaceID: t.WorkspaceID, DocID: id})
		if err != nil {
			return err
		}
		if len(blocks) == 0 {
			return ErrInvalid("add something to the document before publishing it")
		}
		for _, b := range blocksOf(blocks) {
			if b.Kind == "quote" && b.Removed {
				return ErrInvalid("a card in this document points at a quote that was removed; delete the card first")
			}
		}
		if _, err := q.PublishFindingDoc(ctx, dbgen.PublishFindingDocParams{
			WorkspaceID: t.WorkspaceID, ID: id, PublishedBy: uuid.NullUUID{UUID: t.UserID, Valid: true},
			ShareExpiresAt:    pgtype.Timestamptz{Time: timeOrZero(expiresAt), Valid: expiresAt != nil},
			SharePasswordHash: hash,
		}); err != nil {
			return err
		}
		link = s.linkURL(s.Token(t.WorkspaceID, id, int(d.ShareEpoch)))
		return nil
	})
	return link, expiresAt, err
}

func timeOrZero(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

// Unpublish takes the link down at once; the old link never works again, even if the document is published again.
func (s *Service) Unpublish(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if _, err := q.UnpublishFindingDoc(ctx, dbgen.UnpublishFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrConflict
			}
			return err
		}
		return nil
	})
}

// ---- the public page ----

type PublicBlock struct {
	Kind string // "text", "heading" or "quote"
	Text string // the paragraph, or the quote
	Note string // under a quote
}

type Public struct {
	Title       string
	PublishedAt *time.Time
	ExpiresAt   *time.Time
	Blocks      []PublicBlock
}

// Unlock trades the link's password for a short-lived grant. The grant is signed, so a later read can check
// it without keeping a session; it is limited by the link's own expiry.
func (s *Service) Unlock(ctx context.Context, token, password string) (string, time.Time, error) {
	ws, doc, epoch, err := s.verify(token)
	if err != nil {
		return "", time.Time{}, ErrNotFound
	}
	var grant string
	var until time.Time
	err = store.WithTenant(ctx, s.Pool, store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDoc(ctx, dbgen.GetFindingDocParams{WorkspaceID: ws, ID: doc})
		if err != nil || d.DeletedAt.Valid || d.State != "published" || int(d.ShareEpoch) != epoch {
			return ErrNotFound
		}
		if d.ShareExpiresAt.Valid && !time.Now().Before(d.ShareExpiresAt.Time) {
			return ErrNotFound
		}
		if !d.SharePasswordHash.Valid {
			return ErrInvalid("this link does not need a password")
		}
		if bcrypt.CompareHashAndPassword([]byte(d.SharePasswordHash.String), []byte(password)) != nil {
			return ErrBadPassword
		}
		until = time.Now().Add(grantTTL)
		if d.ShareExpiresAt.Valid && d.ShareExpiresAt.Time.Before(until) {
			until = d.ShareExpiresAt.Time
		}
		grant = s.mintGrant(token, until)
		return nil
	})
	return grant, until, err
}

// Public is what the link shows: the title, the paragraphs, and each quote's words with the author's note.
// No names, no source titles, no ids, no workspace details. Anything wrong with the link is "not found".
func (s *Service) Public(ctx context.Context, token, grant string) (Public, error) {
	ws, doc, epoch, err := s.verify(token)
	if err != nil {
		return Public{}, ErrNotFound
	}
	var out Public
	err = store.WithTenant(ctx, s.Pool, store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDoc(ctx, dbgen.GetFindingDocParams{WorkspaceID: ws, ID: doc})
		if err != nil || d.DeletedAt.Valid || d.State != "published" || int(d.ShareEpoch) != epoch {
			return ErrNotFound
		}
		if d.ShareExpiresAt.Valid && !time.Now().Before(d.ShareExpiresAt.Time) {
			return ErrNotFound
		}
		if d.SharePasswordHash.Valid && !s.grantValid(token, grant) {
			return ErrPasswordRequired
		}
		blocks, err := q.ListFindingBlocks(ctx, dbgen.ListFindingBlocksParams{WorkspaceID: ws, DocID: doc})
		if err != nil {
			return err
		}
		out = Public{Title: d.Title, PublishedAt: tsPtr(d.PublishedAt), ExpiresAt: tsPtr(d.ShareExpiresAt)}
		for _, b := range blocksOf(blocks) {
			switch {
			case b.Kind == "text":
				out.Blocks = append(out.Blocks, PublicBlock{Kind: "text", Text: b.Body})
			case b.Kind == "heading":
				out.Blocks = append(out.Blocks, PublicBlock{Kind: "heading", Text: b.Body})
			case !b.Removed:
				out.Blocks = append(out.Blocks, PublicBlock{Kind: "quote", Text: b.Quote, Note: b.Body})
			}
		}
		return nil
	})
	return out, err
}
