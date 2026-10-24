// Package devfakes holds local stand-ins for the outside services we connect to (Slack, GitHub, Stripe): the
// same calls and the same answers, including the ways each says no. They are used by the Go tests and by the
// browser tests, so both exercise the same behaviour. Nothing here is linked into the real server.
package devfakes

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/google/uuid"
)

// Slack stands in for Slack's API and its approval page.
type Slack struct {
	Mu sync.Mutex

	Team, TeamName string
	Token          string // the access token currently valid
	Refresh        string
	Rotate         bool // hand out tokens that expire (with a refresh token)
	FailRefresh    bool
	Revoked        bool
	ClientSecret   string
	Joined         []string

	codesUsed map[string]bool
	calls     []string
}

func NewSlack() *Slack {
	return &Slack{
		Team: "T" + strings.ToUpper(strings.ReplaceAll(uuid.NewString()[:8], "-", "")), TeamName: "Acme Slack",
		Token: "xoxb-fake-token-1", ClientSecret: "slack-client-secret", codesUsed: map[string]bool{},
	}
}

func reply(w http.ResponseWriter, v map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (f *Slack) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/v2/authorize", f.authorize)
	mux.HandleFunc("/api/", f.api)
	// Controls for the browser tests: make Slack stop (or start again) accepting our token.
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) { f.Revoke(); w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/_dev/unrevoke", func(w http.ResponseWriter, r *http.Request) { f.Unrevoke(); w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/_dev/team", func(w http.ResponseWriter, r *http.Request) {
		f.Mu.Lock()
		defer f.Mu.Unlock()
		reply(w, map[string]any{"team": f.Team})
	})
	return mux
}

// authorize is the page where the person approves; the stand-in approves at once and sends them back.
func (f *Slack) authorize(w http.ResponseWriter, r *http.Request) {
	back, err := url.Parse(r.URL.Query().Get("redirect_uri"))
	if err != nil || back.Scheme == "" || r.URL.Query().Get("client_id") == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	q := back.Query()
	q.Set("code", "code-"+uuid.NewString())
	q.Set("state", r.URL.Query().Get("state"))
	back.RawQuery = q.Encode()
	http.Redirect(w, r, back.String(), http.StatusFound)
}

func (f *Slack) api(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	method := strings.TrimPrefix(r.URL.Path, "/api/")
	_ = r.ParseForm()
	f.calls = append(f.calls, method)
	if method == "oauth.v2.access" {
		if r.Form.Get("grant_type") == "refresh_token" {
			if f.FailRefresh || r.Form.Get("refresh_token") != f.Refresh {
				reply(w, map[string]any{"ok": false, "error": "invalid_refresh_token"})
				return
			}
			f.Token += "r"
			reply(w, map[string]any{"ok": true, "access_token": f.Token, "refresh_token": f.Refresh, "expires_in": 43200, "team": map[string]any{"id": f.Team, "name": f.TeamName}})
			return
		}
		code := r.Form.Get("code")
		if code == "" || f.codesUsed[code] || r.Form.Get("client_secret") != f.ClientSecret || r.Form.Get("redirect_uri") == "" {
			reply(w, map[string]any{"ok": false, "error": "invalid_code"})
			return
		}
		f.codesUsed[code] = true // a code works once
		out := map[string]any{"ok": true, "access_token": f.Token, "token_type": "bot", "bot_user_id": "UBOT", "team": map[string]any{"id": f.Team, "name": f.TeamName}}
		if f.Rotate {
			f.Refresh = "xoxe-refresh-1"
			out["refresh_token"], out["expires_in"] = f.Refresh, 43200
		}
		reply(w, out)
		return
	}
	auth := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if f.Revoked {
		reply(w, map[string]any{"ok": false, "error": "token_revoked"})
		return
	}
	if auth != f.Token {
		reply(w, map[string]any{"ok": false, "error": "invalid_auth"})
		return
	}
	switch method {
	case "auth.test":
		reply(w, map[string]any{"ok": true, "team_id": f.Team})
	case "conversations.list":
		reply(w, map[string]any{"ok": true, "channels": []map[string]any{{"id": "C0FEEDBACK", "name": "feedback"}, {"id": "C0RANDOM", "name": "random"}, {"id": "C0OLD", "name": "old", "is_archived": true}}})
	case "conversations.info":
		ch := r.Form.Get("channel")
		names := map[string]string{"C0FEEDBACK": "feedback", "C0RANDOM": "random"}
		if n, ok := names[ch]; ok {
			reply(w, map[string]any{"ok": true, "channel": map[string]any{"id": ch, "name": n}})
			return
		}
		reply(w, map[string]any{"ok": false, "error": "channel_not_found"})
	case "conversations.join":
		f.Joined = append(f.Joined, r.Form.Get("channel"))
		reply(w, map[string]any{"ok": true})
	default:
		reply(w, map[string]any{"ok": false, "error": "unknown_method"})
	}
}

func (f *Slack) Revoke()   { f.Mu.Lock(); f.Revoked = true; f.Mu.Unlock() }
func (f *Slack) Unrevoke() { f.Mu.Lock(); f.Revoked = false; f.Mu.Unlock() }
func (f *Slack) SetToken(t string) {
	f.Mu.Lock()
	f.Token = t
	f.Mu.Unlock()
}
func (f *Slack) CallCount(m string) int {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c == m {
			n++
		}
	}
	return n
}
