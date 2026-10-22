// Command aismoke sends one tiny prompt through every tier using the real
// providers configured by AI_CONFIG and the *_API_KEY env vars, and prints
// which provider answered, token counts and cost. It spends a few cents and
// is for humans: run it deliberately, never in CI.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"product/api/internal/ai"
	"product/api/internal/ai/langchain"
)

type printRecorder struct{}

func (printRecorder) Record(_ context.Context, e ai.Event) {
	status := "ok"
	if e.Err != nil {
		status = "error: " + e.Err.Error()
	}
	fmt.Printf("  attempt %s/%s  in=%d out=%d cached=%d  $%.6f  %s  %s\n",
		e.Provider, e.Model, e.Usage.InputTokens, e.Usage.OutputTokens, e.Usage.CachedInputTokens, e.CostUSD, e.Latency.Round(time.Millisecond), status)
}

func main() {
	path := os.Getenv("AI_CONFIG")
	if path == "" {
		path = "config/ai.json"
	}
	cfg, err := langchain.LoadConfig(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	r, warnings, err := langchain.NewRouter(ctx, cfg, os.Getenv, printRecorder{})
	for _, w := range warnings {
		fmt.Println("warning:", w)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	failed := false
	for _, tier := range []ai.Tier{ai.TierSmall, ai.TierMid, ai.TierLarge} {
		fmt.Println("tier", tier)
		resp, err := r.Complete(ctx, tier, ai.Request{
			Task: "smoke", PromptVersion: "smoke-1", MaxTokens: 20,
			Messages: []ai.Message{{Role: ai.RoleUser, Text: "Reply with the single word: pong"}},
		})
		if err != nil {
			fmt.Println("  FAILED:", err)
			failed = true
			continue
		}
		fmt.Printf("  answered by %s/%s: %q\n", resp.Provider, resp.Model, resp.Text)
	}
	if failed {
		os.Exit(1)
	}
}
