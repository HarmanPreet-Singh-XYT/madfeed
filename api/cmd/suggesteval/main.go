// Command suggesteval measures highlight suggestions against a real model on
// three SYNTHETIC interviews with hand-labelled passages. It writes only to the
// LOCAL development database and spends a few cents. Run it deliberately; never in CI.
//
//	EVAL_ADMIN_URL=... EVAL_APP_URL=... AI_CONFIG=... go run ./cmd/suggesteval
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/ai/langchain"
	"product/api/internal/aievent"
	"product/api/internal/research"
	"product/api/internal/spans"
	"product/api/internal/store"
)

var tags = []struct{ name, def string }{
	{"Onboarding", "Anything about getting started, setup, first-run experience or learning the product"},
	{"Pricing", "Cost, plans, budgets, discounts or value for money"},
	{"Integrations", "Connecting to other tools, data sources or APIs"},
	{"Trust", "Security, privacy, reliability, compliance or confidence in the product"},
}

type gold struct{ quote, tag string }

var interviews = []struct {
	text string
	gold []gold
}{
	{"Interviewer: Thanks for making time. How did you get started?\nMaya: The setup took our team two days because the import wizard kept failing on our spreadsheet.\nInterviewer: What would have helped?\nMaya: A sample file and a checklist. Once we were through that, everything was fine.\nInterviewer: And budget?\nMaya: Honestly the price is steep for a team of five. We would pay half for the seats we actually use.\nInterviewer: Anything else?\nMaya: Not really. The weather has been great this week.",
		[]gold{{"The setup took our team two days because the import wizard kept failing on our spreadsheet.", "Onboarding"}, {"A sample file and a checklist.", "Onboarding"}, {"Honestly the price is steep for a team of five.", "Pricing"}}},
	{"Interviewer: Tell me about your stack.\nDev: We live in Slack and Jira, and the missing Jira sync is the biggest gap for us.\nInterviewer: Why?\nDev: Because we copy every request by hand. Also our security reviewer asked where the data is stored and whether you are SOC 2 certified.\nInterviewer: Did that block you?\nDev: Until we got an answer, yes. We cannot use a tool we cannot vouch for.\nInterviewer: Great. Lunch?\nDev: Sure, I know a place.",
		[]gold{{"the missing Jira sync is the biggest gap for us.", "Integrations"}, {"Because we copy every request by hand.", "Integrations"}, {"our security reviewer asked where the data is stored and whether you are SOC 2 certified.", "Trust"}, {"We cannot use a tool we cannot vouch for.", "Trust"}}},
	{"Interviewer: How is the plan working for you?\nSam: We got a discount in the first year, which was the only reason finance approved it.\nInterviewer: And next year?\nSam: If the renewal goes up by a third we will probably switch. Meanwhile the API export broke twice last month and nobody told us.\nInterviewer: How did that feel?\nSam: It made me nervous about relying on it for the board report.",
		[]gold{{"We got a discount in the first year, which was the only reason finance approved it.", "Pricing"}, {"If the renewal goes up by a third we will probably switch.", "Pricing"}, {"the API export broke twice last month and nobody told us.", "Trust"}, {"It made me nervous about relying on it for the board report.", "Trust"}}},
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func main() {
	ctx := context.Background()
	for _, u := range []string{os.Getenv("EVAL_ADMIN_URL"), os.Getenv("EVAL_APP_URL")} {
		if !strings.Contains(u, "127.0.0.1") && !strings.Contains(u, "localhost") {
			must(errors.New("suggesteval only runs against a local database"))
		}
	}
	admin, err := pgxpool.New(ctx, os.Getenv("EVAL_ADMIN_URL"))
	must(err)
	app, err := pgxpool.New(ctx, os.Getenv("EVAL_APP_URL"))
	must(err)
	ws, user := uuid.New(), uuid.New()
	_, err = admin.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1, 'suggesteval')`, ws)
	must(err)
	_, err = admin.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, ws, user)
	must(err)
	defer func() { _, _ = admin.Exec(ctx, `DELETE FROM workspace WHERE id=$1`, ws) }()
	t := store.Tenant{WorkspaceID: ws, UserID: user, Role: store.RoleAdmin}
	svc := &research.Service{Pool: app}
	for _, tg := range tags {
		_, err := svc.CreateTag(ctx, t, research.TagInput{Name: tg.name, Definition: tg.def})
		must(err)
	}
	cfg, err := langchain.LoadConfig(os.Getenv("AI_CONFIG"))
	must(err)
	router, _, err := langchain.NewRouter(ctx, cfg, os.Getenv, &aievent.Recorder{Pool: app})
	must(err)
	worker := &research.SuggestWorker{Pool: app, Completer: router}

	var shown, matched, tagRight, goldTotal, goldFound int
	var notes []string
	started := time.Now()
	for i, iv := range interviews {
		var src, chunk uuid.UUID
		must(admin.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, iv.text, uuid.NewString(), user).Scan(&src))
		must(admin.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(iv.text), iv.text).Scan(&chunk))
		must(worker.Work(ctx, &river.Job[research.SuggestArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: research.SuggestArgs{WorkspaceID: ws, SourceItemID: src, UserID: user}}))
		got, err := svc.ListSuggestions(ctx, t, src)
		must(err)
		goldTotal += len(iv.gold)
		hit := make([]bool, len(iv.gold))
		for _, s := range got {
			shown++
			if spans.Validate(iv.text, s.SpanStart, s.SpanEnd, s.Quote) != nil {
				notes = append(notes, fmt.Sprintf("NOT VERBATIM (interview %d): %q", i+1, s.Quote))
			}
			ok := false
			for gi, g := range iv.gold {
				// a suggestion matches a gold passage if they overlap by most of the shorter one
				gs := strings.Index(iv.text, g.quote)
				if gs < 0 {
					continue
				}
				lo, hi := max(gs, s.SpanStart), min(gs+len(g.quote), s.SpanEnd)
				short := min(len(g.quote), s.SpanEnd-s.SpanStart)
				if hi-lo >= short*6/10 {
					ok = true
					if !hit[gi] {
						hit[gi] = true
						goldFound++
					}
					right := false
					for _, tg := range s.Tags {
						if tg.Name == g.tag {
							right = true
						}
					}
					if right {
						tagRight++
					} else {
						notes = append(notes, fmt.Sprintf("WRONG TAG (interview %d): %q tagged %v, gold %s", i+1, s.Quote, names(s.Tags), g.tag))
					}
					break
				}
			}
			if ok {
				matched++
			} else {
				notes = append(notes, fmt.Sprintf("EXTRA (interview %d): %q %v", i+1, s.Quote, names(s.Tags)))
			}
		}
		for gi, g := range iv.gold {
			if !hit[gi] {
				notes = append(notes, fmt.Sprintf("MISSED (interview %d): %q [%s]", i+1, g.quote, g.tag))
			}
		}
	}
	var cost float64
	_ = admin.QueryRow(ctx, `SELECT coalesce(sum(cost_usd),0) FROM ai_event WHERE workspace_id=$1`, ws).Scan(&cost)
	pct := func(a, b int) string {
		if b == 0 {
			return "n/a"
		}
		return fmt.Sprintf("%d%%", a*100/b)
	}
	fmt.Printf("interviews=%d suggestions shown=%d (all verbatim: see NOT VERBATIM lines, if any)\n", len(interviews), shown)
	fmt.Printf("suggestions matching a hand-labelled passage: %d/%d = %s\n", matched, shown, pct(matched, shown))
	fmt.Printf("  ...with the right tag: %d/%d = %s\n", tagRight, matched, pct(tagRight, matched))
	fmt.Printf("hand-labelled passages found: %d/%d = %s\n", goldFound, goldTotal, pct(goldFound, goldTotal))
	fmt.Printf("elapsed %s, cost $%.4f\n\n", time.Since(started).Round(time.Second), cost)
	for _, n := range notes {
		fmt.Println(n)
	}
}

func names(ts []research.TagRef) []string {
	var out []string
	for _, t := range ts {
		out = append(out, t.Name)
	}
	return out
}
