package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"product/api/internal/store"
)

// ClickUpConfig is where ClickUp's API lives.
type ClickUpConfig struct {
	APIBase string // default https://api.clickup.com/api/v2
}

func (c ClickUpConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://api.clickup.com/api/v2"
}

var (
	digitsRe = regexp.MustCompile(`^[0-9]{3,20}$`)
	cuTaskRe = regexp.MustCompile(`^[A-Za-z0-9_-]{3,40}$`)
)

type clickupDriver struct{}

func (clickupDriver) Kind() string { return "clickup" }
func (clickupDriver) Name() string { return "ClickUp" }
func (clickupDriver) Intro() string {
	return "Open a task in one ClickUp list for a request from its page. When the task's status becomes done or closed, or it is reopened, the request can follow. Tasks carry only the request's title and counts, never customer quotes, names or emails."
}
func (clickupDriver) Fields() []FieldSpec {
	return []FieldSpec{
		{Name: "listId", Label: "List ID", Help: "The number in the list's address in ClickUp. New tasks are created in this list."},
		{Name: "token", Label: "Personal API token", Secret: true, Help: "Make one in ClickUp under your profile's apps settings. It acts as you, so use an account that can create tasks in the list. It is stored encrypted and never shown again."},
		{Name: "teamId", Label: "Workspace ID", Optional: true, Help: "Only needed if your account belongs to several ClickUp workspaces; otherwise the first is used."},
	}
}

type clickupCreds struct {
	Token  string `json:"token"`
	Secret string `json:"secret"`
}

type clickupSettings struct {
	ListID    string `json:"listId"`
	TeamID    string `json:"teamId"`
	WebhookID string `json:"webhookId,omitempty"`
}

func (c clickupDriver) hdr(token string) map[string]string {
	return map[string]string{"Authorization": token}
}

func (c clickupDriver) Connect(ctx context.Context, s *Service, t store.Tenant, in map[string]string) (connectResult, error) {
	list, token, team := in["listId"], in["token"], in["teamId"]
	if !digitsRe.MatchString(list) {
		return connectResult{}, ErrInvalid("the list ID is the number in the list's address")
	}
	if l := len(token); l < 10 || l > 300 {
		return connectResult{}, ErrInvalid("paste the personal API token")
	}
	if team != "" && !digitsRe.MatchString(team) {
		return connectResult{}, ErrInvalid("the workspace ID is a number")
	}
	base := s.ClickUp.api()
	var l struct {
		Name string `json:"name"`
	}
	st, err := s.callJSON(ctx, http.MethodGet, base+"/list/"+list, c.hdr(token), nil, &l)
	if err != nil {
		return connectResult{}, err
	}
	switch {
	case st == http.StatusUnauthorized:
		return connectResult{}, ErrInvalid("ClickUp did not accept that token")
	case st == http.StatusNotFound || st == http.StatusForbidden:
		return connectResult{}, ErrInvalid("that list was not found, or the token cannot reach it")
	case st != http.StatusOK:
		return connectResult{}, ErrInvalid("ClickUp could not check that list; try again")
	}
	if team == "" {
		var teams struct {
			Teams []struct {
				ID string `json:"id"`
			} `json:"teams"`
		}
		if st, err := s.callJSON(ctx, http.MethodGet, base+"/team", c.hdr(token), nil, &teams); err != nil || st != http.StatusOK || len(teams.Teams) == 0 {
			return connectResult{}, ErrInvalid("could not find the ClickUp workspace; enter its ID")
		}
		team = teams.Teams[0].ID
	}
	if !digitsRe.MatchString(team) {
		return connectResult{}, ErrInvalid("the workspace ID is a number")
	}
	creds := clickupCreds{Token: token}
	set := clickupSettings{ListID: list, TeamID: team}
	res := connectResult{Driver: set, Creds: creds, Summary: l.Name, Detail: "ClickUp list " + list}
	res.After = func(ctx context.Context) (map[string]any, error) {
		var made struct {
			ID      string `json:"id"`
			Secret  string `json:"secret"`
			Webhook struct {
				ID     string `json:"id"`
				Secret string `json:"secret"`
			} `json:"webhook"`
		}
		body := map[string]any{"endpoint": s.trackerWebhookURL("clickup", t.WorkspaceID), "events": []string{"taskStatusUpdated", "taskDeleted"}, "list_id": list}
		st, err := s.callJSON(ctx, http.MethodPost, base+"/team/"+team+"/webhook", c.hdr(token), body, &made)
		if err != nil || (st != http.StatusOK && st != http.StatusCreated) {
			return nil, ErrInvalid("ClickUp could not register the notification address. The API must be reachable from the internet on an https address (PUBLIC_API_URL)")
		}
		secret, id := made.Secret, made.ID
		if secret == "" {
			secret = made.Webhook.Secret
		}
		if id == "" {
			id = made.Webhook.ID
		}
		if secret == "" {
			return nil, ErrInvalid("ClickUp did not give a signing secret for the notification address")
		}
		creds.Secret = secret
		raw, _ := json.Marshal(creds)
		if err := s.replaceCreds(ctx, t, "clickup", raw); err != nil {
			return nil, err
		}
		return map[string]any{"webhookId": id}, nil
	}
	res.Note = "ClickUp now sends a notification to this server when a task's status changes or a task is deleted; nothing else to set up."
	return res, nil
}

