// Package transcribe turns a recording into timed, speaker-labelled text. The
// rest of the system sees only Provider and Result; OpenAI is the first
// implementation (any server speaking the same /audio/transcriptions protocol
// works, which is how tests run without a key).
package transcribe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	// ErrTooLarge means the vendor will not take a file this big. The caller
	// shows a plain message (compress the audio) and does not retry.
	ErrTooLarge = errors.New("transcribe: file is too large for the transcription service")
	// ErrUnsupported means the vendor cannot read this file; retrying will not help.
	ErrUnsupported = errors.New("transcribe: the transcription service cannot read this file")
	// ErrUnavailable is a temporary failure worth retrying.
	ErrUnavailable = errors.New("transcribe: the transcription service is unavailable")
	// ErrEmpty means the recording has no speech.
	ErrEmpty = errors.New("transcribe: no speech was found")
)

type Segment struct {
	StartMS, EndMS int
	Speaker        string
	Text           string
}

type Result struct {
	Segments   []Segment
	DurationMS int
	Model      string
}

type Provider interface {
	Name() string
	// MaxBytes is the largest file the vendor accepts.
	MaxBytes() int64
	Transcribe(ctx context.Context, filename, mimeType string, r io.Reader) (Result, error)
}

// OpenAI speaks the OpenAI audio transcription protocol.
type OpenAI struct {
	BaseURL string // e.g. https://api.openai.com/v1
	APIKey  string
	Model   string // e.g. whisper-1; a "diarize" model also returns speakers
	Max     int64  // 0 means 25 MB, the vendor's documented limit
	Client  *http.Client
}

const defaultMax = 25 << 20

func (o *OpenAI) Name() string { return "openai" }
func (o *OpenAI) MaxBytes() int64 {
	if o.Max > 0 {
		return o.Max
	}
	return defaultMax
}

func (o *OpenAI) Transcribe(ctx context.Context, filename, mimeType string, r io.Reader) (Result, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("model", o.Model)
	diarize := strings.Contains(o.Model, "diarize")
	if diarize {
		_ = mw.WriteField("response_format", "diarized_json")
		_ = mw.WriteField("chunking_strategy", "auto")
	} else {
		_ = mw.WriteField("response_format", "verbose_json")
		_ = mw.WriteField("timestamp_granularities[]", "segment")
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, safeName(filename)))
	h.Set("Content-Type", mimeType)
	fw, err := mw.CreatePart(h)
	if err != nil {
		return Result{}, err
	}
	n, err := io.Copy(fw, io.LimitReader(r, o.MaxBytes()+1))
	if err != nil {
		return Result{}, err
	}
	if n > o.MaxBytes() {
		return Result{}, ErrTooLarge
	}
	if err := mw.Close(); err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(o.BaseURL, "/")+"/audio/transcriptions", &body)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+o.APIKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	c := o.Client
	if c == nil {
		c = &http.Client{Timeout: 15 * time.Minute}
	}
	resp, err := c.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrUnavailable, errClass(err))
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	switch {
	case resp.StatusCode == http.StatusRequestEntityTooLarge:
		return Result{}, ErrTooLarge
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnsupportedMediaType || resp.StatusCode == http.StatusUnprocessableEntity:
		return Result{}, ErrUnsupported
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return Result{}, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	case resp.StatusCode != http.StatusOK:
		return Result{}, fmt.Errorf("transcribe: unexpected status %d", resp.StatusCode) // 401/403: a configuration problem, not the file
	}
	res, err := parse(raw)
	if err != nil {
		return Result{}, err
	}
	res.Model = o.Model
	return res, nil
}

// errClass keeps vendor error text (which can echo request details) out of messages.
func errClass(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "network"
}

func safeName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r < 0x20 || r == '"' || r == '\\' || r == '/' {
			continue
		}
		b.WriteRune(r)
	}
	if b.Len() == 0 {
		return "audio"
	}
	return b.String()
}

type wire struct {
	Duration float64 `json:"duration"`
	Text     string  `json:"text"`
	Segments []struct {
		Start   float64 `json:"start"`
		End     float64 `json:"end"`
		Text    string  `json:"text"`
		Speaker string  `json:"speaker"`
	} `json:"segments"`
}

const maxSegments = 20000

// parse reads a verbose_json or diarized_json body and cleans it: text is
// trimmed, empty segments dropped, times made monotonic and in range.
func parse(raw []byte) (Result, error) {
	var w wire
	if err := json.Unmarshal(raw, &w); err != nil {
		return Result{}, fmt.Errorf("%w: unreadable response", ErrUnavailable)
	}
	var res Result
	last := 0
	for _, s := range w.Segments {
		text := strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(s.Text, "\x00", ""), ""))
		if text == "" {
			continue
		}
		start, end := ms(s.Start), ms(s.End)
		if start < last {
			start = last
		}
		if end < start {
			end = start
		}
		last = start
		speaker := strings.TrimSpace(s.Speaker)
		if utf8.RuneCountInString(speaker) > 40 {
			speaker = string([]rune(speaker)[:40])
		}
		res.Segments = append(res.Segments, Segment{StartMS: start, EndMS: end, Speaker: speaker, Text: text})
		if len(res.Segments) > maxSegments {
			return Result{}, fmt.Errorf("%w: too many segments", ErrUnsupported)
		}
	}
	if len(res.Segments) == 0 {
		// Some servers return only a single block of text.
		if t := strings.TrimSpace(w.Text); t != "" {
			res.Segments = []Segment{{StartMS: 0, EndMS: ms(w.Duration), Text: t}}
		} else {
			return Result{}, ErrEmpty
		}
	}
	res.DurationMS = ms(w.Duration)
	if end := res.Segments[len(res.Segments)-1].EndMS; end > res.DurationMS {
		res.DurationMS = end
	}
	return res, nil
}

func ms(sec float64) int {
	if sec < 0 || sec != sec {
		return 0
	}
	if sec > 24*3600 {
		sec = 24 * 3600
	}
	return int(sec*1000 + 0.5)
}
