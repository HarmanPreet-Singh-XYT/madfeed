package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/ai"
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

func qaSuite(ctx context.Context, admin, app *pgxpool.Pool, model completer, _ bool) (metrics, error) {
	ws, user := uuid.New(), uuid.New()
	_, err := admin.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1, 'qaeval')`, ws)
	if err != nil {
		return nil, err
	}
	_, err = admin.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, ws, user)
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = admin.Exec(ctx, `DELETE FROM workspace WHERE id=$1`, ws) }()
	var req uuid.UUID
	if err := admin.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'eval') RETURNING id`, ws).Scan(&req); err != nil {
		return nil, err
	}
	owner := map[uuid.UUID]int{} // evidence id -> topic
	for ti, t := range topics {
		for _, quote := range t.quotes {
			var src, ev uuid.UUID
			if err := admin.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, quote, uuid.NewString(), user).Scan(&src); err != nil {
				return nil, err
			}
			_, err = admin.Exec(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4)`, ws, src, len(quote), quote)
			if err != nil {
				return nil, err
			}
			if err := admin.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by)
				SELECT $1,$2,$3,id,$4,0,$5,$6 FROM chunk WHERE source_item_id=$3 RETURNING id`, ws, req, src, quote, len(quote), user).Scan(&ev); err != nil {
				return nil, err
			}
			owner[ev] = ti
		}
	}

	svc := &research.Service{Pool: app}
	qa := &research.QA{Pool: svc, Completer: model, DailyLimit: 10000}
	t := store.Tenant{WorkspaceID: ws, UserID: user, Role: store.RoleAdmin}

	type tally struct{ n, answered, refused, onTopic, mixed, rejected, errs int }
	res := map[string]*tally{"answerable": {}, "absent": {}, "trap": {}}
	var notes []string
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
		fmt.Printf("%-10s n=%-3d answered=%-3d refused=%-3d on-topic=%-3d mixed=%-3d rejected=%-3d errors=%d\n", k, r.n, r.answered, r.refused, r.onTopic, r.mixed, r.rejected, r.errs)
	}
	for _, n := range notes {
		fmt.Println(n)
	}
	a, ab, tr := res["answerable"], res["absent"], res["trap"]
	return metrics{
		"answerable_answered":   ratio(a.answered, a.n),
		"answerable_on_topic":   ratio(a.onTopic, a.answered),
		"unanswerable_refused":  ratio(ab.refused, ab.n),
		"false_premise_refused": ratio(tr.refused+tr.rejected, tr.n),
	}, nil
}
