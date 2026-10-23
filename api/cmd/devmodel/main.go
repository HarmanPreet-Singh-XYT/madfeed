// Command devmodel is a LOCAL DEVELOPMENT stand-in for an AI provider. It
// speaks just enough of the OpenAI chat protocol for the real adapter, router
// and answer validation to run in browser tests without a key, a network or
// any cost. It only knows how to answer the Q&A prompt, using the passages it
// is given, and says "not answerable" when the question shares no words with
// any passage.
//
//	go run ./cmd/devmodel                      # listens on 127.0.0.1:9997
//	OPENAI_BASE_URL=http://127.0.0.1:9997/v1 OPENAI_API_KEY=dev  AI_CONFIG=config/ai.dev.json ...
//
// It never reads or sends anything outside this machine.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"
)

const addr = "127.0.0.1:9997"

var passageRe = regexp.MustCompile(`(?m)^\[(\d+)\] "(.*)"$`)
var questionRe = regexp.MustCompile(`(?m)^Question: (.*)$`)
var wordRe = regexp.MustCompile(`[a-z0-9]{4,}`)

func words(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range wordRe.FindAllString(strings.ToLower(s), -1) {
		out[w] = true
	}
	return out
}

func answer(prompt string) map[string]any {
	q := questionRe.FindStringSubmatch(prompt)
	if q == nil {
		return map[string]any{"answerable": false, "answer": "", "reason": "No question was found."}
	}
	qw := words(q[1])
	var cited []string
	for _, m := range passageRe.FindAllStringSubmatch(prompt, -1) {
		for w := range words(m[2]) {
			if qw[w] {
				cited = append(cited, m[1])
				break
			}
		}
	}
	if len(cited) == 0 {
		return map[string]any{"answerable": false, "answer": "", "reason": "None of the passages talk about that."}
	}
	if len(cited) > 3 {
		cited = cited[:3]
	}
	text := "Customers raised this in their own words [" + cited[0] + "]."
	if len(cited) > 1 {
		text += " Others said something similar [" + strings.Join(cited[1:], "][") + "]."
	}
	return map[string]any{"answerable": true, "answer": text, "reason": ""}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"dev-model","object":"model"}]}`))
	})
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		prompt := ""
		for _, m := range req.Messages {
			if m.Role == "user" || m.Role == "human" {
				prompt = m.Content
			}
		}
		raw, _ := json.Marshal(answer(prompt))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "dev", "object": "chat.completion", "model": "dev-model",
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": string(raw)}}},
			"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130},
		})
	})
	log.Printf("devmodel listening on %s (local development only)", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
