package embed_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"product/api/internal/embed"
)

func fake(t *testing.T, dim int, status int, mutate func(map[string]any)) (*httptest.Server, *map[string]any) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer k" || r.URL.Path != "/embeddings" {
			w.WriteHeader(401)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		if status != 0 {
			w.WriteHeader(status)
			return
		}
		in := got["input"].([]any)
		data := make([]map[string]any, len(in))
		for i := range in {
			v := make([]float32, dim)
			v[i%dim] = 1
			data[len(in)-1-i] = map[string]any{"index": i, "embedding": v} // out of order on purpose
		}
		out := map[string]any{"data": data, "usage": map[string]any{"total_tokens": 7 * len(in)}}
		if mutate != nil {
			mutate(out)
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func TestOpenAIEmbedsInOrderAndReportsUse(t *testing.T) {
	srv, got := fake(t, 8, 0, nil)
	e := &embed.OpenAI{BaseURL: srv.URL, APIKey: "k", Dimensions: 8}
	vecs, use, err := e.Embed(context.Background(), []string{"one", "two", "three"})
	if err != nil {
		t.Fatal(err)
	}
	if len(vecs) != 3 || vecs[0][0] != 1 || vecs[1][1] != 1 || vecs[2][2] != 1 || use.Tokens != 21 {
		t.Errorf("vecs %v use %+v", vecs, use)
	}
	if (*got)["model"] != "text-embedding-3-small" || (*got)["dimensions"].(float64) != 8 || (*got)["encoding_format"] != "float" {
		t.Errorf("request %v", *got)
	}
	if e.Name() != "openai" || e.Model() != "text-embedding-3-small" || (&embed.OpenAI{}).Dim() != 512 {
		t.Error("defaults")
	}
}

func TestOpenAICleansWhatItSends(t *testing.T) {
	srv, got := fake(t, 4, 0, nil)
	e := &embed.OpenAI{BaseURL: srv.URL, APIKey: "k", Dimensions: 4}
	long := strings.Repeat("é", embed.MaxChars+500)
	if _, _, err := e.Embed(context.Background(), []string{"", "a\x00b\xff", long}); err != nil {
		t.Fatal(err)
	}
	in := (*got)["input"].([]any)
	if in[0] != " " || in[1] != "ab" || len([]rune(in[2].(string))) != embed.MaxChars {
		t.Errorf("sent %q %q %d", in[0], in[1], len([]rune(in[2].(string))))
	}
	if _, _, err := e.Embed(context.Background(), make([]string, embed.MaxBatch+1)); err == nil {
		t.Error("an oversize batch was sent")
	}
	if v, _, err := e.Embed(context.Background(), nil); err != nil || v != nil {
		t.Errorf("nothing to embed: %v %v", v, err)
	}
}

func TestOpenAIFailuresSaySoAndBadVectorsAreRefused(t *testing.T) {
	for status, want := range map[int]error{429: embed.ErrUnavailable, 503: embed.ErrUnavailable, 400: embed.ErrRefused, 422: embed.ErrRefused} {
		srv, _ := fake(t, 4, status, nil)
		_, _, err := (&embed.OpenAI{BaseURL: srv.URL, APIKey: "k", Dimensions: 4}).Embed(context.Background(), []string{"x"})
		if !errors.Is(err, want) {
			t.Errorf("%d: %v", status, err)
		}
	}
	srv, _ := fake(t, 4, 0, nil)
	_, _, err := (&embed.OpenAI{BaseURL: srv.URL, APIKey: "wrong", Dimensions: 4}).Embed(context.Background(), []string{"x"})
	if err == nil || errors.Is(err, embed.ErrUnavailable) || errors.Is(err, embed.ErrRefused) {
		t.Errorf("a wrong key: %v", err)
	}
	// the wrong length, a missing vector, a repeated index
	for name, mut := range map[string]func(map[string]any){
		"wrong length": func(o map[string]any) { o["data"].([]map[string]any)[0]["embedding"] = []float32{1, 2} },
		"missing":      func(o map[string]any) { o["data"] = o["data"].([]map[string]any)[:1] },
		"repeated": func(o map[string]any) {
			o["data"].([]map[string]any)[1]["index"] = o["data"].([]map[string]any)[0]["index"]
		},
	} {
		srv, _ := fake(t, 4, 0, mut)
		if _, _, err := (&embed.OpenAI{BaseURL: srv.URL, APIKey: "k", Dimensions: 4}).Embed(context.Background(), []string{"a", "b"}); !errors.Is(err, embed.ErrUnavailable) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, _, err := (&embed.OpenAI{BaseURL: "http://127.0.0.1:1", APIKey: "k"}).Embed(context.Background(), []string{"x"}); !errors.Is(err, embed.ErrUnavailable) {
		t.Errorf("a dead address: %v", err)
	}
}

func TestLiteralIsWhatPostgresReads(t *testing.T) {
	if got := embed.Literal([]float32{0.5, -1, 0, 1.25e-7}); got != "[0.5,-1,0,1.25e-07]" {
		t.Errorf("%s", got)
	}
}
