package release

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// MaxCoverBytes is the size a cover may be, before and after it is re-encoded.
const MaxCoverBytes = 2 << 20

// A cover is a picture, not a print: anything larger than this is a mistake someone should fix.
const maxCoverSide = 4096

type Cover struct {
	ContentType string
	Data        []byte
	UpdatedAt   time.Time
}

// normalizeCover proves the bytes are a PNG or JPEG picture and re-encodes them, so nothing hidden in
// the original file (where it was taken, on what device) reaches the public page. The format is read
// from the bytes themselves, never from a header the uploader controls.
func normalizeCover(raw []byte) (string, []byte, error) {
	if len(raw) == 0 {
		return "", nil, ErrInvalid("the picture is empty")
	}
	if len(raw) > MaxCoverBytes {
		return "", nil, ErrInvalid("the cover must be under 2 MB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg") {
		return "", nil, ErrInvalid("the cover must be a PNG or JPEG picture")
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > maxCoverSide || cfg.Height > maxCoverSide {
		return "", nil, ErrInvalid("the cover must be at most 4096 pixels wide and tall")
	}
	img, decoded, err := image.Decode(bytes.NewReader(raw))
	if err != nil || decoded != format {
		return "", nil, ErrInvalid("the cover must be a PNG or JPEG picture")
	}

	var out bytes.Buffer
	switch format {
	case "png":
		if err := png.Encode(&out, img); err != nil {
			return "", nil, ErrInvalid("that picture could not be read")
		}
	case "jpeg":
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 85}); err != nil {
			return "", nil, ErrInvalid("that picture could not be read")
		}
	}
	if out.Len() > MaxCoverBytes {
		return "", nil, ErrInvalid("the cover is still over 2 MB after processing; choose a smaller picture")
	}
	return "image/" + format, out.Bytes(), nil
}

// SetCover replaces a note's cover. The bytes are checked and re-encoded before they are stored.
func (s *Service) SetCover(ctx context.Context, t store.Tenant, id uuid.UUID, raw []byte) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	kind, data, err := normalizeCover(raw)
	if err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		if _, err := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if err := q.PutNoteCover(ctx, dbgen.PutNoteCoverParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id, ContentType: kind, Size: int32(len(data)), Data: data}); err != nil {
			return err
		}
		_, err := q.TouchNoteCover(ctx, dbgen.TouchNoteCoverParams{WorkspaceID: t.WorkspaceID, ID: id})
		return err
	})
}

func (s *Service) cover(ctx context.Context, t store.Tenant, id uuid.UUID) (Cover, error) {
	var out Cover
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.GetNoteCover(ctx, dbgen.GetNoteCoverParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = Cover{ContentType: c.ContentType, Data: c.Data, UpdatedAt: c.UpdatedAt}
		return nil
	})
	return out, err
}

// GetCover is for the team's own screens: a draft's picture is only visible to members.
func (s *Service) GetCover(ctx context.Context, t store.Tenant, id uuid.UUID) (Cover, error) {
	return s.cover(ctx, t, id)
}

func (s *Service) DeleteCover(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		n, err := q.DeleteNoteCover(ctx, dbgen.DeleteNoteCoverParams{WorkspaceID: t.WorkspaceID, ReleaseNoteID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			if _, gerr := q.GetNote(ctx, dbgen.GetNoteParams{WorkspaceID: t.WorkspaceID, ID: id}); errors.Is(gerr, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return ErrNotFound
		}
		_, err = q.ClearNoteCoverTime(ctx, dbgen.ClearNoteCoverTimeParams{WorkspaceID: t.WorkspaceID, ID: id})
		return err
	})
}

// PublicCover serves a live note's picture to anyone with the address. A draft, a taken-down note,
// one still waiting for its time and another workspace's note all look the same: not found.
func (s *Service) PublicCover(ctx context.Context, slug string, id uuid.UUID) (Cover, error) {
	ws, err := s.workspaceForSlug(ctx, slug)
	if err != nil {
		return Cover{}, err
	}
	var out Cover
	err = store.WithTenant(ctx, s.Pool, publicTenant(ws), func(q *dbgen.Queries) error {
		c, err := q.PublicGetNoteCover(ctx, dbgen.PublicGetNoteCoverParams{WorkspaceID: ws, ReleaseNoteID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = Cover{ContentType: c.ContentType, Data: c.Data, UpdatedAt: c.UpdatedAt}
		return nil
	})
	return out, err
}
