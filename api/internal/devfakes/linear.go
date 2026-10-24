package devfakes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Linear stands in for Linear's GraphQL API: finding a team by its key, and creating issues. A personal key is
// sent as is in the Authorization header (no "Bearer"), as the real service expects.
type Linear struct {
	Mu sync.Mutex

	Key     string // the key currently accepted
	TeamKey string // the one team that exists
	TeamID  string
	Missing bool // the team is gone or out of reach
	Calls   []string
	Bodies  []string // the GraphQL variables sent when issues were created
	next    int
}

func NewLinear() *Linear {
	return &Linear{Key: "lin_api_fake_key_00000001", TeamKey: "ENG", TeamID: "11111111-2222-3333-4444-555555555555", next: 40}
}

func (f *Linear) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.Set(func() { f.Key += "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/graphql", f.handle)
	return mux
}

func (f *Linear) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != f.Key {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"errors":[{"message":"Authentication required","extensions":{"type":"authentication error"}}]}`))
		return
	}
	var req struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	raw, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(raw, &req)
	switch {
	case strings.Contains(req.Query, "issueCreate"):
		f.Calls = append(f.Calls, "issueCreate")
		vb, _ := json.Marshal(req.Variables)
		f.Bodies = append(f.Bodies, string(vb))
		if f.Missing || req.Variables["teamId"] != f.TeamID {
			_, _ = w.Write([]byte(`{"errors":[{"message":"Entity not found: Team"}]}`))
			return
		}
		f.next++
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"issueCreate": map[string]any{"success": true, "issue": map[string]any{
			"number": f.next, "url": fmt.Sprintf("https://linear.app/acme/issue/%s-%d", f.TeamKey, f.next),
			"updatedAt": time.Now().UTC().Add(-time.Second).Format(time.RFC3339), "team": map[string]any{"key": f.TeamKey},
		}}}})
	case strings.Contains(req.Query, "teams("):
		f.Calls = append(f.Calls, "teams")
		nodes := []any{}
		if !f.Missing && strings.EqualFold(fmt.Sprint(req.Variables["key"]), f.TeamKey) {
			nodes = append(nodes, map[string]any{"id": f.TeamID, "key": f.TeamKey, "name": "Engineering"})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"teams": map[string]any{"nodes": nodes}}})
	case strings.Contains(req.Query, "team(id"):
		f.Calls = append(f.Calls, "team")
		var team any
		if !f.Missing && req.Variables["id"] == f.TeamID {
			team = map[string]any{"id": f.TeamID}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"team": team}})
	default:
		_, _ = w.Write([]byte(`{"errors":[{"message":"Unknown query"}]}`))
	}
}

func (f *Linear) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

// Writes counts the calls that created something.
func (f *Linear) Writes() int {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if c == "issueCreate" {
			n++
		}
	}
	return n
}
