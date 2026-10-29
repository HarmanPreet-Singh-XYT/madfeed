package api

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func coverPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x * 8), 90, uint8(y * 8), 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// A cover goes from the editor to the public page and back off it, and only ever for a live note.
func TestReleaseNoteCoverOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Covers")
	base := "/v1/workspaces/" + ws
	_, created, _ := h.do(h.alice, "POST", base+"/release-notes", map[string]any{"title": "Export to CSV", "body": "Words"})
	id := created["id"].(string)
	slug := "covers" + ws[0:8]
	if code, s, _ := h.do(h.alice, "PUT", base+"/settings", map[string]any{"publicSlug": slug, "senderName": "Priya"}); code != 204 {
		t.Fatalf("public address: %d %v", code, s)
	}

	pic := coverPNG(t, 30, 20)
	if code, _, _ := h.rawBody(h.alice, "PUT", base+"/release-notes/"+id+"/cover", pic); code != 204 {
		t.Fatalf("upload: %d", code)
	}
	n := h.getNote(h.alice, ws, id)
	if n["coverUpdatedAt"] == nil {
		t.Fatal("the note does not report a cover")
	}

	code, header, body := h.rawBody(h.alice, "GET", base+"/release-notes/"+id+"/cover", nil)
	if code != 200 || len(body) == 0 {
		t.Fatalf("read: %d %d bytes", code, len(body))
	}
	if header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("nosniff missing: %v", header)
	}
	if img, format, err := image.Decode(bytes.NewReader(body)); err != nil || format != "png" || img.Bounds().Dx() != 30 {
		t.Fatalf("stored picture: %v %v", err, format)
	}

	// A draft's picture is not public.
	if code, _, _ := h.rawBody("", "GET", "/v1/public/releases/"+slug+"/"+id+"/cover", nil); code != 404 {
		t.Fatalf("draft cover: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/release-notes/"+id+"/publish", nil); code != 204 {
		t.Fatalf("publish: %d", code)
	}
	code, pubHeader, body := h.rawBody("", "GET", "/v1/public/releases/"+slug+"/"+id+"/cover", nil)
	if code != 200 || len(body) == 0 {
		t.Fatalf("public cover: %d", code)
	}
	if pubHeader.Get("Cache-Control") == "" {
		t.Fatal("public cover without cache headers")
	}

	// An anonymous caller cannot read the team's own copy.
	if code, _, _ := h.rawBody("", "GET", base+"/release-notes/"+id+"/cover", nil); code != 401 {
		t.Fatalf("anonymous read: %d", code)
	}

	// Removing it takes it off the public page too.
	if code, _, _ := h.do(h.alice, "DELETE", base+"/release-notes/"+id+"/cover", nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _, _ := h.rawBody("", "GET", "/v1/public/releases/"+slug+"/"+id+"/cover", nil); code != 404 {
		t.Fatalf("cover after delete: %d", code)
	}
	if n := h.getNote(h.alice, ws, id); n["coverUpdatedAt"] != nil {
		t.Fatal("the note still reports a cover")
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/release-notes/"+id+"/cover", nil); code != 404 {
		t.Fatalf("deleting twice: %d", code)
	}
}

func (hn *harness) getNote(token, ws, id string) map[string]any {
	hn.t.Helper()
	code, n, _ := hn.do(token, "GET", "/v1/workspaces/"+ws+"/release-notes/"+id, nil)
	if code != 200 {
		hn.t.Fatalf("get note: %d", code)
	}
	return n
}
