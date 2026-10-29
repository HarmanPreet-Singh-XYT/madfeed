package api

import (
	"net/http"
	"strings"

	"product/api/internal/ratelimit"
)

// Limits are requests per minute. Zero means the default.
type Limits struct {
	PublicPerMinute  int // anyone, per address: public pages, unsubscribe
	WebhookPerMinute int // the email provider's reports, per address
	ReadPerMinute    int // signed-in reads, per person
	WritePerMinute   int // signed-in changes, per person
	RegisterPerHour  int // assistant registrations, per address
	TrustedHops      int // proxies of ours in front of the API; 0 ignores X-Forwarded-For
}

func (l Limits) public() int   { return or(l.PublicPerMinute, 60) }
func (l Limits) webhook() int  { return or(l.WebhookPerMinute, 600) }
func (l Limits) read() int     { return or(l.ReadPerMinute, 1200) }
func (l Limits) write() int    { return or(l.WritePerMinute, 120) }
func (l Limits) register() int { return or(l.RegisterPerHour, 20) }

func or(v, def int) int {
	if v > 0 {
		return v
	}
	return def
}

// limitAnonymous throttles the routes anyone can reach, per client address.
// The health endpoints are exempt so monitoring is never throttled.
func limitAnonymous(lim *ratelimit.Limiter, limits func() Limits) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			l := limits()
			var name string
			var max int
			switch {
			case r.URL.Path == "/v1/webhooks/resend" || r.URL.Path == "/v1/webhooks/stripe" || strings.HasPrefix(r.URL.Path, "/v1/integrations/") || strings.HasPrefix(r.URL.Path, "/oauth/") || strings.HasPrefix(r.URL.Path, "/.well-known/"):
				name, max = "webhook", l.webhook()
			case strings.HasPrefix(r.URL.Path, "/v1/public/"):
				name, max = "public", l.public()
			default:
				next.ServeHTTP(w, r)
				return
			}
			if d := lim.Allow(r.Context(), name, ratelimit.ClientIP(r, l.TrustedHops), max, 60); !d.Allowed {
				ratelimit.Reject(w, r, d)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// limitSignedIn throttles each person separately, reads more loosely than changes.
func limitSignedIn(lim *ratelimit.Limiter, limits func() Limits) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			l := limits()
			id, ok := identityFrom(r.Context())
			if !ok { // public route: handled by limitAnonymous
				next.ServeHTTP(w, r)
				return
			}
			name, max := "write", l.write()
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				name, max = "read", l.read()
			}
			if d := lim.Allow(r.Context(), name, id.UserID.String(), max, 60); !d.Allowed {
				ratelimit.Reject(w, r, d)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
