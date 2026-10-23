package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/media"
)

// raw sends a non-JSON request and returns the status, body and headers.
func (hn *harness) raw(token, method, path string, body []byte, hdr map[string]string) (int, []byte, http.Header) {
	hn.t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	hn.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes(), rec.Header()
}

func mp3(n int) []byte {
	return append([]byte("ID3\x04\x00\x00"), bytes.Repeat([]byte{byte('a')}, n)...)
}

func TestRecordingFromUploadToHighlightAndDeletionOverHTTP(t *testing.T) {
	recordingLifecycle(t, newHarness(t))
}

// The same lifecycle with the files in an S3-compatible bucket instead of on disk.
func TestRecordingLifecycleOnS3Storage(t *testing.T) {
	recordingLifecycle(t, newHarnessStore(t, fakeS3Store(t)))
}

func recordingLifecycle(t *testing.T, h *harness) {
	ws := h.workspace(h.alice, "Recordings")
	base := "/v1/workspaces/" + ws
	data := mp3(20_000)

	code, up, _ := h.do(h.alice, "POST", base+"/media", map[string]any{"filename": "Interview.mp3", "mimeType": "audio/mpeg", "sizeBytes": len(data)})
	if code != 201 || up["state"] != "uploading" || up["receivedBytes"].(float64) != 0 || up["chunkBytes"].(float64) < 1 {
		t.Fatalf("start: %d %v", code, up)
	}
	id := up["id"].(string)
	chunk := func(off, end int) (int, map[string]any) {
		code, body, _ := h.raw(h.alice, "PUT", base+"/media/"+id+"/chunk?offset="+strconv.Itoa(off), data[off:end], map[string]string{"Content-Type": "application/octet-stream"})
		var m map[string]any
		_ = json.Unmarshal(body, &m)
		return code, m
	}
	if code, m := chunk(0, 8000); code != 200 || m["receivedBytes"].(float64) != 8000 {
		t.Fatalf("chunk 1: %d %v", code, m)
	}
	// The same piece again: a plain 409 that says where to continue; the status endpoint agrees.
	code, m := chunk(0, 8000)
	e := m["error"].(map[string]any)
	if code != 409 || e["code"] != "wrong_position" || !strings.Contains(e["message"].(string), "8000") {
		t.Fatalf("repeat: %d %v", code, m)
	}
	if _, st, _ := h.do(h.alice, "GET", base+"/media/"+id, nil); st["receivedBytes"].(float64) != 8000 {
		t.Fatalf("%v", st)
	}
	if code, _ := chunk(8000, len(data)); code != 200 {
		t.Fatalf("chunk 2: %d", code)
	}
	// Strangers and anonymous callers get nothing.
	if code, _, _ := h.raw(h.bob, "GET", base+"/media/"+id+"/file", nil, nil); code != 404 {
		t.Fatalf("stranger: %d", code)
	}
	if code, _, _ := h.raw("", "GET", base+"/media/"+id+"/file", nil, nil); code != 401 {
		t.Fatalf("anonymous: %d", code)
	}
	// The file cannot be played until the upload is completed.
	if code, _, _ := h.raw(h.alice, "GET", base+"/media/"+id+"/file", nil, nil); code != 404 {
		t.Fatalf("unfinished upload playable: %d", code)
	}
	code, done, _ := h.do(h.alice, "POST", base+"/media/"+id+"/complete", nil)
	if code != 200 || done["state"] != "uploaded" {
		t.Fatalf("complete: %d %v", code, done)
	}

	// Playback with ranges (what an audio element does).
	code, whole, hd := h.raw(h.alice, "GET", base+"/media/"+id+"/file", nil, nil)
	if code != 200 || !bytes.Equal(whole, data) || hd.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("whole: %d %d bytes %v", code, len(whole), hd)
	}
	for _, c := range []struct {
		rng, want string
		from, to  int
	}{{"bytes=100-199", "bytes 100-199/20006", 100, 200}, {"bytes=20000-", "bytes 20000-20005/20006", 20000, 20006}, {"bytes=-10", "bytes 19996-20005/20006", 19996, 20006}} {
		code, part, hd := h.raw(h.alice, "GET", base+"/media/"+id+"/file", nil, map[string]string{"Range": c.rng})
		if code != 206 || !bytes.Equal(part, data[c.from:c.to]) || hd.Get("Content-Range") != c.want {
			t.Errorf("%s: %d %q %v", c.rng, code, hd.Get("Content-Range"), len(part))
		}
	}
	for _, rng := range []string{"bytes=99999-", "bytes=5-2", "bytes=-0", "bytes=abc-"} {
		if code, _, hd := h.raw(h.alice, "GET", base+"/media/"+id+"/file", nil, map[string]string{"Range": rng}); code != 416 || !strings.HasPrefix(hd.Get("Content-Range"), "bytes */") {
			t.Errorf("%s: %d %v", rng, code, hd)
		}
	}
	if code, body, _ := h.raw(h.alice, "GET", base+"/media/"+id+"/file", nil, map[string]string{"Range": "bytes=0-1,5-6"}); code != 200 || len(body) != len(data) {
		t.Errorf("multi-range should be ignored: %d", code)
	}

	// The worker transcribes; the recording becomes a source with a timeline.
	if err := h.transW.Work(context.Background(), &river.Job[media.TranscribeArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
		Args: media.TranscribeArgs{WorkspaceID: uuid.MustParse(ws), MediaID: uuid.MustParse(id), UserID: h.aliceID}}); err != nil {
		t.Fatal(err)
	}
	_, st, _ := h.do(h.alice, "GET", base+"/media/"+id, nil)
	if st["state"] != "done" || st["sourceItemId"] == nil || st["durationMs"].(float64) != 30000 {
		t.Fatalf("%v", st)
	}
	src := st["sourceItemId"].(string)
	_, source, _ := h.do(h.alice, "GET", base+"/sources/"+src, nil)
	if source["kind"] != "recording" || source["mediaId"] != id || !strings.Contains(source["text"].(string), "Priya: We really need SSO") {
		t.Fatalf("%v", source)
	}
	_, tr, _ := h.do(h.alice, "GET", base+"/sources/"+src+"/transcript", nil)
	segs := tr["segments"].([]any)
	if tr["mediaId"] != id || len(segs) != 2 || segs[1].(map[string]any)["startMs"].(float64) != 6000 || segs[1].(map[string]any)["speaker"] != "Sam" {
		t.Fatalf("%v", tr)
	}

	// A highlight on Sam's line knows it was said at 6 seconds; a highlight on Priya's line at 0.
	text := source["text"].(string)
	for quote, wantMS := range map[string]float64{"Noted, thanks.": 6000, "need SSO for our team": 0} {
		start := strings.Index(text, quote)
		if code, hl, _ := h.do(h.alice, "POST", base+"/highlights", map[string]any{"sourceItemId": src, "spanStart": start, "spanEnd": start + len(quote), "quote": quote}); code != 201 {
			t.Fatalf("highlight %q: %d %v", quote, code, hl)
		}
		_, list, _ := h.do(h.alice, "GET", base+"/highlights?sourceItemId="+src, nil)
		found := false
		for _, x := range list["highlights"].([]any) {
			m := x.(map[string]any)
			if m["quote"] == quote {
				found = true
				if m["startMs"] == nil || m["startMs"].(float64) != wantMS {
					t.Errorf("%q: startMs %v, want %v", quote, m["startMs"], wantMS)
				}
			}
		}
		if !found {
			t.Errorf("%q not listed", quote)
		}
	}

	// Playback is open to viewers; deleting is not.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, body, _ := h.raw(h.bob, "GET", base+"/media/"+id+"/file", nil, nil); code != 200 || !bytes.Equal(body, data) {
		t.Fatalf("viewer playback: %d", code)
	}
	if code, _, _ := h.do(h.bob, "DELETE", base+"/media/"+id, nil); code != 403 {
		t.Fatalf("viewer delete: %d", code)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/media", map[string]any{"filename": "x.mp3", "mimeType": "audio/mpeg", "sizeBytes": 10}); code != 403 {
		t.Fatalf("viewer upload: %d", code)
	}
	// Only an admin deletes a whole conversation; the file and the transcript go with it.
	if code, _, _ := h.do(h.bob, "DELETE", base+"/sources/"+src, nil); code != 403 {
		t.Fatalf("viewer delete source: %d", code)
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/sources/"+src, nil); code != 204 {
		t.Fatalf("delete source: %d", code)
	}
	if code, _, _ := h.do(h.alice, "GET", base+"/media/"+id, nil); code != 404 {
		t.Fatalf("recording still there: %d", code)
	}
	if keys, _ := h.disk.Keys(context.Background()); len(keys) != 0 {
		t.Fatalf("files left behind: %v", keys)
	}
}

