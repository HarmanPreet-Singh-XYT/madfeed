package devfakes

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ---- ClickUp ----

// ClickUp stands in for ClickUp's API: a list, a workspace, tasks, and webhooks that it signs.
type ClickUp struct {
	Mu     sync.Mutex
	Token  string
	ListID string
	TeamID string
	// Secret is the signing secret handed out when the webhook was made; Endpoint is where it was told to send.
	Secret, Endpoint, WebhookID string
	Calls                       []string
	Bodies                      []string
	Missing                     bool
	next                        int
}

func NewClickUp() *ClickUp {
	return &ClickUp{Token: "pk_fake_clickup_token_0001", ListID: "901100", TeamID: "9001", next: 100}
}

func (f *ClickUp) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

func (f *ClickUp) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.Set(func() { f.Token += "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/_dev/state", func(w http.ResponseWriter, r *http.Request) { // for the browser tests: the secret ClickUp signs with
		f.Mu.Lock()
		defer f.Mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"secret": f.Secret, "webhookId": f.WebhookID, "listId": f.ListID})
	})
	mux.HandleFunc("/", f.handle)
	return mux
}

func (f *ClickUp) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != f.Token {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"err":"Token invalid","ECODE":"OAUTH_025"}`))
		return
	}
	raw, _ := io.ReadAll(r.Body)
	f.Calls = append(f.Calls, r.Method+" "+r.URL.Path)
	p := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.Method == http.MethodGet && len(p) == 2 && p[0] == "list":
		if f.Missing || p[1] != f.ListID {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"err":"List not found"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": f.ListID, "name": "Product backlog"})
	case r.Method == http.MethodGet && len(p) == 1 && p[0] == "team":
		_ = json.NewEncoder(w).Encode(map[string]any{"teams": []any{map[string]any{"id": f.TeamID, "name": "Acme"}}})
	case r.Method == http.MethodPost && len(p) == 3 && p[0] == "team" && p[2] == "webhook":
		var b struct {
			Endpoint string `json:"endpoint"`
		}
		_ = json.Unmarshal(raw, &b)
		sec := make([]byte, 16)
		_, _ = rand.Read(sec)
		f.Secret, f.Endpoint, f.WebhookID = hex.EncodeToString(sec), b.Endpoint, "wh-"+hex.EncodeToString(sec[:3])
		_ = json.NewEncoder(w).Encode(map[string]any{"id": f.WebhookID, "webhook": map[string]any{"id": f.WebhookID, "secret": f.Secret}})
	case r.Method == http.MethodDelete && len(p) == 2 && p[0] == "webhook":
		f.Secret, f.Endpoint = "", ""
		_, _ = w.Write([]byte(`{}`))
	case r.Method == http.MethodPost && len(p) == 3 && p[0] == "list" && p[2] == "task":
		f.Bodies = append(f.Bodies, string(raw))
		if f.Missing {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		f.next++
		id := fmt.Sprintf("86c%d", f.next)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "url": "https://app.clickup.com/t/" + id, "date_updated": fmt.Sprint(time.Now().Add(-time.Second).UnixMilli())})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// ---- Asana ----

// Asana stands in for Asana's API, including the handshake it does when a webhook is made: it calls the
// target with a secret and expects it back. Tests can replace how the call is made with OnHandshake.
type Asana struct {
	Mu          sync.Mutex
	Token       string
	ProjectID   string
	Secret      string
	Target      string
	Completed   map[string]bool
	Calls       []string
	Bodies      []string
	OnHandshake func(target, secret string) error // default: a real POST
	Missing     bool
	next        int
}

func NewAsana() *Asana {
	return &Asana{Token: "1/1200000000000000:fakeasanatoken0001", ProjectID: "120000000001", Completed: map[string]bool{}, next: 5000}
}

func (f *Asana) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

func (f *Asana) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.Set(func() { f.Token += "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/_dev/complete/", func(w http.ResponseWriter, r *http.Request) { // flips a task
		gid := strings.TrimPrefix(r.URL.Path, "/_dev/complete/")
		f.Set(func() { f.Completed[gid] = r.URL.Query().Get("done") != "false" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/_dev/state", func(w http.ResponseWriter, r *http.Request) {
		f.Mu.Lock()
		defer f.Mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"secret": f.Secret, "projectId": f.ProjectID})
	})
	mux.HandleFunc("/", f.handle)
	return mux
}

func (f *Asana) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != "Bearer "+f.Token {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"errors":[{"message":"Not Authorized"}]}`))
		return
	}
	raw, _ := io.ReadAll(r.Body)
	f.Calls = append(f.Calls, r.Method+" "+r.URL.Path)
	p := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.Method == http.MethodGet && len(p) == 2 && p[0] == "projects":
		if f.Missing || p[1] != f.ProjectID {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errors":[{"message":"project: Not a recognized ID"}]}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"gid": f.ProjectID, "name": "Roadmap"}})
	case r.Method == http.MethodPost && len(p) == 1 && p[0] == "webhooks":
		var b struct {
			Data struct {
				Target string `json:"target"`
			} `json:"data"`
		}
		_ = json.Unmarshal(raw, &b)
		sec := make([]byte, 16)
		_, _ = rand.Read(sec)
		f.Secret, f.Target = hex.EncodeToString(sec), b.Data.Target
		hs := f.OnHandshake
		secret, target := f.Secret, f.Target
		f.Mu.Unlock() // the handshake calls back into the app while this request waits
		var err error
		if hs != nil {
			err = hs(target, secret)
		} else {
			err = handshakeOverHTTP(target, secret)
		}
		f.Mu.Lock()
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"errors":[{"message":"The handshake failed"}]}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"gid": "wh-1234567"}})
	case r.Method == http.MethodDelete && len(p) == 2 && p[0] == "webhooks":
		f.Secret, f.Target = "", ""
		_, _ = w.Write([]byte(`{"data":{}}`))
	case r.Method == http.MethodPost && len(p) == 1 && p[0] == "tasks":
		f.Bodies = append(f.Bodies, string(raw))
		if f.Missing {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.next++
		gid := fmt.Sprint(f.next + 1200000000000)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"gid": gid, "permalink_url": "https://app.asana.com/0/" + f.ProjectID + "/" + gid}})
	case r.Method == http.MethodGet && len(p) == 2 && p[0] == "tasks":
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"gid": p[1], "completed": f.Completed[p[1]]}})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func handshakeOverHTTP(target, secret string) error {
	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader([]byte("{}")))
	if err != nil {
		return err
	}
	req.Header.Set("X-Hook-Secret", secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 || res.Header.Get("X-Hook-Secret") != secret {
		return fmt.Errorf("handshake answered %d", res.StatusCode)
	}
	return nil
}

