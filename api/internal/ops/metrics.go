package ops

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Metrics counts what this process serves and, when asked, reads the shared gauges (job queues,
// model spend) from the database. It exposes them in the plain-text format Prometheus and most
// monitoring services read. Only aggregates: no workspace, person or content ever appears.
type Metrics struct {
	Pool  *pgxpool.Pool // nil: only this process's counters are shown
	Token string        // bearer token the scraper must send; empty switches the endpoint off

	// Cache, when set, reports how the shared cache is doing in this process.
	Cache func() []CacheStat

	mu       sync.Mutex
	requests map[string]*atomic.Int64 // "GET 2xx" -> count
	seconds  atomic.Int64             // total handling time in microseconds
	inFlight atomic.Int64
	started  time.Time
}

// CacheStat is one cache connection's counts since the process started.
type CacheStat struct {
	Name                          string
	Hits, Misses, Errors, Skipped int64
	BreakerOpen                   bool
}

// NewMetrics starts counting from now.
func NewMetrics(pool *pgxpool.Pool, token string) *Metrics {
	return &Metrics{Pool: pool, Token: token, requests: map[string]*atomic.Int64{}, started: time.Now()}
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(c int) { s.code = c; s.ResponseWriter.WriteHeader(c) }
func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Instrument counts every request by method and status class. Paths are deliberately not a
// label: they carry ids, and ids would make the number of series grow without bound.
func (m *Metrics) Instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		m.inFlight.Add(1)
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		defer func() {
			m.inFlight.Add(-1)
			m.seconds.Add(time.Since(start).Microseconds())
			key := fmt.Sprintf("%s %dxx", methodLabel(r.Method), sw.code/100)
			m.mu.Lock()
			c := m.requests[key]
			if c == nil {
				c = new(atomic.Int64)
				m.requests[key] = c
			}
			m.mu.Unlock()
			c.Add(1)
		}()
		next.ServeHTTP(sw, r)
	})
}

func methodLabel(m string) string {
	switch m {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions:
		return m
	}
	return "OTHER"
}

// ServeHTTP answers a scrape. Without the right bearer token it answers 404, so the endpoint's
// existence is not advertised.
func (m *Metrics) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if m.Token == "" || r.Method != http.MethodGet || subtle.ConstantTimeCompare([]byte(got), []byte(m.Token)) != 1 {
		http.NotFound(w, r)
		return
	}
	var b strings.Builder
	line := func(help, typ, name string, labels string, v any) {
		if help != "" {
			fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, typ)
		}
		if labels != "" {
			labels = "{" + labels + "}"
		}
		fmt.Fprintf(&b, "%s%s %v\n", name, labels, v)
	}
	line("Seconds since this process started.", "gauge", "app_uptime_seconds", "", int64(time.Since(m.started).Seconds()))
	line("Requests being handled right now by this process.", "gauge", "app_http_in_flight", "", m.inFlight.Load())
	line("Total time spent handling requests, in seconds.", "counter", "app_http_handling_seconds_total", "", float64(m.seconds.Load())/1e6)
	m.mu.Lock()
	keys := make([]string, 0, len(m.requests))
	for k := range m.requests {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	first := true
	for _, k := range keys {
		method, class, _ := strings.Cut(k, " ")
		help := ""
		if first {
			help, first = "Requests served by this process, by method and status class.", false
		}
		line(help, "counter", "app_http_requests_total", fmt.Sprintf(`method=%q,status=%q`, method, class), m.requests[k].Load())
	}
	m.mu.Unlock()

	if m.Cache != nil {
		stats := m.Cache()
		sort.Slice(stats, func(i, j int) bool { return stats[i].Name < stats[j].Name })
		first := true
		for _, st := range stats {
			for _, ev := range []struct {
				name string
				n    int64
			}{{"hit", st.Hits}, {"miss", st.Misses}, {"error", st.Errors}, {"skipped", st.Skipped}} {
				help := ""
				if first {
					help, first = "Cache lookups by outcome in this process. Skipped means the cache was switched off after repeated errors.", false
				}
				line(help, "counter", "app_cache_events_total", fmt.Sprintf(`cache=%q,event=%q`, st.Name, ev.name), ev.n)
			}
		}
		for i, st := range stats {
			help := ""
			if i == 0 {
				help = "1 while the cache is switched off after repeated errors."
			}
			open := 0
			if st.BreakerOpen {
				open = 1
			}
			line(help, "gauge", "app_cache_breaker_open", fmt.Sprintf(`cache=%q`, st.Name), open)
		}
	}
	if m.Pool != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := m.dbGauges(ctx, line); err != nil {
			line("", "", "app_metrics_database_error", "", 1)
		}
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(b.String()))
}

func (m *Metrics) dbGauges(ctx context.Context, line func(help, typ, name, labels string, v any)) error {
	rows, err := m.Pool.Query(ctx, `SELECT queue, state::text, count(*) FROM river.river_job GROUP BY queue, state ORDER BY queue, state`)
	if err != nil {
		return err
	}
	first := true
	for rows.Next() {
		var queue, state string
		var n int64
		if err := rows.Scan(&queue, &state, &n); err != nil {
			rows.Close()
			return err
		}
		help := ""
		if first {
			help, first = "Background jobs by queue and state.", false
		}
		line(help, "gauge", "app_jobs", fmt.Sprintf(`queue=%q,state=%q`, queue, state), n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	var oldest float64
	if err := m.Pool.QueryRow(ctx, `SELECT coalesce(extract(epoch FROM now() - min(scheduled_at)), 0)::float8 FROM river.river_job WHERE state = 'available'`).Scan(&oldest); err != nil {
		return err
	}
	line("Age in seconds of the oldest job that is ready and waiting.", "gauge", "app_jobs_oldest_ready_seconds", "", oldest)
	var calls, errs int64
	var cost float64
	if err := m.Pool.QueryRow(ctx, `SELECT calls, errors, cost_usd FROM ops_ai_totals(24)`).Scan(&calls, &errs, &cost); err != nil {
		return err
	}
	line("Model calls in the last 24 hours, all workspaces.", "gauge", "app_ai_calls_24h", "", calls)
	line("Failed model calls in the last 24 hours.", "gauge", "app_ai_errors_24h", "", errs)
	line("Model spend in USD over the last 24 hours, all workspaces.", "gauge", "app_ai_cost_usd_24h", "", cost)
	return nil
}
