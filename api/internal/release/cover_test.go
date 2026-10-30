package release_test

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/release"
	"product/api/internal/store"
	"product/api/internal/testdb"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func jpegBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{200, uint8(x), uint8(y), 255})
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestCoverLifecycleAndMetadataStripping(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	ten := tenant(t, db, "Covers")

	id, err := svc.Create(ctx, ten, "Export to CSV", "Words", "")
	if err != nil {
		t.Fatal(err)
	}
	// Anything appended after the picture is not part of it: a location tag must not survive.
	trailer := append(append([]byte{}, jpegBytes(t, 40, 30)...), []byte("GPS 51.5074N 0.1278W")...)
	if err := svc.SetCover(ctx, ten, id, trailer); err != nil {
		t.Fatal(err)
	}
	c, err := svc.GetCover(ctx, ten, id)
	if err != nil {
		t.Fatal(err)
	}
	if c.ContentType != "image/jpeg" {
		t.Fatalf("type: %q", c.ContentType)
	}
	if bytes.Contains(c.Data, []byte("GPS")) {
		t.Fatal("the stored picture still carries the trailer")
	}
	if _, format, err := image.Decode(bytes.NewReader(c.Data)); err != nil || format != "jpeg" {
		t.Fatalf("stored picture does not decode: %v %q", err, format)
	}
	n, _ := svc.Get(ctx, ten, id)
	if n.CoverUpdatedAt == nil {
		t.Fatal("the note does not say it has a cover")
	}

	// Replacing it switches format and keeps one picture per note.
	if err := svc.SetCover(ctx, ten, id, pngBytes(t, 20, 10)); err != nil {
		t.Fatal(err)
	}
	c, _ = svc.GetCover(ctx, ten, id)
	if c.ContentType != "image/png" {
		t.Fatalf("replaced type: %q", c.ContentType)
	}

	if err := svc.DeleteCover(ctx, ten, id); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetCover(ctx, ten, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
	if err := svc.DeleteCover(ctx, ten, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("deleting twice: %v", err)
	}
	n, _ = svc.Get(ctx, ten, id)
	if n.CoverUpdatedAt != nil {
		t.Fatal("the note still claims a cover")
	}
}

func TestCoverValidation(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	ten := tenant(t, db, "Bad covers")
	id, err := svc.Create(ctx, ten, "Note", "", "")
	if err != nil {
		t.Fatal(err)
	}
	wide := pngBytes(t, 4097, 1)
	cases := map[string][]byte{
		"empty":        {},
		"not an image": []byte("just some words"),
		"too large":    bytes.Repeat([]byte{0xff}, release.MaxCoverBytes+1),
		"too wide":     wide,
	}
	for name, b := range cases {
		if err := svc.SetCover(ctx, ten, id, b); !errors.As(err, new(release.ErrInvalid)) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Nothing was stored by the refusals.
	if _, err := svc.GetCover(ctx, ten, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("a refused picture was stored: %v", err)
	}
}

func TestCoverVisibilityFollowsTheNote(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	ten := tenant(t, db, "Cover visibility")
	other := tenant(t, db, "Elsewhere")
	sl := slug(t)
	if err := svc.UpdateSettings(ctx, ten, sl, "Priya", nil); err != nil {
		t.Fatal(err)
	}
	id, err := svc.Create(ctx, ten, "Single sign-on", "Words", "")
	if err != nil {
		t.Fatal(err)
	}
	pic := pngBytes(t, 12, 12)

	if err := svc.SetCover(ctx, other, id, pic); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("stranger upload: %v", err)
	}
	viewer := ten
	viewer.Role = store.RoleViewer
	if err := svc.SetCover(ctx, viewer, id, pic); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer upload: %v", err)
	}
	if err := svc.SetCover(ctx, ten, id, pic); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicCover(ctx, sl, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("a draft's cover is public: %v", err)
	}
	if err := svc.Publish(ctx, ten, id, nil); err != nil {
		t.Fatal(err)
	}
	if c, err := svc.PublicCover(ctx, sl, id); err != nil || c.ContentType != "image/png" {
		t.Fatalf("published cover: %+v %v", c, err)
	}
	if err := svc.Unpublish(ctx, ten, id); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicCover(ctx, sl, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("a taken-down cover is public: %v", err)
	}
	// Another workspace cannot read it by id.
	if _, err := svc.GetCover(ctx, other, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("stranger read: %v", err)
	}
	if _, err := svc.PublicCover(ctx, slug(t), id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("cover through an unknown address: %v", err)
	}
	_ = uuid.Nil
}
