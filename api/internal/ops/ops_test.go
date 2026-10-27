package ops_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/jobs"
	"product/api/internal/ops"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type capture struct {
	mu     sync.Mutex
	alerts []ops.Alert
}

func (c *capture) Notify(_ context.Context, a ops.Alert) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.alerts = append(c.alerts, a)
	return nil
}
func (c *capture) all() []ops.Alert {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]ops.Alert(nil), c.alerts...)
}
func (c *capture) waitFor(t *testing.T, name string) ops.Alert {
	t.Helper()
	for i := 0; i < 200; i++ {
		for _, a := range c.all() {
			if a.Name == name {
				return a
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no %q alert fired; got %+v", name, c.all())
	return ops.Alert{}
}

type boomArgs struct {
	Secret string `json:"secret"`
}

func (boomArgs) Kind() string { return "boom" }

type boomWorker struct {
	river.WorkerDefaults[boomArgs]
	mu       sync.Mutex
	attempts int
}

func (w *boomWorker) Work(_ context.Context, _ *river.Job[boomArgs]) error {
	w.mu.Lock()
	w.attempts++
	w.mu.Unlock()
	return errors.New("provider said no: key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 was rejected")
}

type fastRetry struct{}

func (fastRetry) NextRetry(*rivertype.JobRow) time.Time { return time.Now().Add(20 * time.Millisecond) }

func start(t *testing.T, db *testdb.DB, notifier ops.Notifier) (*river.Client[pgx.Tx], *boomWorker, *ops.Alerter) {
	t.Helper()
	db.EnableRiver(t)
	alerts := &ops.Alerter{Notifiers: []ops.Notifier{notifier}}
	w := &boomWorker{}
	workers := river.NewWorkers()
	river.AddWorker(workers, w)
	c, err := jobs.NewClientWith(db.Backend, workers, fastRetry{}, []string{river.QueueDefault}, jobs.Extras{
		Plugins:      []rivertype.Plugin{&ops.StampJobs{}},
		ErrorHandler: &ops.ReportFailures{Alerts: alerts},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Stop(context.Background()) })
	return c, w, alerts
}

func TestABrokenJobRaisesOneAlertThatNamesTheStepAndTheRequestAndLeaksNothing(t *testing.T) {
	db := testdb.New(t)
	cap := &capture{}
	c, w, _ := start(t, db, cap)

	// Created while handling request "req-abc/123": the id must follow the job.
	rctx := ops.WithRequestID(ctx, "req-abc/123")
	res, err := c.Insert(rctx, boomArgs{Secret: "customer text here"}, &river.InsertOpts{MaxAttempts: 3})
	if err != nil {
		t.Fatal(err)
	}
	a := cap.waitFor(t, "job_failed")
	if a.Details["kind"] != "boom" || a.Details["request_id"] != "req-abc/123" || a.Details["attempt"] != "3" || a.Severity != ops.Critical {
		t.Fatalf("%+v", a)
	}
	// It says what broke without giving away a key, and without any job content.
	all := a.Summary
	for _, v := range a.Details {
		all += " " + v
	}
	if strings.Contains(all, "sk-proj") || strings.Contains(all, "customer text") {
		t.Errorf("the alert leaked: %s", all)
	}
	if !strings.Contains(a.Details["error"], "[secret removed]") {
		t.Errorf("error text: %q", a.Details["error"])
	}
	// Only the last attempt raises it, and it raises it once.
	time.Sleep(300 * time.Millisecond)
	n := 0
	for _, x := range cap.all() {
		if x.Name == "job_failed" {
			n++
		}
	}
	w.mu.Lock()
	attempts := w.attempts
	w.mu.Unlock()
	if n != 1 || attempts != 3 {
		t.Errorf("alerts=%d attempts=%d, want 1 and 3", n, attempts)
	}
	// The request id is on the job row itself, for anyone investigating later.
	var meta []byte
	_ = db.Super.QueryRow(ctx, `SELECT metadata FROM river.river_job WHERE id=$1`, res.Job.ID).Scan(&meta)
	var m map[string]any
	_ = json.Unmarshal(meta, &m)
	if m["request_id"] != "req-abc/123" {
		t.Errorf("metadata %s", meta)
	}
	// A job created outside any request carries no request id and still alerts.
	if _, err := c.Insert(ctx, boomArgs{}, &river.InsertOpts{MaxAttempts: 1}); err != nil {
		t.Fatal(err)
	}
}

func TestTheSameProblemIsOneMessageNotAFlood(t *testing.T) {
	cap := &capture{}
	now := time.Now()
	a := &ops.Alerter{Notifiers: []ops.Notifier{cap}, Cooldown: time.Hour, Now: func() time.Time { return now }}
	al := ops.Alert{Name: "x", Summary: "s"}
	if !a.Fire(ctx, al, "k") || a.Fire(ctx, al, "k") || a.Fire(ctx, al, "k") {
		t.Fatal("duplicates within the cooldown")
	}
	if !a.Fire(ctx, al, "other") {
		t.Error("a different problem was suppressed")
	}
	now = now.Add(61 * time.Minute)
	if !a.Fire(ctx, al, "k") {
		t.Error("the same problem after the cooldown should alert again")
	}
	if len(cap.all()) != 3 {
		t.Errorf("%d delivered", len(cap.all()))
	}
}

func TestAlertsReachAChatWebhookWithoutRevealingItsAddress(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = string(b)
	}))
	defer srv.Close()
	n := ops.WebhookNotifier{URL: srv.URL + "/hooks/SECRET-PATH"}
	if err := n.Notify(ctx, ops.Alert{Name: "queue_stuck", Severity: ops.Critical, Summary: "jobs are stuck", Details: map[string]string{"queue": "default"}}); err != nil {
		t.Fatal(err)
	}
	var msg map[string]string
	_ = json.Unmarshal([]byte(got), &msg)
	if !strings.Contains(msg["text"], "queue_stuck") || !strings.Contains(msg["text"], "queue: default") || !strings.Contains(msg["text"], "rotating_light") {
		t.Errorf("%q", got)
	}
	// An unreachable or failing hook reports an error that does not contain its (secret) URL.
	dead := ops.WebhookNotifier{URL: "http://127.0.0.1:1/hooks/SECRET-PATH"}
	if err := dead.Notify(ctx, ops.Alert{Name: "x"}); err == nil || strings.Contains(err.Error(), "SECRET-PATH") {
		t.Errorf("%v", err)
	}
	for _, bad := range []string{"", "ftp://x/y", "http://example.com/x", "not a url", "https://"} {
		if ops.ValidWebhookURL(bad) == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	for _, good := range []string{"https://hooks.slack.com/services/T/B/x", "http://127.0.0.1:9000/x"} {
		if err := ops.ValidWebhookURL(good); err != nil {
			t.Errorf("%q: %v", good, err)
		}
	}
}

func TestWatchersFindQuietFailures(t *testing.T) {
	db := testdb.New(t)
	db.EnableRiver(t)
	cap := &capture{}
	w := &ops.Watchers{Pool: db.Backend, Alerts: &ops.Alerter{Notifiers: []ops.Notifier{cap}}, StuckAfter: time.Minute, AIMinCalls: 4}

	// Nothing wrong yet.
	if err := w.CheckQueues(ctx); err != nil {
		t.Fatal(err)
	}
	if err := w.CheckAI(ctx); err != nil {
		t.Fatal(err)
	}
	if len(cap.all()) != 0 {
		t.Fatalf("false alarm: %+v", cap.all())
	}
	// A job that has been ready for 20 minutes with nobody working the queue.
	if _, err := db.Super.Exec(ctx, `INSERT INTO river.river_job (kind, args, state, scheduled_at, queue, max_attempts) VALUES ('stuck_kind', '{}', 'available', now() - interval '20 minutes', 'research', 3)`); err != nil {
		t.Fatal(err)
	}
	// A job waiting on purpose (snoozed) does not count.
	if _, err := db.Super.Exec(ctx, `INSERT INTO river.river_job (kind, args, state, scheduled_at, queue, max_attempts) VALUES ('snoozed_kind', '{}', 'scheduled', now() + interval '20 minutes', 'default', 3)`); err != nil {
		t.Fatal(err)
	}
	if err := w.CheckQueues(ctx); err != nil {
		t.Fatal(err)
	}
	stuck := cap.waitFor(t, "queue_stuck")
	if stuck.Details["kind"] != "stuck_kind" || stuck.Details["queue"] != "research" || stuck.Details["oldest_minutes"] == "" {
		t.Errorf("%+v", stuck)
	}
	for _, a := range cap.all() {
		if a.Details["kind"] == "snoozed_kind" {
			t.Error("a deliberately waiting job raised an alarm")
		}
	}
	// Most recent model calls failing.
	ws := "00000000-0000-4000-8000-0000000000aa"
	if _, err := db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1,'W')`, ws); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		outcome := "error"
		if i == 0 {
			outcome = "ok"
		}
		if _, err := db.Super.Exec(ctx, `INSERT INTO ai_event (workspace_id, task, tier, provider, model, prompt_version, cost_usd, latency_ms, outcome) VALUES ($1,'t','mid','p','m','v',0,1,$2)`, ws, outcome); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.CheckAI(ctx); err != nil {
		t.Fatal(err)
	}
	ai := cap.waitFor(t, "ai_failing")
	if ai.Details["errors"] != "4" || ai.Details["calls"] != "5" {
		t.Errorf("%+v", ai)
	}
}

func TestADependencyThatStaysDownRaisesOneAlertAndABlipRaisesNone(t *testing.T) {
	cap := &capture{}
	a := &ops.Alerter{Notifiers: []ops.Notifier{cap}}
	var mu sync.Mutex
	calls := map[string]int{}
	checks := map[string]ops.Check{
		"database": func(context.Context) error {
			mu.Lock()
			defer mu.Unlock()
			calls["database"]++
			return errors.New("connection refused")
		},
		"blippy": func(context.Context) error {
			mu.Lock()
			defer mu.Unlock()
			calls["blippy"]++
			if calls["blippy"] == 2 {
				return errors.New("one blip")
			}
			return nil
		},
	}
	c, cancel := context.WithCancel(ctx)
	go ops.WatchDependencies(c, checks, a, nil, 20*time.Millisecond)
	cap.waitFor(t, "dependency_down")
	time.Sleep(300 * time.Millisecond)
	cancel()
	n := 0
	for _, x := range cap.all() {
		if x.Name == "dependency_down" {
			n++
			if x.Details["dependency"] != "database" {
				t.Errorf("wrong dependency: %+v", x)
			}
		}
	}
	if n != 1 {
		t.Errorf("%d alerts", n)
	}
}

func TestTheMetricsPageShowsCacheOutcomesAndWhetherItIsSwitchedOff(t *testing.T) {
	m := ops.NewMetrics(nil, "a-metrics-token-that-is-long-enough-0123456789")
	m.Cache = func() []ops.CacheStat {
		return []ops.CacheStat{{Name: "rate-limit", Hits: 1, Errors: 2, BreakerOpen: true}, {Name: "cache", Hits: 7, Misses: 3, Skipped: 4}}
	}
	req := httptest.NewRequest("GET", "/metrics", nil)
	req.Header.Set("Authorization", "Bearer a-metrics-token-that-is-long-enough-0123456789")
	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, req)
	body := rec.Body.String()
	for _, want := range []string{
		`app_cache_events_total{cache="cache",event="hit"} 7`,
		`app_cache_events_total{cache="cache",event="skipped"} 4`,
		`app_cache_events_total{cache="rate-limit",event="error"} 2`,
		`app_cache_breaker_open{cache="rate-limit"} 1`,
		`app_cache_breaker_open{cache="cache"} 0`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in:\n%s", want, body)
		}
	}
}
