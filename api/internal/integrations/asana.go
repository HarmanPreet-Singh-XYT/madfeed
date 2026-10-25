package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"product/api/internal/store"
)

// AsanaConfig is where Asana's API lives.
type AsanaConfig struct {
	APIBase string // default https://app.asana.com/api/1.0
}

func (c AsanaConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://app.asana.com/api/1.0"
}

var gidRe = regexp.MustCompile(`^[0-9]{4,24}$`)

// handshakeWindow is how long after connecting Asana may introduce its signing secret.
const handshakeWindow = 2 * time.Minute

type asanaDriver struct{}

func (asanaDriver) Kind() string { return "asana" }
func (asanaDriver) Name() string { return "Asana" }
func (asanaDriver) Intro() string {
	return "Open a task in one Asana project for a request from its page. When the task is completed or reopened, the request can follow. Tasks carry only the request's title and counts, never customer quotes, names or emails."
}
func (asanaDriver) Fields() []FieldSpec {
	return []FieldSpec{
		{Name: "projectId", Label: "Project ID", Help: "The long number in the project's address in Asana. New tasks are created in this project."},
		{Name: "token", Label: "Personal access token", Secret: true, Help: "Make one in Asana under your profile's apps settings. It acts as you, so use an account that can create tasks in the project. It is stored encrypted and never shown again."},
	}
}

type asanaCreds struct {
	Token  string `json:"token"`
	Secret string `json:"secret,omitempty"`
	// Pending is when (unix seconds) Asana may still introduce its signing secret; zero once it has.
	Pending int64 `json:"pending,omitempty"`
}

type asanaSettings struct {
	ProjectID string `json:"projectId"`
	WebhookID string `json:"webhookId,omitempty"`
}

