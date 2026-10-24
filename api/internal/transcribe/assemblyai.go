package transcribe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// AssemblyAI speaks AssemblyAI's pre-recorded transcription API: upload the file, ask for a transcript, check
// until it is done. It asks for speaker labels, and afterwards deletes the transcript and the uploaded copy at
// the vendor, so customer audio is not left there.
type AssemblyAI struct {
	BaseURL string // https://api.assemblyai.com (or the EU address)
	APIKey  string
	Models  []string // preference order; empty means the vendor's current default list
	Max     int64    // 0 means 1 GiB
	Client  *http.Client
	// PollEvery is how often the finished-or-not check runs at first; it slows down to PollMax. Tests shorten it.
	PollEvery time.Duration
	PollMax   time.Duration
	// Timeout is the longest one recording may take from upload to transcript (default two hours).
	Timeout time.Duration
}

// DefaultAssemblyModels is the vendor's current preference list: the newest model, falling back to the previous.
var DefaultAssemblyModels = []string{"universal-3-5-pro", "universal-2"}

func (a *AssemblyAI) Name() string { return "assemblyai" }

func (a *AssemblyAI) MaxBytes() int64 {
	if a.Max > 0 {
		return a.Max
	}
	return 1 << 30
}

func (a *AssemblyAI) client() *http.Client {
	if a.Client != nil {
		return a.Client
	}
	return &http.Client{Timeout: 30 * time.Minute}
}

func (a *AssemblyAI) url(path string) string { return strings.TrimRight(a.BaseURL, "/") + path }

