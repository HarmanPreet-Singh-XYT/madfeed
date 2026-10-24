package transcribe_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"product/api/internal/transcribe"
)

var ctx = context.Background()

func server(t *testing.T, status int, body string, seen *http.Request) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = *r.Clone(r.Context())
			_ = r.ParseMultipartForm(1 << 20)
			seen.PostForm = r.MultipartForm.Value
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestSegmentsAreCleanedAndOrdered(t *testing.T) {
	var seen http.Request
	srv := server(t, 200, `{"duration": 12.5, "segments": [
		{"start": 0.0, "end": 3.2, "text": "  Hello there.  ", "speaker": "A"},
		{"start": 3.0, "end": 2.0, "text": "   "},
		{"start": 1.0, "end": 0.5, "text": "Out of order."},
		{"start": 4.0, "end": 12.5, "text": "Bye ☕", "speaker": "B"}]}`, &seen)
	p := &transcribe.OpenAI{BaseURL: srv.URL, APIKey: "k", Model: "whisper-1"}
	res, err := p.Transcribe(ctx, "call.mp3", "audio/mpeg", strings.NewReader("audio"))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Segments) != 3 || res.Segments[0].Text != "Hello there." || res.Segments[0].Speaker != "A" {
		t.Fatalf("%+v", res.Segments)
	}
	// Times never go backwards and never end before they start.
	last := 0
	for _, s := range res.Segments {
		if s.StartMS < last || s.EndMS < s.StartMS {
			t.Errorf("bad times: %+v", s)
		}
		last = s.StartMS
	}
	if res.DurationMS != 12500 {
		t.Errorf("duration %d", res.DurationMS)
	}
	if seen.Header.Get("Authorization") != "Bearer k" || seen.PostForm["model"][0] != "whisper-1" || seen.PostForm["response_format"][0] != "verbose_json" {
		t.Errorf("request: %v %v", seen.Header, seen.PostForm)
	}
}

func TestADiarizingModelAsksForSpeakers(t *testing.T) {
	var seen http.Request
	srv := server(t, 200, `{"duration": 2, "segments": [{"start":0,"end":2,"text":"Hi","speaker":"speaker_0"}]}`, &seen)
	p := &transcribe.OpenAI{BaseURL: srv.URL, APIKey: "k", Model: "gpt-4o-transcribe-diarize"}
	res, err := p.Transcribe(ctx, "a.wav", "audio/wav", strings.NewReader("x"))
	if err != nil || res.Segments[0].Speaker != "speaker_0" || seen.PostForm["response_format"][0] != "diarized_json" {
		t.Fatalf("%v %+v %v", err, res, seen.PostForm)
	}
}

