// Command qaeval measures grounded Q&A against a real model: a synthetic
// corpus of customer quotes and 100 questions (60 answerable, 20 with no
// evidence, 20 with a false premise). It writes only to the LOCAL development
// database, uses synthetic text only, and spends a few cents. Run it
// deliberately; never in CI.
//
//	EVAL_ADMIN_URL=postgres://app:...@127.0.0.1:54322/app EVAL_APP_URL=postgres://app_api:...@127.0.0.1:54322/app AI_CONFIG=... go run ./cmd/qaeval
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

	"product/api/internal/ai"
	"product/api/internal/ai/langchain"
	"product/api/internal/aievent"
	"product/api/internal/research"
	"product/api/internal/store"
)

type topic struct {
	name   string   // how questions refer to it
	quotes []string // what customers said
}

var topics = []topic{
	{"single sign-on", []string{"We cannot roll this out company-wide without single sign-on, our security team insists on Okta.", "Single sign-on is the one thing standing between us and a team-wide purchase.", "Our IT admin keeps asking whether you support SSO with our identity provider.", "Logging in with a separate password for every person is a deal breaker for our security review."}},
	{"exporting to CSV", []string{"Every Friday I copy the table into a spreadsheet by hand, a CSV export would save me an hour.", "There is no way to download our data as a CSV file, so reporting to my boss is manual.", "Please let us export the request list to CSV so finance can see it.", "Exporting is painful, I end up taking screenshots of the table."}},
	{"dark mode", []string{"Is there a dark mode? My eyes hurt when I use the app at night.", "We work late shifts and the bright white screen is really tiring, a dark theme would help.", "Would love a dark mode option, the white background glares on my monitor.", "Dark theme please, our whole team uses it in every other tool."}},
	{"the mobile layout", []string{"On my phone the right column of the reports page is cut off and I cannot scroll to it.", "The mobile layout is broken, buttons overlap on the settings page.", "I tried to approve something from my phone and the screen was unusable.", "The phone version cuts off half of the table, I have to switch to my laptop."}},
	{"report speed", []string{"The reports page takes almost a minute to load when we have a lot of data.", "Reports are painfully slow for our big workspace, I click and wait.", "Loading the quarterly report times out for us most mornings.", "Our largest team gives up on the reports page because it is so slow."}},
	{"a Slack integration", []string{"We live in Slack, can alerts post to our team channel automatically?", "A Slack integration would let our support leads see new requests without opening another tab.", "Please add Slack notifications, email gets buried.", "The one thing we need is for new feedback to show up in our Slack channel."}},
	{"read-only access", []string{"We cannot give contractors read only access, it is all or nothing and that is a blocker.", "Our auditors need to look at things but must not be able to change anything, we need a viewer role.", "Please add a read-only permission level for external partners.", "Right now every guest can edit, which makes us nervous about inviting clients."}},
	{"importing large files", []string{"We tried importing a file with forty thousand rows and it just spins forever.", "The import chokes on big spreadsheets, we had to split ours into ten pieces.", "Importing our customer list failed halfway and gave no error message.", "Large CSV imports never finish for us, the progress bar sticks at the start."}},
	{"duplicate requests", []string{"We keep ending up with five copies of the same request and have to merge them by hand.", "It would help if the tool noticed that two requests are really the same ask.", "Duplicates are cluttering our backlog, can similar requests be grouped automatically?", "Half of my morning goes to cleaning up requests that say the same thing in different words."}},
	{"email notifications", []string{"I get an email every time anyone comments and there is no way to turn it down.", "Too many notification emails, let me choose a daily digest instead.", "Please let us control which events send us an email, my inbox is flooded.", "The notification settings are all or nothing, I just want mentions."}},
}

// Nothing in the corpus says anything about these.
var absent = []string{
	"API rate limits", "a SOC 2 report", "German language support", "PDF invoices", "calendar sync", "offline mode",
	"keyboard shortcuts", "an audit log", "webhooks", "SCIM user provisioning", "two-factor authentication", "custom domains",
	"video recording", "a public roadmap", "a voice assistant", "single-tenant hosting", "data residency in Europe", "a browser extension",
	"bulk delete", "custom fields",
}

type q struct {
	kind  string // answerable, absent, trap
	text  string
	topic int // index for answerable and trap
}

