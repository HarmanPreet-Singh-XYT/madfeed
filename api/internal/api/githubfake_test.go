package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeGitHub stands in for GitHub's REST API: repositories, issue creation, and the ways it says no.
type fakeGitHub struct {
	srv *httptest.Server
	mu  sync.Mutex

	token     string // the token currently accepted
	private   bool
	hasIssues bool
	missing   bool // the repository is gone or out of reach
	next      int
	calls     []string
	bodies    []string // the JSON sent when issues were created
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	f := &fakeGitHub{token: "github_pat_fake_token_0001", private: true, hasIssues: true, next: 100}
	f.srv = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGitHub) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	if strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") != f.token {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"message":"Bad credentials"}`))
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // repos owner name [issues]
	if len(parts) < 3 || parts[0] != "repos" || f.missing {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"message":"Not Found"}`))
		return
	}
	repo := parts[1] + "/" + parts[2]
	switch {
	case r.Method == http.MethodGet && len(parts) == 3:
		_ = json.NewEncoder(w).Encode(map[string]any{"full_name": repo, "private": f.private, "has_issues": f.hasIssues, "archived": false})
	case r.Method == http.MethodPost && len(parts) == 4 && parts[3] == "issues":
		b, _ := io.ReadAll(r.Body)
		f.bodies = append(f.bodies, string(b))
		f.next++
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{"number": f.next, "html_url": fmt.Sprintf("https://github.com/%s/issues/%d", repo, f.next), "updated_at": time.Now().UTC().Add(-time.Second).Format(time.RFC3339)})
	default:
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"message":"Not Found"}`))
	}
}

func (f *fakeGitHub) set(fn func()) { f.mu.Lock(); fn(); f.mu.Unlock() }
func (f *fakeGitHub) writes() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if !strings.HasPrefix(c, "GET ") {
			n++
		}
	}
	return n
}