// ---- Azure DevOps ----

// AzureDevOps stands in for Azure DevOps Services: a project check and work item creation, with a personal
// access token sent as the password of Basic authentication.
type AzureDevOps struct {
	Mu           sync.Mutex
	Token        string
	Org, Project string
	Calls        []string
	Bodies       []string
	Missing      bool
	next         int
}

func NewAzureDevOps() *AzureDevOps {
	return &AzureDevOps{Token: "ado_fake_pat_0123456789abcdef", Org: "acme", Project: "Product", next: 300}
}

func (f *AzureDevOps) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

func (f *AzureDevOps) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.Set(func() { f.Token += "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", f.handle)
	return mux
}

func (f *AzureDevOps) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if _, pass, ok := r.BasicAuth(); !ok || pass != f.Token {
		w.WriteHeader(http.StatusNonAuthoritativeInfo) // the real service answers a sign-in page with 203
		_, _ = w.Write([]byte(`<html>Sign in</html>`))
		return
	}
	raw, _ := io.ReadAll(r.Body)
	f.Calls = append(f.Calls, r.Method+" "+r.URL.Path)
	path, _ := urlPath(r)
	p := strings.Split(strings.Trim(path, "/"), "/") // org _apis projects name | org project _apis wit workitems $Task
	switch {
	case r.Method == http.MethodGet && len(p) == 4 && p[0] == f.Org && p[1] == "_apis" && p[2] == "projects":
		if f.Missing || p[3] != f.Project {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "p-1", "name": f.Project})
	case r.Method == http.MethodPost && len(p) == 6 && p[0] == f.Org && p[1] == f.Project && p[3] == "wit" && p[4] == "workitems":
		f.Bodies = append(f.Bodies, string(raw)+"|"+r.Header.Get("Content-Type")+"|"+p[5])
		if f.Missing {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.next++
		_ = json.NewEncoder(w).Encode(map[string]any{"id": f.next, "_links": map[string]any{"html": map[string]any{"href": fmt.Sprintf("https://dev.azure.com/%s/%s/_workitems/edit/%d", f.Org, f.Project, f.next)}}})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func urlPath(r *http.Request) (string, error) { return r.URL.Path, nil }
