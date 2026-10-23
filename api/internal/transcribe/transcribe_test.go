package transcribe_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
