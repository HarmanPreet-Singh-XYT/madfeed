// Command eval measures the AI features against hand-labelled SYNTHETIC data
// with a real model, compares each metric with eval/thresholds.json, and exits
// non-zero if any falls short. Run it before changing a prompt or a model, and
// in a release candidate's gate. It writes only to the LOCAL development
// database and costs a few cents.
//
//	EVAL_ADMIN_URL=postgres://app:...@127.0.0.1:54322/app \
//	EVAL_APP_URL=postgres://app_api:...@127.0.0.1:54322/app \
//	AI_CONFIG=config/ai.json go run ./cmd/eval [-suite all|extraction|qa|suggestions] [-degrade]
//
// -degrade swaps the prompts for deliberately worse ones. The run must then
// FAIL; if it passes, the thresholds are too loose to protect anything.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/ai"
	"product/api/internal/ai/langchain"
	"product/api/internal/aievent"
	"product/api/internal/store"
)

type metrics map[string]float64

type thresholds map[string]map[string]float64

func main() {
	suite := flag.String("suite", "all", "all, extraction, qa or suggestions")
	degrade := flag.Bool("degrade", false, "use deliberately worse prompts; the run is expected to fail")
	tpath := flag.String("thresholds", "eval/thresholds.json", "thresholds file")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	raw, err := os.ReadFile(*tpath)
	must(err)
	var th thresholds
	must(json.Unmarshal(raw, &th))

	cfg, err := langchain.LoadConfig(os.Getenv("AI_CONFIG"))
	must(err)
	for _, u := range []string{os.Getenv("EVAL_ADMIN_URL"), os.Getenv("EVAL_APP_URL")} {
		if u != "" && !strings.Contains(u, "127.0.0.1") && !strings.Contains(u, "localhost") {
			must(errors.New("eval only runs against a local database"))
		}
	}
	var app, admin *pgxpool.Pool
	if os.Getenv("EVAL_APP_URL") != "" {
		app, err = pgxpool.New(ctx, os.Getenv("EVAL_APP_URL"))
		must(err)
		admin, err = pgxpool.New(ctx, os.Getenv("EVAL_ADMIN_URL"))
		must(err)
	}
	var rec ai.Recorder
	if app != nil {
		rec = quiet{&aievent.Recorder{Pool: app}}
	}
	router, _, err := langchain.NewRouter(ctx, cfg, os.Getenv, rec)
	must(err)
	var model completer = router
	if *degrade {
		model = worse{router}
		fmt.Println("DEGRADED RUN: prompts replaced with worse ones; failing is the expected outcome")
	}

	results := map[string]metrics{}
	run := func(name string, fn func() (metrics, error)) {
		if *suite != "all" && *suite != name {
			return
		}
		fmt.Printf("== %s\n", name)
		m, err := fn()
		must(err)
		results[name] = m
	}
	run("extraction", func() (metrics, error) { return extractionSuite(ctx, model) })
	if app != nil {
		run("qa", func() (metrics, error) { return qaSuite(ctx, admin, app, model, *degrade) })
		run("suggestions", func() (metrics, error) { return suggestionSuite(ctx, admin, app, model) })
	} else if *suite != "extraction" {
		fmt.Println("(qa and suggestions need EVAL_ADMIN_URL and EVAL_APP_URL: skipped)")
	}

	failed := report(results, th)
	if failed > 0 {
		fmt.Printf("\nFAILED: %d metric(s) below threshold\n", failed)
		os.Exit(1)
	}
	if len(results) == 0 {
		fmt.Println("nothing was measured")
		os.Exit(2)
	}
	fmt.Println("\nPASSED: every metric meets its threshold")
}

func report(results map[string]metrics, th thresholds) int {
	failed := 0
	var suites []string
	for s := range results {
		suites = append(suites, s)
	}
	sort.Strings(suites)
	fmt.Printf("\n%-14s %-24s %8s %10s\n", "suite", "metric", "value", "threshold")
	for _, s := range suites {
		var names []string
		for n := range results[s] {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			v, want := results[s][n], th[s][n]
			mark := "ok"
			if _, has := th[s][n]; has && v+1e-9 < want {
				mark, failed = "FAIL", failed+1
			}
			fmt.Printf("%-14s %-24s %8.2f %10.2f  %s\n", s, n, v, want, mark)
		}
	}
	return failed
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func ratio(a, b int) float64 {
	if b == 0 {
		return 1
	}
	return float64(a) / float64(b)
}

type completer interface {
	Complete(ctx context.Context, tier ai.Tier, req ai.Request) (ai.Response, error)
}

// worse stands in for a bad prompt change: it replaces each feature's system
// prompt with a careless one, keeping the schema and the data the same.
type worse struct{ inner completer }

func (w worse) Complete(ctx context.Context, tier ai.Tier, req ai.Request) (ai.Response, error) {
	switch req.Task {
	case "extraction":
		req.System = "Summarise any customer feedback you see. Put your own wording in the quote field; do not copy text."
	case "qa":
		req.System = "Answer helpfully from your own knowledge. Mark answerable true and put [1] at the end of each sentence."
	case "highlight_suggestions":
		req.System = "Pick any sentences you like and give them any tags. Rewrite them to be clearer."
	}
	return w.inner.Complete(ctx, tier, req)
}

// quiet records AI calls made for a workspace and ignores the rest (the
// extraction suite runs with no workspace at all).
type quiet struct{ inner ai.Recorder }

func (q quiet) Record(ctx context.Context, e ai.Event) {
	if _, ok := store.FromContext(ctx); ok {
		q.inner.Record(ctx, e)
	}
}
