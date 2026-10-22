// Package intake accepts pasted conversations, stores them immutably, and
// schedules extraction in the same transaction.
package intake

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/spans"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	DefaultMaxBytes   = 200_000
	DefaultChunkBytes = 6_000
	maxTitle          = 200
	maxURL            = 2000
)

// ErrInvalid is returned for input the caller must fix. The message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type PasteInput struct {
	Title     string
	Text      string
	OriginURL string
	PersonID  *uuid.UUID
}

type Result struct {
	SourceItemID uuid.UUID
	Duplicate    bool // the same text was already ingested; nothing new was queued
}

type Service struct {
	Pool       *pgxpool.Pool
	Jobs       *river.Client[pgx.Tx]
	MaxBytes   int
	ChunkBytes int
}

func (s *Service) limits() (int, int) {
	mb, cb := s.MaxBytes, s.ChunkBytes
	if mb <= 0 {
		mb = DefaultMaxBytes
	}
	if cb <= 0 {
		cb = DefaultChunkBytes
	}
	return mb, cb
}

// IngestPaste validates and stores the text, splits it into chunks, and
// enqueues extraction. All of it commits together or not at all.
func (s *Service) IngestPaste(ctx context.Context, t store.Tenant, in PasteInput) (Result, error) {
	if !t.CanWrite() {
		return Result{}, store.ErrForbidden
	}
	maxBytes, chunkBytes := s.limits()
	text, err := normalise(in.Text, maxBytes)
	if err != nil {
		return Result{}, err
	}
	title := strings.TrimSpace(in.Title)
	if utf8.RuneCountInString(title) > maxTitle {
		return Result{}, ErrInvalid("title is too long")
	}
	var origin pgtype.Text
	if in.OriginURL != "" {
		u, err := url.Parse(in.OriginURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(in.OriginURL) > maxURL {
			return Result{}, ErrInvalid("source link must be a valid http(s) URL")
		}
		origin = pgtype.Text{String: in.OriginURL, Valid: true}
	}
	sum := sha256.Sum256([]byte(text))
	hash := hex.EncodeToString(sum[:])

	var res Result
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		var person uuid.NullUUID
		if in.PersonID != nil {
			person = uuid.NullUUID{UUID: *in.PersonID, Valid: true}
		}
		item, err := q.InsertSourceItem(ctx, dbgen.InsertSourceItemParams{
			WorkspaceID: t.WorkspaceID, Kind: "paste", Title: title, RawText: text, ContentHash: hash,
			PersonID: person, OriginUrl: origin, CreatedBy: t.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) { // same content already stored
			existing, gerr := q.GetSourceItemByHash(ctx, dbgen.GetSourceItemByHashParams{WorkspaceID: t.WorkspaceID, ContentHash: hash})
			if gerr != nil {
				return gerr
			}
			res = Result{SourceItemID: existing.ID, Duplicate: true}
			return nil
		}
		if err != nil {
			return fmt.Errorf("store source: %w", err)
		}
		for _, c := range spans.Split(text, chunkBytes) {
			if _, err := q.InsertChunk(ctx, dbgen.InsertChunkParams{
				WorkspaceID: t.WorkspaceID, SourceItemID: item.ID, Ordinal: int32(c.Ordinal),
				StartOffset: int32(c.Start), EndOffset: int32(c.End), Text: c.Text,
			}); err != nil {
				return fmt.Errorf("store chunk: %w", err)
			}
		}
		if _, err := s.Jobs.InsertTx(ctx, tx, ExtractArgs{WorkspaceID: t.WorkspaceID, SourceItemID: item.ID, UserID: t.UserID}, nil); err != nil {
			return fmt.Errorf("enqueue extraction: %w", err)
		}
		res = Result{SourceItemID: item.ID}
		return nil
	})
	return res, err
}

// normalise makes the stored text canonical: valid UTF-8, LF newlines, no NULs.
// What is stored is the source of truth for every later quote.
func normalise(raw string, maxBytes int) (string, error) {
	if !utf8.ValidString(raw) {
		return "", ErrInvalid("text must be valid UTF-8")
	}
	if strings.ContainsRune(raw, 0) {
		return "", ErrInvalid("text contains unsupported characters")
	}
	text := strings.ReplaceAll(strings.ReplaceAll(raw, "\r\n", "\n"), "\r", "\n")
	if strings.TrimSpace(text) == "" {
		return "", ErrInvalid("text is empty")
	}
	if len(text) > maxBytes {
		return "", ErrInvalid(fmt.Sprintf("text is too long (limit %d bytes)", maxBytes))
	}
	return text, nil
}
