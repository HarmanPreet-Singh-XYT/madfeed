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

// GitHub stands in for GitHub's REST API: repositories, issue creation, and the ways it says no.
type GitHub struct {
	Mu sync.Mutex

	Token     string // the token currently accepted
	Private   bool
	HasIssues bool
	Missing   bool // the repository is gone or out of reach
	Calls     []string
	Bodies    []string // the JSON sent when issues were created
	next      int
}

func NewGitHub() *GitHub {
	return &GitHub{Token: "github_pat_fake_token_0001", Private: true, HasIssues: true, next: 100}
}

func (f *GitHub) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) { // GitHub stops accepting the token
		f.Set(func() { f.Token = f.Token + "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", f.handle)
	return mux
}

func (f *GitHub) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	f.Calls = append(f.Calls, r.Method+" "+r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	if strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") != f.Token {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"message":"Bad credentials"}`))
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // repos owner name [issues]
	if len(parts) < 3 || parts[0] != "repos" || f.Missing {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"message":"Not Found"}`))
		return
	}
	repo := parts[1] + "/" + parts[2]
	switch {
	case r.Method == http.MethodGet && len(parts) == 3:
		_ = json.NewEncoder(w).Encode(map[string]any{"full_name": repo, "private": f.Private, "has_issues": f.HasIssues, "archived": false})
	case r.Method == http.MethodPost && len(parts) == 4 && parts[3] == "issues":
		b, _ := io.ReadAll(r.Body)
		f.Bodies = append(f.Bodies, string(b))
		f.next++
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{"number": f.next, "html_url": fmt.Sprintf("https://github.com/%s/issues/%d", repo, f.next), "updated_at": time.Now().UTC().Add(-time.Second).Format(time.RFC3339)})
	default:
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"message":"Not Found"}`))
	}
}

func (f *GitHub) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

// Writes counts the calls that changed something.
func (f *GitHub) Writes() int {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if !strings.HasPrefix(c, "GET ") {
			n++
		}
	}
	return n
}