func (c clickupDriver) Create(ctx context.Context, s *Service, ws uuid.UUID, title, body string) (madeIssue, error) {
	var creds clickupCreds
	var set clickupSettings
	if _, _, err := s.loadTracker(ctx, ws, "clickup", &creds, &set); err != nil {
		return madeIssue{}, err
	}
	var made struct {
		ID          string `json:"id"`
		URL         string `json:"url"`
		DateUpdated string `json:"date_updated"`
	}
	st, err := s.callJSON(ctx, http.MethodPost, s.ClickUp.api()+"/list/"+set.ListID+"/task", c.hdr(creds.Token), map[string]any{"name": title, "description": body}, &made)
	if err != nil {
		return madeIssue{}, err
	}
	if st == http.StatusUnauthorized {
		s.markBroken(ctx, ws, "clickup", "ClickUp no longer accepts the token")
		return madeIssue{}, ErrNeedsReconnect
	}
	if (st != http.StatusOK && st != http.StatusCreated) || !cuTaskRe.MatchString(made.ID) {
		return madeIssue{}, ErrInvalid("ClickUp did not create the task; check the token can create tasks in that list")
	}
	at := s.now().Add(-time.Second)
	if ms, err := strconv.ParseInt(made.DateUpdated, 10, 64); err == nil && ms > 0 {
		at = time.UnixMilli(ms)
	}
	s.markOK(ctx, ws, "clickup")
	return madeIssue{Repo: set.ListID, Ref: made.ID, URL: made.URL, UpdatedAt: at}, nil
}

func (c clickupDriver) Check(ctx context.Context, s *Service, ws uuid.UUID) error {
	var creds clickupCreds
	var set clickupSettings
	if _, _, err := s.loadTracker(ctx, ws, "clickup", &creds, &set); err != nil {
		return err
	}
	st, err := s.callJSON(ctx, http.MethodGet, s.ClickUp.api()+"/list/"+set.ListID, c.hdr(creds.Token), nil, nil)
	if err != nil {
		return err
	}
	if st == http.StatusUnauthorized || st == http.StatusNotFound || st == http.StatusForbidden {
		s.markBroken(ctx, ws, "clickup", "ClickUp no longer accepts the token or the list is out of reach")
		return ErrNeedsReconnect
	}
	return nil
}

func (c clickupDriver) Disconnect(ctx context.Context, s *Service, ws uuid.UUID) {
	var creds clickupCreds
	var set clickupSettings
	if _, _, err := s.loadTracker(ctx, ws, "clickup", &creds, &set); err != nil || set.WebhookID == "" {
		return
	}
	_, _ = s.callJSON(ctx, http.MethodDelete, s.ClickUp.api()+"/webhook/"+set.WebhookID, c.hdr(creds.Token), nil, nil)
}

func (c clickupDriver) Event(ctx context.Context, s *Service, ws uuid.UUID, r EventRequest) (EventResult, error) {
	var creds clickupCreds
	var set clickupSettings
	if _, _, err := s.loadTracker(ctx, ws, "clickup", &creds, &set); err != nil || creds.Secret == "" {
		return EventResult{}, ErrBadSignature
	}
	if !sameHex(hmacHex(creds.Secret, r.Body), r.Header.Get("X-Signature")) {
		return EventResult{}, ErrBadSignature
	}
	var ev struct {
		Event        string `json:"event"`
		TaskID       string `json:"task_id"`
		WebhookID    string `json:"webhook_id"`
		HistoryItems []struct {
			ID    string `json:"id"`
			Date  string `json:"date"`
			Field string `json:"field"`
			After struct {
				Type string `json:"type"`
			} `json:"after"`
		} `json:"history_items"`
	}
	if err := json.Unmarshal(r.Body, &ev); err != nil {
		return EventResult{}, ErrInvalid("not an event")
	}
	if !cuTaskRe.MatchString(ev.TaskID) {
		return EventResult{}, nil
	}
	delivery := digest(r.Body)
	var at time.Time
	if len(ev.HistoryItems) > 0 {
		if ev.HistoryItems[0].ID != "" {
			delivery = clip(ev.WebhookID+":"+ev.HistoryItems[0].ID, 100)
		}
		if ms, err := strconv.ParseInt(ev.HistoryItems[0].Date, 10, 64); err == nil && ms > 0 {
			at = time.UnixMilli(ms)
		}
	}
	state := ""
	switch ev.Event {
	case "taskDeleted":
		state = "deleted"
	case "taskStatusUpdated":
		state = "open"
		if len(ev.HistoryItems) > 0 && (ev.HistoryItems[0].After.Type == "done" || ev.HistoryItems[0].After.Type == "closed") {
			state = "closed"
		}
	default:
		return EventResult{}, nil
	}
	return EventResult{Events: []issueEvent{{Repo: set.ListID, Ref: ev.TaskID, State: state, At: at, Delivery: delivery}}}, nil
}
