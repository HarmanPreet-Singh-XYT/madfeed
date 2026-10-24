// Package embed turns short texts into vectors so that things that mean the same can be found even when they
// share no words. The rest of the system sees only Embedder; OpenAI is the first implementation (any server
// speaking the same /embeddings protocol works, which is how tests run without a key).
package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	// ErrUnavailable is a temporary failure worth retrying (rate limit, outage, network).
	ErrUnavailable = errors.New("embed: the embedding service is unavailable")
	// ErrRefused means the service rejected the request itself; retrying the same thing will not help.
	ErrRefused = errors.New("embed: the embedding service refused the request")
)

// Usage is what one call cost, for the AI event log.
type Usage struct{ Tokens int }

type Embedder interface {
	Name() string
	// Model is recorded with every stored vector: vectors from different models are never compared.
	Model() string
	// Dim is the length of every vector this embedder returns.
	Dim() int
	// Embed returns one vector per text, in order. Callers send at most MaxBatch texts.
	Embed(ctx context.Context, texts []string) ([][]float32, Usage, error)
}

const (
	MaxBatch = 96
	// MaxChars is where a text is cut before it is sent: quotes and request titles are short, and a runaway
	// text must not turn one call into a large bill.
	MaxChars = 6000
)

// OpenAI speaks the OpenAI embeddings protocol.
type OpenAI struct {
	BaseURL    string // e.g. https://api.openai.com/v1
	APIKey     string
	ModelName  string // default text-embedding-3-small
	Dimensions int    // default 512 (the 3-series models can return shorter vectors with little loss)
	Client     *http.Client
}

func (o *OpenAI) Name() string { return "openai" }
func (o *OpenAI) Model() string {
	if o.ModelName != "" {
		return o.ModelName
	}
	return "text-embedding-3-small"
}
func (o *OpenAI) Dim() int {
	if o.Dimensions > 0 {
		return o.Dimensions
	}
	return 512
}

func (o *OpenAI) Embed(ctx context.Context, texts []string) ([][]float32, Usage, error) {
	if len(texts) == 0 {
		return nil, Usage{}, nil
	}
	if len(texts) > MaxBatch {
		return nil, Usage{}, fmt.Errorf("embed: at most %d texts per call", MaxBatch)
	}
	in := make([]string, len(texts))
	for i, t := range texts {
		t = strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(t, "\x00", ""), ""))
		if utf8.RuneCountInString(t) > MaxChars {
			t = string([]rune(t)[:MaxChars])
		}
		if t == "" {
			t = " " // the service refuses an empty string; a blank text simply sits far from everything
		}
		in[i] = t
	}
	body, _ := json.Marshal(map[string]any{"model": o.Model(), "input": in, "dimensions": o.Dim(), "encoding_format": "float"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(o.BaseURL, "/")+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, Usage{}, err
	}
	req.Header.Set("Authorization", "Bearer "+o.APIKey)
	req.Header.Set("Content-Type", "application/json")
	c := o.Client
	if c == nil {
		c = &http.Client{Timeout: 2 * time.Minute}
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, Usage{}, fmt.Errorf("%w: %v", ErrUnavailable, errClass(err))
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return nil, Usage{}, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnprocessableEntity:
		return nil, Usage{}, fmt.Errorf("%w: status %d", ErrRefused, resp.StatusCode)
	case resp.StatusCode != http.StatusOK:
		return nil, Usage{}, fmt.Errorf("embed: unexpected status %d", resp.StatusCode) // 401/403: a configuration problem
	}
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
		Usage struct {
			Total int `json:"total_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &out) != nil || len(out.Data) != len(texts) {
		return nil, Usage{}, fmt.Errorf("%w: unreadable answer", ErrUnavailable)
	}
	vecs := make([][]float32, len(texts))
	for _, d := range out.Data {
		if d.Index < 0 || d.Index >= len(vecs) || vecs[d.Index] != nil || len(d.Embedding) != o.Dim() {
			return nil, Usage{}, fmt.Errorf("%w: a vector had the wrong shape", ErrUnavailable)
		}
		for _, f := range d.Embedding {
			if math.IsNaN(float64(f)) || math.IsInf(float64(f), 0) {
				return nil, Usage{}, fmt.Errorf("%w: a vector had a bad number", ErrUnavailable)
			}
		}
		vecs[d.Index] = d.Embedding
	}
	return vecs, Usage{Tokens: out.Usage.Total}, nil
}

func errClass(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "network"
}

// Literal writes a vector the way Postgres' vector type reads it: [0.1,0.2,...].
func Literal(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 10)
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', 8, 32))
	}
	b.WriteByte(']')
	return b.String()
}
