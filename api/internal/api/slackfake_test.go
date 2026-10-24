package api

import (
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// fakeSlack stands in for Slack's API: the same calls, the same answers (including the ways it says no).
type fakeSlack struct {
	srv *httptest.Server
	mu  sync.Mutex

	team, teamName string
	token          string // the access token currently valid
	refresh        string
	rotate         bool // hand out tokens that expire (with a refresh token)
	codesUsed      map[string]bool
	revoked        bool
	failRefresh    bool
	calls          []string
	joined         []string
}

func newFakeSlack(t *testing.T) *fakeSlack {
	f := &fakeSlack{team: "T" + strings.ToUpper(strings.ReplaceAll(uuid.NewString()[:8], "-", "")), teamName: "Acme Slack", token: "xoxb-fake-token-1", codesUsed: map[string]bool{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", f.handle)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeSlack) reply(w http.ResponseWriter, v map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (f *fakeSlack) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	method := strings.TrimPrefix(r.URL.Path, "/api/")
	_ = r.ParseForm()
	f.calls = append(f.calls, method)
	if method == "oauth.v2.access" {
		if r.Form.Get("grant_type") == "refresh_token" {
			if f.failRefresh || r.Form.Get("refresh_token") != f.refresh {
				f.reply(w, map[string]any{"ok": false, "error": "invalid_refresh_token"})
				return
			}
			f.token = f.token + "r"
			f.reply(w, map[string]any{"ok": true, "access_token": f.token, "refresh_token": f.refresh, "expires_in": 43200, "team": map[string]any{"id": f.team, "name": f.teamName}})
			return
		}
		code := r.Form.Get("code")
		if code == "" || f.codesUsed[code] || r.Form.Get("client_secret") != "slack-client-secret" || r.Form.Get("redirect_uri") == "" {
			f.reply(w, map[string]any{"ok": false, "error": "invalid_code"})
			return
		}
		f.codesUsed[code] = true // a code works once
		out := map[string]any{"ok": true, "access_token": f.token, "token_type": "bot", "bot_user_id": "UBOT", "team": map[string]any{"id": f.team, "name": f.teamName}}
		if f.rotate {
			f.refresh = "xoxe-refresh-1"
			out["refresh_token"], out["expires_in"] = f.refresh, 43200
		}
		f.reply(w, out)
		return
	}
	auth := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if f.revoked {
		f.reply(w, map[string]any{"ok": false, "error": "token_revoked"})
		return
	}
	if auth != f.token {
		f.reply(w, map[string]any{"ok": false, "error": "invalid_auth"})
		return
	}
	switch method {
	case "auth.test":
		f.reply(w, map[string]any{"ok": true, "team_id": f.team})
	case "conversations.list":
		f.reply(w, map[string]any{"ok": true, "channels": []map[string]any{{"id": "C0FEEDBACK", "name": "feedback"}, {"id": "C0RANDOM", "name": "random"}, {"id": "C0OLD", "name": "old", "is_archived": true}}})
	case "conversations.info":
		ch := r.Form.Get("channel")
		names := map[string]string{"C0FEEDBACK": "feedback", "C0RANDOM": "random"}
		if n, ok := names[ch]; ok {
			f.reply(w, map[string]any{"ok": true, "channel": map[string]any{"id": ch, "name": n}})
			return
		}
		f.reply(w, map[string]any{"ok": false, "error": "channel_not_found"})
	case "conversations.join":
		f.joined = append(f.joined, r.Form.Get("channel"))
		f.reply(w, map[string]any{"ok": true})
	default:
		f.reply(w, map[string]any{"ok": false, "error": "unknown_method"})
	}
}

func (f *fakeSlack) revoke()   { f.mu.Lock(); f.revoked = true; f.mu.Unlock() }
func (f *fakeSlack) unrevoke() { f.mu.Lock(); f.revoked = false; f.mu.Unlock() }
func (f *fakeSlack) callCount(m string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c == m {
			n++
		}
	}
	return n
}

// codeFromAuthorize does what the person's browser would: follows the link and gets sent back with a code.
func authorizeParams(raw string) url.Values {
	u, _ := url.Parse(raw)
	return u.Query()
}