func questions() []q {
	var out []q
	phr := []string{"What do customers say about %s?", "What are customers asking for around %s?", "What frustrations do customers have with %s?", "Summarize the feedback on %s.", "What did customers tell us regarding %s?", "How do customers describe their problems with %s?"}
	for i, t := range topics {
		for _, p := range phr {
			out = append(out, q{"answerable", fmt.Sprintf(p, t.name), i})
		}
	}
	for _, a := range absent {
		out = append(out, q{"absent", fmt.Sprintf("What do customers say about %s?", a), -1})
	}
	for i, t := range topics {
		out = append(out, q{"trap", fmt.Sprintf("Why did customers say %s was too expensive?", t.name), i})
		out = append(out, q{"trap", fmt.Sprintf("Which competitor did customers say does %s better than us?", t.name), i})
	}
	return out
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func main() {
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, os.Getenv("EVAL_ADMIN_URL"))
	must(err)
	app, err := pgxpool.New(ctx, os.Getenv("EVAL_APP_URL"))
	must(err)
	for _, u := range []string{os.Getenv("EVAL_ADMIN_URL"), os.Getenv("EVAL_APP_URL")} {
		if !strings.Contains(u, "127.0.0.1") && !strings.Contains(u, "localhost") {
			must(errors.New("qaeval only runs against a local database"))
		}
	}

	ws, user := uuid.New(), uuid.New()
	_, err = admin.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1, 'qaeval')`, ws)
	must(err)
	_, err = admin.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, ws, user)
	must(err)
	defer func() { _, _ = admin.Exec(ctx, `DELETE FROM workspace WHERE id=$1`, ws) }()
	var req uuid.UUID
	must(admin.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'eval') RETURNING id`, ws).Scan(&req))
	owner := map[uuid.UUID]int{} // evidence id -> topic
	for ti, t := range topics {
		for _, quote := range t.quotes {
			var src, ev uuid.UUID
			must(admin.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, quote, uuid.NewString(), user).Scan(&src))
			_, err = admin.Exec(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4)`, ws, src, len(quote), quote)
			must(err)
			must(admin.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by)
				SELECT $1,$2,$3,id,$4,0,$5,$6 FROM chunk WHERE source_item_id=$3 RETURNING id`, ws, req, src, quote, len(quote), user).Scan(&ev))
			owner[ev] = ti
		}
	}

	cfg, err := langchain.LoadConfig(os.Getenv("AI_CONFIG"))
	must(err)
	router, _, err := langchain.NewRouter(ctx, cfg, os.Getenv, &aievent.Recorder{Pool: app})
	must(err)
	svc := &research.Service{Pool: app}
	qa := &research.QA{Pool: svc, Completer: router, DailyLimit: 10000}
	t := store.Tenant{WorkspaceID: ws, UserID: user, Role: store.RoleAdmin}

	type tally struct{ n, answered, refused, onTopic, mixed, rejected, errs int }
	res := map[string]*tally{"answerable": {}, "absent": {}, "trap": {}}
	var notes []string
	started := time.Now()
	for _, qu := range questions() {
		r := res[qu.kind]
		r.n++
		a, err := qa.Ask(ctx, t, qu.text)
		switch {
		case errors.Is(err, ai.ErrInvalidOutput):
			r.rejected++
			notes = append(notes, fmt.Sprintf("REJECTED   %-10s %s", qu.kind, qu.text))
			continue
		case err != nil:
			r.errs++
			notes = append(notes, fmt.Sprintf("ERROR      %-10s %s: %v", qu.kind, qu.text, err))
			continue
		}
		if a.Outcome == "no_evidence" {
			r.refused++
			if qu.kind == "answerable" {
				notes = append(notes, fmt.Sprintf("MISSED     answerable %s -> %s", qu.text, a.Reason))
			}
			continue
		}
		r.answered++
		inTopic, outside := 0, 0
		for _, c := range a.Citations {
			if qu.topic >= 0 && owner[c.ID] == qu.topic {
				inTopic++
			} else {
				outside++
			}
		}
		if outside == 0 && inTopic > 0 {
			r.onTopic++
		} else {
			r.mixed++
		}
		if qu.kind != "answerable" {
			notes = append(notes, fmt.Sprintf("ANSWERED   %-10s %s -> %s", qu.kind, qu.text, a.Text))
		} else if outside > 0 {
			notes = append(notes, fmt.Sprintf("OFF-TOPIC  answerable %s -> %s (%d in topic, %d outside)", qu.text, a.Text, inTopic, outside))
		}
	}
	for _, k := range []string{"answerable", "absent", "trap"} {
		r := res[k]
		fmt.Printf("%-10s n=%-3d answered=%-3d refused=%-3d citations-all-on-topic=%-3d mixed=%-3d rejected-by-validator=%-3d errors=%d\n", k, r.n, r.answered, r.refused, r.onTopic, r.mixed, r.rejected, r.errs)
	}
	var cost float64
	_ = admin.QueryRow(ctx, `SELECT coalesce(sum(cost_usd),0) FROM ai_event WHERE workspace_id=$1`, ws).Scan(&cost)
	fmt.Printf("elapsed %s, cost $%.4f\n\n", time.Since(started).Round(time.Second), cost)
	for _, n := range notes {
		fmt.Println(n)
	}
	// One of each, for reading.
	if a, err := qa.Ask(ctx, t, "Why do people want single sign-on?"); err == nil {
		fmt.Printf("\nSAMPLE: %s\n", a.Text)
		for _, c := range a.Citations {
			fmt.Printf("  [%d] %s\n", c.Number, c.Quote)
		}
	}
}