func TestFailuresAreClassified(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
		want   error
	}{
		"too big by vendor": {413, `{}`, transcribe.ErrTooLarge},
		"unreadable audio":  {400, `{}`, transcribe.ErrUnsupported},
		"rate limited":      {429, `{}`, transcribe.ErrUnavailable},
		"vendor down":       {503, `{}`, transcribe.ErrUnavailable},
		"garbage body":      {200, `not json`, transcribe.ErrUnavailable},
		"silence":           {200, `{"duration":3,"segments":[],"text":""}`, transcribe.ErrEmpty},
		"only whitespace":   {200, `{"segments":[{"start":0,"end":1,"text":"  "}]}`, transcribe.ErrEmpty},
	}
	for name, c := range cases {
		p := &transcribe.OpenAI{BaseURL: server(t, c.status, c.body, nil).URL, APIKey: "k", Model: "m"}
		if _, err := p.Transcribe(ctx, "a.mp3", "audio/mpeg", strings.NewReader("x")); !errors.Is(err, c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// 401 is our configuration problem, not a property of the file: it is not one of the classified errors.
	p := &transcribe.OpenAI{BaseURL: server(t, 401, `{}`, nil).URL, APIKey: "bad", Model: "m"}
	_, err := p.Transcribe(ctx, "a.mp3", "audio/mpeg", strings.NewReader("x"))
	if err == nil || errors.Is(err, transcribe.ErrUnsupported) || errors.Is(err, transcribe.ErrUnavailable) {
		t.Errorf("401: %v", err)
	}
	// A plain block of text with no segments still works.
	p = &transcribe.OpenAI{BaseURL: server(t, 200, `{"text":"just words","duration":4}`, nil).URL, APIKey: "k", Model: "m"}
	if res, err := p.Transcribe(ctx, "a.mp3", "audio/mpeg", strings.NewReader("x")); err != nil || res.Segments[0].Text != "just words" {
		t.Errorf("%v %+v", err, res)
	}
}

func TestOversizeFilesNeverLeaveTheMachineAndErrorsHideVendorText(t *testing.T) {
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer srv.Close()
	p := &transcribe.OpenAI{BaseURL: srv.URL, APIKey: "k", Model: "m", Max: 10}
	if _, err := p.Transcribe(ctx, "big.mp3", "audio/mpeg", strings.NewReader(strings.Repeat("x", 11))); !errors.Is(err, transcribe.ErrTooLarge) {
		t.Fatalf("%v", err)
	}
	if hit {
		t.Error("an oversize file was sent to the vendor")
	}
	// A dead server gives a classified, text-free error.
	dead := httptest.NewServer(nil)
	url := dead.URL
	dead.Close()
	_, err := (&transcribe.OpenAI{BaseURL: url, APIKey: "secret-key", Model: "m"}).Transcribe(ctx, "a.mp3", "audio/mpeg", strings.NewReader("x"))
	if !errors.Is(err, transcribe.ErrUnavailable) || strings.Contains(err.Error(), "secret-key") || strings.Contains(err.Error(), url) {
		t.Errorf("%v", err)
	}
}

// ---- AssemblyAI ----

type aaiStandIn struct {
	srv        *httptest.Server
	mu         sync.Mutex
	uploaded   int
	polls      int
	deleted    []string
	submitted  map[string]any
	auth       []string
	result     string // the completed transcript JSON, or "" for the default
	failWith   string // an error message to report instead of completing
	pending    int    // how many polls say "processing" first
	submitCode int
}

func newAAI(t *testing.T) *aaiStandIn {
	s := &aaiStandIn{pending: 2}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v2/upload", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.auth = append(s.auth, r.Header.Get("Authorization"))
		s.uploaded++
		s.mu.Unlock()
		n, _ := io.Copy(io.Discard, r.Body)
		_, _ = fmt.Fprintf(w, `{"upload_url":"https://cdn.example/upload/%d"}`, n)
	})
	mux.HandleFunc("POST /v2/transcript", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.auth = append(s.auth, r.Header.Get("Authorization"))
		_ = json.NewDecoder(r.Body).Decode(&s.submitted)
		if s.submitCode != 0 {
			w.WriteHeader(s.submitCode)
			return
		}
		_, _ = w.Write([]byte(`{"id":"tr-1","status":"queued"}`))
	})
	mux.HandleFunc("GET /v2/transcript/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.polls++
		switch {
		case s.polls <= s.pending:
			_, _ = w.Write([]byte(`{"id":"tr-1","status":"processing"}`))
		case s.failWith != "":
			_, _ = fmt.Fprintf(w, `{"id":"tr-1","status":"error","error":%q}`, s.failWith)
		case s.result != "":
			_, _ = w.Write([]byte(s.result))
		default:
			_, _ = w.Write([]byte(`{"id":"tr-1","status":"completed","audio_duration":12.5,"speech_model_used":"universal-3-5-pro","text":"Hello. We need single sign-on.","utterances":[{"speaker":"A","start":500,"end":2000,"text":"Hello thanks for joining."},{"speaker":"B","start":2100,"end":6000,"text":"We need single sign-on."}]}`))
		}
	})
	mux.HandleFunc("DELETE /v2/transcript/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.deleted = append(s.deleted, r.PathValue("id"))
		s.mu.Unlock()
		_, _ = w.Write([]byte(`{"id":"tr-1","status":"completed"}`))
	})
	s.srv = httptest.NewServer(mux)
	t.Cleanup(s.srv.Close)
	return s
}

func (s *aaiStandIn) provider() *transcribe.AssemblyAI {
	return &transcribe.AssemblyAI{BaseURL: s.srv.URL, APIKey: "aai-key", PollEvery: time.Millisecond, PollMax: 2 * time.Millisecond}
}

func TestAssemblyAIUploadsSubmitsWaitsAndForgets(t *testing.T) {
	s := newAAI(t)
	res, err := s.provider().Transcribe(context.Background(), "call.mp3", "audio/mpeg", strings.NewReader(strings.Repeat("x", 4096)))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Segments) != 2 || res.Segments[0].Speaker != "Speaker A" || res.Segments[1].Speaker != "Speaker B" || res.Segments[1].Text != "We need single sign-on." || res.Segments[1].StartMS != 2100 || res.DurationMS != 12500 || res.Model != "universal-3-5-pro" {
		t.Errorf("result %+v", res)
	}
	if s.uploaded != 1 || s.polls < 3 {
		t.Errorf("uploaded %d, polled %d", s.uploaded, s.polls)
	}
	// the key goes in the vendor's own header, on every call
	for _, a := range s.auth {
		if a != "aai-key" {
			t.Errorf("authorization %q", a)
		}
	}
	// the request names the models (the vendor's new array form), asks for speakers, and points at the upload
	models, _ := s.submitted["speech_models"].([]any)
	if len(models) != 2 || models[0] != "universal-3-5-pro" || models[1] != "universal-2" || s.submitted["speaker_labels"] != true || s.submitted["audio_url"] != "https://cdn.example/upload/4096" {
		t.Errorf("submitted %v", s.submitted)
	}
	if _, old := s.submitted["speech_model"]; old {
		t.Error("the retired singular speech_model field was sent")
	}
	// the vendor's copy is deleted
	if len(s.deleted) != 1 || s.deleted[0] != "tr-1" {
		t.Errorf("deleted %v", s.deleted)
	}
	// a configured preference replaces the default
	p := s.provider()
	p.Models = []string{"universal-2"}
	s.polls, s.pending = 0, 0
	if _, err := p.Transcribe(context.Background(), "a.mp3", "audio/mpeg", strings.NewReader("x")); err != nil {
		t.Fatal(err)
	}
	if m, _ := s.submitted["speech_models"].([]any); len(m) != 1 || m[0] != "universal-2" {
		t.Errorf("models %v", s.submitted["speech_models"])
	}
}