func TestUploadRulesOverHTTP(t *testing.T) { uploadRules(t, newHarness(t)) }

func TestUploadRulesOnS3Storage(t *testing.T) { uploadRules(t, newHarnessStore(t, fakeS3Store(t))) }

func uploadRules(t *testing.T, h *harness) {
	ws := h.workspace(h.alice, "Rules")
	base := "/v1/workspaces/" + ws
	for name, body := range map[string]map[string]any{
		"exe":           {"filename": "a.exe", "mimeType": "application/octet-stream", "sizeBytes": 10},
		"mismatch":      {"filename": "a.mp3", "mimeType": "audio/wav", "sizeBytes": 10},
		"zero bytes":    {"filename": "a.mp3", "mimeType": "audio/mpeg", "sizeBytes": 0},
		"too big":       {"filename": "a.mp3", "mimeType": "audio/mpeg", "sizeBytes": int64(5) << 30},
		"unknown field": {"filename": "a.mp3", "mimeType": "audio/mpeg", "sizeBytes": 10, "storageKey": "../x"},
	} {
		if code, e, _ := h.do(h.alice, "POST", base+"/media", body); code != 400 {
			t.Errorf("%s: %d %v", name, code, e)
		}
	}
	// A body that is not what its name says is refused on the first piece, and nothing is stored.
	_, up, _ := h.do(h.alice, "POST", base+"/media", map[string]any{"filename": "a.mp3", "mimeType": "audio/mpeg", "sizeBytes": 50})
	id := up["id"].(string)
	if code, _, _ := h.raw(h.alice, "PUT", base+"/media/"+id+"/chunk?offset=0", append([]byte("MZ"), make([]byte, 48)...), map[string]string{"Content-Type": "application/octet-stream"}); code != 400 {
		t.Errorf("executable posing as mp3: %d", code)
	}
	if keys, _ := h.disk.Keys(context.Background()); len(keys) > 0 {
		for _, k := range keys {
			if sz, _ := h.disk.Size(context.Background(), k); sz != 0 {
				t.Errorf("refused bytes were kept in %s", k)
			}
		}
	}
	// A negative or missing offset is rejected by the contract.
	if code, _, _ := h.raw(h.alice, "PUT", base+"/media/"+id+"/chunk?offset=-1", []byte("x"), map[string]string{"Content-Type": "application/octet-stream"}); code != 400 {
		t.Errorf("negative offset: %d", code)
	}
	// Pieces larger than the cap are refused without being buffered.
	big := make([]byte, 10<<20)
	copy(big, "ID3")
	_, up2, _ := h.do(h.alice, "POST", base+"/media", map[string]any{"filename": "b.mp3", "mimeType": "audio/mpeg", "sizeBytes": len(big)})
	if code, _, _ := h.raw(h.alice, "PUT", base+"/media/"+up2["id"].(string)+"/chunk?offset=0", big, map[string]string{"Content-Type": "application/octet-stream"}); code != 413 && code != 400 {
		t.Errorf("a 10 MB piece: %d", code)
	}
}