func (asanaDriver) hdr(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func (a asanaDriver) Connect(ctx context.Context, s *Service, t store.Tenant, in map[string]string) (connectResult, error) {
	project, token := in["projectId"], in["token"]
	if !gidRe.MatchString(project) {
		return connectResult{}, ErrInvalid("the project ID is the long number in the project's address")
	}
	if l := len(token); l < 10 || l > 300 {
		return connectResult{}, ErrInvalid("paste the personal access token")
	}
	base := s.Asana.api()
	var p struct {
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	st, err := s.callJSON(ctx, http.MethodGet, base+"/projects/"+project, a.hdr(token), nil, &p)
	if err != nil {
		return connectResult{}, err
	}
	switch {
	case st == http.StatusUnauthorized:
		return connectResult{}, ErrInvalid("Asana did not accept that token")
	case st == http.StatusNotFound || st == http.StatusForbidden:
		return connectResult{}, ErrInvalid("that project was not found, or the token cannot reach it")
	case st != http.StatusOK:
		return connectResult{}, ErrInvalid("Asana could not check that project; try again")
	}
	creds := asanaCreds{Token: token, Pending: s.now().Add(handshakeWindow).Unix()}
	res := connectResult{Driver: asanaSettings{ProjectID: project}, Creds: creds, Summary: p.Data.Name, Detail: "Asana project " + project}
	res.After = func(ctx context.Context) (map[string]any, error) {
		// Asana now calls the notification address to introduce its signing secret (see Event), while this request waits.
		var made struct {
			Data struct {
				GID string `json:"gid"`
			} `json:"data"`
		}
		body := map[string]any{"data": map[string]any{
			"resource": project, "target": s.trackerWebhookURL("asana", t.WorkspaceID),
			"filters": []map[string]any{{"resource_type": "task", "action": "changed", "fields": []string{"completed"}}, {"resource_type": "task", "action": "deleted"}},
		}}
		st, err := s.callJSON(ctx, http.MethodPost, base+"/webhooks", a.hdr(token), body, &made)
		if err != nil || (st != http.StatusOK && st != http.StatusCreated) {
			return nil, ErrInvalid("Asana could not register the notification address. The API must be reachable from the internet on an https address (PUBLIC_API_URL)")
		}
		var cur asanaCreds
		if _, _, err := s.loadTracker(ctx, t.WorkspaceID, "asana", &cur, nil); err != nil || cur.Secret == "" {
			return nil, ErrInvalid("Asana did not complete its handshake with the notification address")
		}
		return map[string]any{"webhookId": made.Data.GID}, nil
	}
	res.Note = "Asana now sends a notification to this server when a task in the project is completed, reopened or deleted; nothing else to set up."
	return res, nil
}

func (a asanaDriver) Create(ctx context.Context, s *Service, ws uuid.UUID, title, body string) (madeIssue, error) {
	var creds asanaCreds
	var set asanaSettings
	if _, _, err := s.loadTracker(ctx, ws, "asana", &creds, &set); err != nil {
		return madeIssue{}, err
	}
	var made struct {
		Data struct {
			GID string `json:"gid"`
			URL string `json:"permalink_url"`
		} `json:"data"`
	}
	req := map[string]any{"data": map[string]any{"name": title, "notes": body, "projects": []string{set.ProjectID}}}
	st, err := s.callJSON(ctx, http.MethodPost, s.Asana.api()+"/tasks", a.hdr(creds.Token), req, &made)
	if err != nil {
		return madeIssue{}, err
	}
	if st == http.StatusUnauthorized {
		s.markBroken(ctx, ws, "asana", "Asana no longer accepts the token")
		return madeIssue{}, ErrNeedsReconnect
	}
	if (st != http.StatusOK && st != http.StatusCreated) || !gidRe.MatchString(made.Data.GID) {
		return madeIssue{}, ErrInvalid("Asana did not create the task; check the token can create tasks in that project")
	}
	s.markOK(ctx, ws, "asana")
	return madeIssue{Repo: set.ProjectID, Ref: made.Data.GID, URL: made.Data.URL, UpdatedAt: s.now().Add(-time.Second)}, nil
}

func (a asanaDriver) Check(ctx context.Context, s *Service, ws uuid.UUID) error {
	var creds asanaCreds
	var set asanaSettings
	if _, _, err := s.loadTracker(ctx, ws, "asana", &creds, &set); err != nil {
		return err
	}
	st, err := s.callJSON(ctx, http.MethodGet, s.Asana.api()+"/projects/"+set.ProjectID, a.hdr(creds.Token), nil, nil)
	if err != nil {
		return err
	}
	if st == http.StatusUnauthorized || st == http.StatusNotFound || st == http.StatusForbidden {
		s.markBroken(ctx, ws, "asana", "Asana no longer accepts the token or the project is out of reach")
		return ErrNeedsReconnect
	}
	return nil
}

func (a asanaDriver) Disconnect(ctx context.Context, s *Service, ws uuid.UUID) {
	var creds asanaCreds
	var set asanaSettings
	if _, _, err := s.loadTracker(ctx, ws, "asana", &creds, &set); err != nil || set.WebhookID == "" {
		return
	}
	_, _ = s.callJSON(ctx, http.MethodDelete, s.Asana.api()+"/webhooks/"+set.WebhookID, a.hdr(creds.Token), nil, nil)
}

func (a asanaDriver) Event(ctx context.Context, s *Service, ws uuid.UUID, r EventRequest) (EventResult, error) {
	var creds asanaCreds
	var set asanaSettings
	if _, _, err := s.loadTracker(ctx, ws, "asana", &creds, &set); err != nil {
		return EventResult{}, ErrBadSignature
	}
	// The handshake: Asana introduces its signing secret once, right after we ask it to register the address.
	// It is accepted only in the short window after connecting and only if no secret is known yet, so nobody
	// can replace it later.
	if intro := r.Header.Get("X-Hook-Secret"); intro != "" {
		if creds.Secret != "" || creds.Pending < s.now().Unix() || len(intro) > 200 {
			return EventResult{}, ErrBadSignature
		}
		creds.Secret, creds.Pending = intro, 0
		raw, _ := json.Marshal(creds)
		t := system(ws, store.RoleAdmin)
		if err := s.replaceCreds(ctx, t, "asana", raw); err != nil {
			return EventResult{}, err
		}
		return EventResult{Reply: map[string]string{"X-Hook-Secret": intro}}, nil
	}
	if creds.Secret == "" || !sameHex(hmacHex(creds.Secret, r.Body), r.Header.Get("X-Hook-Signature")) {
		return EventResult{}, ErrBadSignature
	}
	var body struct {
		Events []struct {
			Action    string `json:"action"`
			CreatedAt string `json:"created_at"`
			Resource  struct {
				GID  string `json:"gid"`
				Type string `json:"resource_type"`
			} `json:"resource"`
			Change struct {
				Field string `json:"field"`
			} `json:"change"`
		} `json:"events"`
	}
	if err := json.Unmarshal(r.Body, &body); err != nil {
		return EventResult{}, ErrInvalid("not an event")
	}
	sum := digest(r.Body)
	var out EventResult
	for i, e := range body.Events {
		if e.Resource.Type != "task" || !gidRe.MatchString(e.Resource.GID) {
			continue
		}
		at, _ := time.Parse(time.RFC3339, e.CreatedAt)
		ev := issueEvent{Repo: set.ProjectID, Ref: e.Resource.GID, At: at, Delivery: clip(sum+"-"+itoa(i), 100)}
		switch {
		case e.Action == "deleted":
			ev.State = "deleted"
		case e.Action == "changed" && e.Change.Field == "completed":
			// the notification does not say which way: ask Asana
			var t struct {
				Data struct {
					Completed bool `json:"completed"`
				} `json:"data"`
			}
			st, err := s.callJSON(ctx, http.MethodGet, s.Asana.api()+"/tasks/"+e.Resource.GID+"?opt_fields=completed", a.hdr(creds.Token), nil, &t)
			if err != nil || st != http.StatusOK {
				return EventResult{}, err // let Asana try again
			}
			ev.State = "open"
			if t.Data.Completed {
				ev.State = "closed"
			}
		default:
			continue
		}
		out.Events = append(out.Events, ev)
	}
	return out, nil
}
