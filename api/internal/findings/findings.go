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

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("findings: not found")
	ErrConflict = errors.New("findings: not allowed in this state")
	ErrBadLink  = errors.New("findings: bad link")
	ErrNotSure  = errors.New("findings: publishing needs confirmation")
)

// ErrInvalid is input the caller must fix; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

const (
	MaxBlocks   = 200
	MaxText     = 5000
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
	Kind         string // "text" or "quote"
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
	ID          uuid.UUID
	Title       string
	State       string
	PublicLink  string
	PublishedAt *time.Time
	UpdatedAt   time.Time
	Blocks      []Block
}

type Row struct {
	ID        uuid.UUID
	Title     string
	State     string
	Blocks    int
	UpdatedAt time.Time
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

func (s *Service) List(ctx context.Context, t store.Tenant) ([]Row, error) {
	var out []Row
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListFindingDocs(ctx, dbgen.ListFindingDocsParams{WorkspaceID: t.WorkspaceID, Limit: 200})
		for _, r := range rows {
			out = append(out, Row{ID: r.ID, Title: r.Title, State: r.State, Blocks: int(r.Blocks), UpdatedAt: r.UpdatedAt})
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
		out = Doc{ID: d.ID, Title: d.Title, State: d.State, PublishedAt: tsPtr(d.PublishedAt), UpdatedAt: d.UpdatedAt, Blocks: blocksOf(blocks)}
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
		return q.TouchFindingDoc(ctx, dbgen.TouchFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id})
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return ErrInvalid("a quote in this document does not exist in this workspace")
	}
	return err
}

// Delete removes a document (admins only). A published one is taken down first, so its link stops at once.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if t.Role != store.RoleAdmin {
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
func (s *Service) Publish(ctx context.Context, t store.Tenant, id uuid.UUID, confirmed bool) (string, error) {
	if t.Role != store.RoleAdmin {
		return "", store.ErrForbidden
	}
	if !confirmed {
		return "", ErrNotSure
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
		if d.State != "published" {
			if _, err := q.PublishFindingDoc(ctx, dbgen.PublishFindingDocParams{WorkspaceID: t.WorkspaceID, ID: id, PublishedBy: uuid.NullUUID{UUID: t.UserID, Valid: true}}); err != nil {
				return err
			}
		}
		link = s.linkURL(s.Token(t.WorkspaceID, id, int(d.ShareEpoch)))
		return nil
	})
	return link, err
}

// Unpublish takes the link down at once; the old link never works again, even if the document is published again.
func (s *Service) Unpublish(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if t.Role != store.RoleAdmin {
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
	Kind string // "text" or "quote"
	Text string // the paragraph, or the quote
	Note string // under a quote
}

type Public struct {
	Title       string
	PublishedAt *time.Time
	Blocks      []PublicBlock
}

// Public is what the link shows: the title, the paragraphs, and each quote's words with the author's note.
// No names, no source titles, no ids, no workspace details. Anything wrong with the link is "not found".
func (s *Service) Public(ctx context.Context, token string) (Public, error) {
	ws, doc, epoch, err := s.verify(token)
	if err != nil {
		return Public{}, ErrNotFound
	}
	var out Public
	err = store.WithTenant(ctx, s.Pool, store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}, func(q *dbgen.Queries) error {
		d, err := q.GetFindingDoc(ctx, dbgen.GetFindingDocParams{WorkspaceID: ws, ID: doc})
		if err != nil || d.State != "published" || int(d.ShareEpoch) != epoch {
			return ErrNotFound
		}
		blocks, err := q.ListFindingBlocks(ctx, dbgen.ListFindingBlocksParams{WorkspaceID: ws, DocID: doc})
		if err != nil {
			return err
		}
		out = Public{Title: d.Title, PublishedAt: tsPtr(d.PublishedAt)}
		for _, b := range blocksOf(blocks) {
			switch {
			case b.Kind == "text":
				out.Blocks = append(out.Blocks, PublicBlock{Kind: "text", Text: b.Body})
			case !b.Removed:
				out.Blocks = append(out.Blocks, PublicBlock{Kind: "quote", Text: b.Quote, Note: b.Body})
			}
		}
		return nil
	})
	return out, err
}