func TestAssemblyAIFailuresAreSortedIntoWhatToDoNext(t *testing.T) {
	cases := map[string]struct {
		setup func(*aaiStandIn)
		want  error
	}{
		"no speech":          {func(s *aaiStandIn) { s.failWith = "Transcription failed. No spoken audio detected." }, transcribe.ErrEmpty},
		"not audio":          {func(s *aaiStandIn) { s.failWith = "File does not appear to contain audio. File type is text/plain." }, transcribe.ErrUnsupported},
		"a vendor hiccup":    {func(s *aaiStandIn) { s.failWith = "Internal server error" }, transcribe.ErrUnavailable},
		"rate limited":       {func(s *aaiStandIn) { s.submitCode = 429 }, transcribe.ErrUnavailable},
		"the vendor is down": {func(s *aaiStandIn) { s.submitCode = 503 }, transcribe.ErrUnavailable},
		"a refused file":     {func(s *aaiStandIn) { s.submitCode = 422 }, transcribe.ErrUnsupported},
		"too big for them":   {func(s *aaiStandIn) { s.submitCode = 413 }, transcribe.ErrTooLarge},
		"silent text":        {func(s *aaiStandIn) { s.result = `{"id":"tr-1","status":"completed","text":"  ","utterances":[]}` }, transcribe.ErrEmpty},
	}
	for name, c := range cases {
		s := newAAI(t)
		c.setup(s)
		_, err := s.provider().Transcribe(context.Background(), "a.mp3", "audio/mpeg", strings.NewReader("data"))
		if !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
	// an error after the transcript was created still deletes it at the vendor
	s := newAAI(t)
	s.failWith = "Internal server error"
	_, _ = s.provider().Transcribe(context.Background(), "a.mp3", "audio/mpeg", strings.NewReader("data"))
	if len(s.deleted) != 1 {
		t.Errorf("a failed transcript was not deleted: %v", s.deleted)
	}
	// a wrong key is a setup problem, not a retry
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(401) }))
	defer bad.Close()
	_, err := (&transcribe.AssemblyAI{BaseURL: bad.URL, APIKey: "x"}).Transcribe(context.Background(), "a.mp3", "audio/mpeg", strings.NewReader("data"))
	if err == nil || errors.Is(err, transcribe.ErrUnavailable) || errors.Is(err, transcribe.ErrUnsupported) {
		t.Errorf("a refused key: %v", err)
	}
}

func TestAssemblyAIRefusesFilesOverOurLimitWithoutSendingAll(t *testing.T) {
	s := newAAI(t)
	p := s.provider()
	p.Max = 1000
	if p.MaxBytes() != 1000 || (&transcribe.AssemblyAI{}).MaxBytes() != 1<<30 {
		t.Errorf("limits %d %d", p.MaxBytes(), (&transcribe.AssemblyAI{}).MaxBytes())
	}
	if _, err := p.Transcribe(context.Background(), "a.mp3", "audio/mpeg", strings.NewReader(strings.Repeat("x", 1001))); !errors.Is(err, transcribe.ErrTooLarge) {
		t.Errorf("over the limit: %v", err)
	}
	if _, err := p.Transcribe(context.Background(), "a.mp3", "audio/mpeg", strings.NewReader(strings.Repeat("x", 1000))); err != nil {
		t.Errorf("exactly the limit: %v", err)
	}
	// stopping the job stops the wait
	s2 := newAAI(t)
	s2.pending = 1 << 30
	p2 := s2.provider()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := p2.Transcribe(ctx, "a.mp3", "audio/mpeg", strings.NewReader("data")); !errors.Is(err, transcribe.ErrUnavailable) {
		t.Errorf("a cancelled wait: %v", err)
	}
	if len(s2.deleted) != 1 {
		t.Error("a cancelled transcript was not deleted at the vendor")
	}
}
