package devfakes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// Jira stands in for Jira Cloud's REST API (version 2): checking a project and creating an issue, with Basic
// authentication by account email and API token.
type Jira struct {
	Mu sync.Mutex

	Email, Token string // the account currently accepted
	Project      string // the one project that exists
	Missing      bool   // the project is gone or out of reach
	Calls        []string
	Bodies       []string // the JSON sent when issues were created
	next         int
}

func NewJira() *Jira {
	return &Jira{Email: "bot@acme.example", Token: "jira_api_token_fake_0001", Project: "PROJ", next: 70}
}

func (f *Jira) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.Set(func() { f.Token += "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/rest/api/2/", f.handle)
	return mux
}

func (f *Jira) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	user, pass, ok := r.BasicAuth()
	if !ok || user != f.Email || pass != f.Token {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Client must be authenticated to access this resource."}`))
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/rest/api/2/")
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(path, "project/"):
		f.Calls = append(f.Calls, "project")
		if f.Missing || strings.TrimPrefix(path, "project/") != f.Project {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errorMessages":["No project could be found with key."]}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"key": f.Project, "name": "Product"})
	case r.Method == http.MethodPost && path == "issue":
		raw, _ := io.ReadAll(r.Body)
		f.Calls = append(f.Calls, "issue")
		f.Bodies = append(f.Bodies, string(raw))
		var body struct {
			Fields struct {
				Project struct{ Key string } `json:"project"`
			} `json:"fields"`
		}
		_ = json.Unmarshal(raw, &body)
		if f.Missing || body.Fields.Project.Key != f.Project {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"errors":{"project":"valid project is required"}}`))
			return
		}
		f.next++
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": fmt.Sprint(10000 + f.next), "key": fmt.Sprintf("%s-%d", f.Project, f.next)})
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"errorMessages":["Not found"]}`))
	}
}

func (f *Jira) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

// Writes counts the issues created.
func (f *Jira) Writes() int {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if c == "issue" {
			n++
		}
	}
	return n
}