// do sends a request with the key, and turns the vendor's status codes into our errors.
func (a *AssemblyAI) do(ctx context.Context, method, path string, body io.Reader, contentType string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, a.url(path), body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", a.APIKey)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := a.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, errClass(err))
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	switch {
	case resp.StatusCode == http.StatusOK:
		return raw, nil
	case resp.StatusCode == http.StatusRequestEntityTooLarge:
		return nil, ErrTooLarge
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnsupportedMediaType || resp.StatusCode == http.StatusUnprocessableEntity:
		return nil, ErrUnsupported
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	return nil, fmt.Errorf("transcribe: unexpected status %d", resp.StatusCode) // 401/403: a configuration problem, not the file
}

type aaiTranscript struct {
	ID            string  `json:"id"`
	Status        string  `json:"status"`
	Error         string  `json:"error"`
	Text          string  `json:"text"`
	AudioDuration float64 `json:"audio_duration"`
	SpeechModel   string  `json:"speech_model_used"`
	Utterances    []struct {
		Speaker string `json:"speaker"`
		Start   int    `json:"start"`
		End     int    `json:"end"`
		Text    string `json:"text"`
	} `json:"utterances"`
	Words []struct {
		Start int `json:"start"`
		End   int `json:"end"`
	} `json:"words"`
}

func (a *AssemblyAI) Transcribe(ctx context.Context, filename, mimeType string, r io.Reader) (Result, error) {
	timeout := a.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Hour
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// 1. upload (the file is streamed, never held in memory), refusing anything over our limit
	limited := &limitedReader{r: r, left: a.MaxBytes()}
	raw, err := a.do(ctx, http.MethodPost, "/v2/upload", limited, "application/octet-stream")
	if limited.over {
		return Result{}, ErrTooLarge
	}
	if err != nil {
		return Result{}, err
	}
	var up struct {
		UploadURL string `json:"upload_url"`
	}
	if json.Unmarshal(raw, &up) != nil || up.UploadURL == "" {
		return Result{}, fmt.Errorf("%w: unreadable upload answer", ErrUnavailable)
	}

	// 2. ask for the transcript
	models := a.Models
	if len(models) == 0 {
		models = DefaultAssemblyModels
	}
	body, _ := json.Marshal(map[string]any{
		"audio_url": up.UploadURL, "speech_models": models,
		"speaker_labels": true, "punctuate": true, "format_text": true, "language_detection": true,
	})
	raw, err = a.do(ctx, http.MethodPost, "/v2/transcript", bytes.NewReader(body), "application/json")
	if err != nil {
		return Result{}, err
	}
	var t aaiTranscript
	if json.Unmarshal(raw, &t) != nil || t.ID == "" {
		return Result{}, fmt.Errorf("%w: unreadable transcript answer", ErrUnavailable)
	}
	// whatever happens next, the vendor's copy of the audio and text is deleted
	defer a.forget(t.ID)

	// 3. wait for it
	every, max := a.PollEvery, a.PollMax
	if every <= 0 {
		every = 3 * time.Second
	}
	if max <= 0 {
		max = 15 * time.Second
	}
	for t.Status != "completed" {
		if t.Status == "error" {
			return Result{}, classifyAAIError(t.Error)
		}
		select {
		case <-ctx.Done():
			return Result{}, fmt.Errorf("%w: timeout", ErrUnavailable)
		case <-time.After(every):
		}
		if every < max {
			every += every / 2
			if every > max {
				every = max
			}
		}
		raw, err = a.do(ctx, http.MethodGet, "/v2/transcript/"+t.ID, nil, "")
		if err != nil {
			return Result{}, err
		}
		id := t.ID
		t = aaiTranscript{}
		if json.Unmarshal(raw, &t) != nil {
			return Result{}, fmt.Errorf("%w: unreadable status answer", ErrUnavailable)
		}
		t.ID = id
	}
	return a.result(t, models)
}

func (a *AssemblyAI) result(t aaiTranscript, models []string) (Result, error) {
	var res Result
	last := 0
	for _, u := range t.Utterances {
		text := strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(u.Text, "\x00", ""), ""))
		if text == "" {
			continue
		}
		start, end := u.Start, u.End
		if start < last {
			start = last
		}
		if end < start {
			end = start
		}
		last = start
		speaker := ""
		if s := strings.TrimSpace(u.Speaker); s != "" {
			speaker = "Speaker " + s
			if utf8.RuneCountInString(speaker) > 40 {
				speaker = string([]rune(speaker)[:40])
			}
		}
		res.Segments = append(res.Segments, Segment{StartMS: start, EndMS: end, Speaker: speaker, Text: text})
		if len(res.Segments) > maxSegments {
			return Result{}, fmt.Errorf("%w: too many segments", ErrUnsupported)
		}
	}
	res.DurationMS = int(t.AudioDuration * 1000)
	if len(res.Segments) == 0 {
		text := strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(t.Text, "\x00", ""), ""))
		if text == "" {
			return Result{}, ErrEmpty
		}
		end := res.DurationMS
		if n := len(t.Words); n > 0 && t.Words[n-1].End > end {
			end = t.Words[n-1].End
		}
		res.Segments = []Segment{{StartMS: 0, EndMS: end, Text: text}}
	}
	if end := res.Segments[len(res.Segments)-1].EndMS; end > res.DurationMS {
		res.DurationMS = end
	}
	res.Model = t.SpeechModel
	if res.Model == "" {
		res.Model = models[0]
	}
	return res, nil
}

// forget deletes the transcript (and the uploaded file with it) at the vendor. It is best effort and never
// holds up the result; a failure leaves the vendor's own retention rules to apply.
func (a *AssemblyAI) forget(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = a.do(ctx, http.MethodDelete, "/v2/transcript/"+id, nil, "")
}

func classifyAAIError(msg string) error {
	m := strings.ToLower(msg)
	switch {
	case strings.Contains(m, "no spoken audio") || strings.Contains(m, "no speech"):
		return ErrEmpty
	case strings.Contains(m, "does not appear to contain audio") || strings.Contains(m, "unsupported") || strings.Contains(m, "file type") || strings.Contains(m, "invalid"):
		return ErrUnsupported
	}
	return fmt.Errorf("%w: the service could not finish", ErrUnavailable)
}

// limitedReader reads at most `left` bytes and notes if there was more.
type limitedReader struct {
	r    io.Reader
	left int64
	over bool
}

func (l *limitedReader) Read(p []byte) (int, error) {
	if l.left <= 0 {
		var one [1]byte
		if n, _ := l.r.Read(one[:]); n > 0 {
			l.over = true
			return 0, io.ErrUnexpectedEOF // more than allowed: stop the upload
		}
		return 0, io.EOF
	}
	if int64(len(p)) > l.left {
		p = p[:l.left]
	}
	n, err := l.r.Read(p)
	l.left -= int64(n)
	return n, err
}
