// Package ops is how the system tells people when it is unwell: alerts with
// de-duplication, a notifier that posts to a chat webhook, request ids that
// follow a request into the background jobs it creates, and watchers for the
// things that fail quietly (a stuck queue, a failing model, a dead dependency).
//
// Alerts never carry customer content: only names, ids, counts and short error
// classes, cleaned of anything that looks like a secret.
package ops

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"product/api/internal/redact"
)

type Severity string

const (
	Warning  Severity = "warning"
	Critical Severity = "critical"
)

type Alert struct {
	Name     string // what kind of problem, e.g. "job_failed"
	Severity Severity
	Summary  string            // one plain sentence
	Details  map[string]string // ids, counts, short error classes
}

// Notifier delivers an alert somewhere a person will see it.
type Notifier interface {
	Notify(ctx context.Context, a Alert) error
}

// LogNotifier writes the alert to the structured log at error level.
type LogNotifier struct{ Log *slog.Logger }

func (l LogNotifier) Notify(_ context.Context, a Alert) error {
	log := l.Log
	if log == nil {
		log = slog.Default()
	}
	attrs := []any{"alert", a.Name, "severity", string(a.Severity)}
	keys := make([]string, 0, len(a.Details))
	for k := range a.Details {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		attrs = append(attrs, k, a.Details[k])
	}
	log.Error(a.Summary, attrs...)
	return nil
}

// WebhookNotifier posts a Slack-compatible message ({"text": ...}) to a URL.
type WebhookNotifier struct {
	URL    string
	Client *http.Client
}

// ValidWebhookURL accepts only https URLs (or http to the local machine, for tests).
func ValidWebhookURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("alert webhook is not a valid URL")
	}
	local := u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return fmt.Errorf("alert webhook must be an https URL")
	}
	return nil
}

func (w WebhookNotifier) Notify(ctx context.Context, a Alert) error {
	var b strings.Builder
	icon := ":warning:"
	if a.Severity == Critical {
		icon = ":rotating_light:"
	}
	fmt.Fprintf(&b, "%s *%s* — %s", icon, a.Name, a.Summary)
	keys := make([]string, 0, len(a.Details))
	for k := range a.Details {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(&b, "\n• %s: %s", k, a.Details[k])
	}
	body, _ := json.Marshal(map[string]string{"text": b.String()})
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c := w.Client
	if c == nil {
		c = &http.Client{Timeout: 5 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("alert webhook unreachable") // never include the URL: it is a secret
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("alert webhook answered %d", resp.StatusCode)
	}
	return nil
}

// Alerter fans an alert out to every notifier, but not the same one twice
// within the cooldown, so one broken thing is one message, not a flood.
type Alerter struct {
	Notifiers []Notifier
	Cooldown  time.Duration // 0 means 15 minutes
	Now       func() time.Time
	Log       *slog.Logger

	mu   sync.Mutex
	last map[string]time.Time
}

func clean(s string) string {
	s = redact.Text(s).Text
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

// Fire sends the alert unless the same one (same name and key detail) fired recently.
func (a *Alerter) Fire(ctx context.Context, al Alert, dedupeKey string) bool {
	now := time.Now
	if a.Now != nil {
		now = a.Now
	}
	cool := a.Cooldown
	if cool <= 0 {
		cool = 15 * time.Minute
	}
	key := al.Name + "|" + dedupeKey
	a.mu.Lock()
	if a.last == nil {
		a.last = map[string]time.Time{}
	}
	if t, ok := a.last[key]; ok && now().Sub(t) < cool {
		a.mu.Unlock()
		return false
	}
	a.last[key] = now()
	a.mu.Unlock()

	al.Summary = clean(al.Summary)
	cleaned := make(map[string]string, len(al.Details))
	for k, v := range al.Details {
		cleaned[k] = clean(v)
	}
	al.Details = cleaned
	for _, n := range a.Notifiers {
		if err := n.Notify(ctx, al); err != nil {
			log := a.Log
			if log == nil {
				log = slog.Default()
			}
			log.Error("could not deliver an alert", "alert", al.Name, "error", err.Error())
		}
	}
	return true
}
