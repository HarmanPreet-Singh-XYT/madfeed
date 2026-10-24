package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/insights"
	"product/api/internal/store"
)

// 200 synthetic quotes whose feeling is known by construction (a feeling phrase about a topic), used to run the
// WHOLE path at the size the gate asks for: a person's labels, the real model through the real worker, and the
// agreement the Quotes screen shows. The "person" here is the test itself, so this proves the machinery, not
// that the model agrees with a real person about real customers.
var feelingTopics = []string{"the export", "single sign-on", "the weekly digest", "the import wizard", "customer support", "the roadmap page", "the mobile layout", "the search", "billing", "the Slack connection"}

var feelingPhrases = map[string][]string{
	"positive": {"I really love %s, it works beautifully.", "%s is excellent and saved us hours.", "Thank you for %s, it is exactly what we needed.", "Honestly impressed by %s.", "%s made my week, it is wonderful."},
	"negative": {"I am frustrated that %s keeps failing.", "%s is broken again and it is unacceptable.", "I hate how confusing %s is.", "%s is a blocker and we may leave because of it.", "Very disappointed with %s, it never works."},
	"neutral":  {"Can you tell me how %s is configured?", "We need %s to run on Mondays.", "Is there documentation for %s?", "Please add a setting for %s.", "Our team reviews %s on Tuesdays."},
	"mixed":    {"I like %s, but it is far too slow.", "%s is great, although the setup was painful.", "Love the idea of %s, hate how it looks on a phone.", "%s works well, yet it is still confusing.", "Support for %s was friendly but took days."},
}

func sentimentPipeline(ctx context.Context, admin, app *pgxpool.Pool, model completer) (metrics, error) {
	ws, user := uuid.New(), uuid.New()
	if _, err := admin.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1, 'sentimenteval')`, ws); err != nil {
		return nil, err
	}
	if _, err := admin.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, ws, user); err != nil {
		return nil, err
	}
	defer func() { _, _ = admin.Exec(ctx, `DELETE FROM workspace WHERE id=$1`, ws) }()
	t := store.Tenant{WorkspaceID: ws, UserID: user, Role: store.RoleAdmin}
	var req uuid.UUID
	if err := admin.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'Eval') RETURNING id`, ws).Scan(&req); err != nil {
		return nil, err
	}
	type q struct {
		id    uuid.UUID
		label string
	}
	var quotes []q
	n := 0
	for _, label := range []string{"positive", "negative", "neutral", "mixed"} {
		for pi, ph := range feelingPhrases[label] {
			for ti := 0; ti < 10; ti++ {
				text := fmt.Sprintf(ph, feelingTopics[(ti+pi)%len(feelingTopics)])
				text = strings.ToUpper(text[:1]) + text[1:]
				var src, chunk, ev uuid.UUID
				if err := admin.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, created_by) VALUES ($1,'paste','eval',$2,$3,$4) RETURNING id`, ws, text, uuid.NewString(), user).Scan(&src); err != nil {
					return nil, err
				}
				if err := admin.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(text), text).Scan(&chunk); err != nil {
					return nil, err
				}
				if err := admin.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,0,$6,$7) RETURNING id`, ws, req, src, chunk, text, len(text), user).Scan(&ev); err != nil {
					return nil, err
				}
				quotes = append(quotes, q{ev, label})
				n++
			}
		}
	}
	svc := &insights.Service{Pool: app}
	// the "person": labels each quote through the same service the Quotes screen uses
	for _, x := range quotes {
		if err := svc.Label(ctx, t, "evidence", x.id, x.label); err != nil {
			return nil, err
		}
	}
	// the model: the real worker, in the same batches and with the same checks, until nothing is left
	w := &insights.SentimentWorker{Pool: app, Completer: model}
	for round := 0; round < 5; round++ {
		pending, err := svc.Pending(ctx, t)
		if err != nil {
			return nil, err
		}
		if pending == 0 {
			break
		}
		if err := w.Work(ctx, &river.Job[insights.SentimentArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: insights.SentimentArgs{WorkspaceID: ws, UserID: user, Max: insights.MaxPerJob}}); err != nil {
			return nil, err
		}
	}
	a, err := svc.Agreement(ctx, t)
	if err != nil {
		return nil, err
	}
	fmt.Printf("  %d quotes labelled by the person, %d compared, agreement %s, enough=%v, meets target=%v\n", a.HumanLabelled, a.Compared, a, a.Enough, a.MeetsTarget)
	for _, p := range a.Pairs {
		if p.Human != p.Model {
			fmt.Printf("  person %-8s model %-8s  x%d\n", p.Human, p.Model, p.N)
		}
	}
	return metrics{"agreement": a.Accuracy, "compared": float64(a.Compared) / 200}, nil
}
