package integrations

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"product/api/internal/store"
)

// AzureConfig is where Azure DevOps lives.
type AzureConfig struct {
	APIBase string // default https://dev.azure.com
}

func (c AzureConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://dev.azure.com"
}

var (
	adoOrgRe     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,48}$`)
	adoProjectRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$`)
	adoTypeRe    = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 ]{0,39}$`)
)

const defaultDoneStates = "Done, Closed, Resolved, Completed"

type azureDriver struct{}

func (azureDriver) Kind() string { return "azuredevops" }
func (azureDriver) Name() string { return "Azure DevOps" }
func (azureDriver) Intro() string {
	return "Open a work item in one Azure DevOps project for a request from its page. When the work item moves to a done state or back, the request can follow. Work items carry only the request's title and counts, never customer quotes, names or emails. Azure DevOps Services only (dev.azure.com)."
}
func (azureDriver) Fields() []FieldSpec {
	return []FieldSpec{
		{Name: "organization", Label: "Organization", Help: "The name after dev.azure.com/ in your address."},
		{Name: "project", Label: "Project"},
		{Name: "workItemType", Label: "Work item type", Optional: true, Help: "For example Task, Bug or Issue. Task if left empty."},
		{Name: "doneStates", Label: "States that mean done", Optional: true, Help: "Comma separated. " + defaultDoneStates + " if left empty."},
		{Name: "token", Label: "Personal access token", Secret: true, Help: "Make one under your user settings with the Work Items (read & write) scope only. It acts as you. It is stored encrypted and never shown again."},
	}
}

type azureCreds struct {
	Token  string `json:"token"`
	Secret string `json:"secret"`
}

type azureSettings struct {
	Organization string   `json:"organization"`
	Project      string   `json:"project"`
	WorkItemType string   `json:"workItemType"`
	DoneStates   []string `json:"doneStates"`
}

func adoHeader(token string) map[string]string {
	r := &http.Request{Header: http.Header{}}
	r.SetBasicAuth("", token)
	return map[string]string{"Authorization": r.Header.Get("Authorization")}
}

func (a azureDriver) Connect(ctx context.Context, s *Service, t store.Tenant, in map[string]string) (connectResult, error) {
	org, project, token := in["organization"], in["project"], in["token"]
	typ := in["workItemType"]
	if typ == "" {
		typ = "Task"
	}
	if !adoOrgRe.MatchString(org) {
		return connectResult{}, ErrInvalid("the organization is the name after dev.azure.com/ in your address")
	}
	if !adoProjectRe.MatchString(project) {
		return connectResult{}, ErrInvalid("enter the project name")
	}
	if !adoTypeRe.MatchString(typ) {
		return connectResult{}, ErrInvalid("the work item type is a name such as Task or Bug")
	}
	if l := len(token); l < 10 || l > 300 {
		return connectResult{}, ErrInvalid("paste the personal access token")
	}
	done := []string{}
	for _, d := range strings.Split(firstNonEmpty(in["doneStates"], defaultDoneStates), ",") {
		if d = strings.TrimSpace(d); d != "" && len(d) <= 40 {
			done = append(done, d)
		}
	}
	if len(done) == 0 || len(done) > 10 {
		return connectResult{}, ErrInvalid("list between 1 and 10 states that mean done")
	}
	set := azureSettings{Organization: org, Project: project, WorkItemType: typ, DoneStates: done}
	st, err := s.callJSON(ctx, http.MethodGet, s.Azure.api()+"/"+org+"/_apis/projects/"+url.PathEscape(project)+"?api-version=7.1", adoHeader(token), nil, nil)
	if err != nil {
		return connectResult{}, err
	}
	switch {
	case st == http.StatusUnauthorized || st == http.StatusNonAuthoritativeInfo:
		return connectResult{}, ErrInvalid("Azure DevOps did not accept that token")
	case st == http.StatusNotFound || st == http.StatusForbidden:
		return connectResult{}, ErrInvalid("that project was not found, or the token cannot reach it")
	case st != http.StatusOK:
		return connectResult{}, ErrInvalid("Azure DevOps could not check that project; try again")
	}
	secret := randomHex(32)
	res := connectResult{Driver: set, Creds: azureCreds{Token: token, Secret: secret}, Summary: project, Detail: org + " on Azure DevOps"}
	res.Show = []Shown{
		{Label: "URL", Value: s.trackerWebhookURL("azuredevops", t.WorkspaceID)},
		{Label: "Basic authentication user name (anything)", Value: "feedback"},
		{Label: "Basic authentication password", Value: secret, Secret: true},
	}
	res.Note = "One more step, in Azure DevOps (Project settings, Service hooks): make a Web Hooks subscription for the events 'Work item updated' and 'Work item deleted' with the URL and the basic authentication above. Use the project's own service hooks, and keep the URL on https."
	return res, nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (a azureDriver) Create(ctx context.Context, s *Service, ws uuid.UUID, title, body string) (madeIssue, error) {
	var creds azureCreds
	var set azureSettings
	if _, _, err := s.loadTracker(ctx, ws, "azuredevops", &creds, &set); err != nil {
		return madeIssue{}, err
	}
	patch := []map[string]any{
		{"op": "add", "path": "/fields/System.Title", "value": title},
		{"op": "add", "path": "/fields/System.Description", "value": strings.ReplaceAll(html.EscapeString(body), "\n", "<br>")},
	}
	raw, _ := json.Marshal(patch)
	hdr := adoHeader(creds.Token)
	hdr["Content-Type"] = "application/json-patch+json"
	var made struct {
		ID    int `json:"id"`
		Links struct {
			HTML struct {
				Href string `json:"href"`
			} `json:"html"`
		} `json:"_links"`
	}
	u := s.Azure.api() + "/" + set.Organization + "/" + url.PathEscape(set.Project) + "/_apis/wit/workitems/$" + url.PathEscape(set.WorkItemType) + "?api-version=7.1"
	st, err := s.callJSON(ctx, http.MethodPost, u, hdr, raw, &made)
	if err != nil {
		return madeIssue{}, err
	}
	if st == http.StatusUnauthorized || st == http.StatusNonAuthoritativeInfo {
		s.markBroken(ctx, ws, "azuredevops", "Azure DevOps no longer accepts the token")
		return madeIssue{}, ErrNeedsReconnect
	}
	if st != http.StatusOK && st != http.StatusCreated || made.ID <= 0 {
		return madeIssue{}, ErrInvalid("Azure DevOps did not create the work item; check the token can create " + set.WorkItemType + " work items in that project")
	}
	link := made.Links.HTML.Href
	if link == "" {
		link = s.Azure.api() + "/" + set.Organization + "/" + url.PathEscape(set.Project) + "/_workitems/edit/" + itoa(made.ID)
	}
	s.markOK(ctx, ws, "azuredevops")
	return madeIssue{Repo: set.Project, Number: made.ID, URL: link, UpdatedAt: s.now().Add(-time.Second)}, nil
}

func (a azureDriver) Check(ctx context.Context, s *Service, ws uuid.UUID) error {
	var creds azureCreds
	var set azureSettings
	if _, _, err := s.loadTracker(ctx, ws, "azuredevops", &creds, &set); err != nil {
		return err
	}
	st, err := s.callJSON(ctx, http.MethodGet, s.Azure.api()+"/"+set.Organization+"/_apis/projects/"+url.PathEscape(set.Project)+"?api-version=7.1", adoHeader(creds.Token), nil, nil)
	if err != nil {
		return err
	}
	if st != http.StatusOK {
		s.markBroken(ctx, ws, "azuredevops", "Azure DevOps no longer accepts the token or the project is out of reach")
		return ErrNeedsReconnect
	}
	return nil
}

func (a azureDriver) Disconnect(context.Context, *Service, uuid.UUID) {}

func (a azureDriver) Event(ctx context.Context, s *Service, ws uuid.UUID, r EventRequest) (EventResult, error) {
	var creds azureCreds
	var set azureSettings
	if _, _, err := s.loadTracker(ctx, ws, "azuredevops", &creds, &set); err != nil || creds.Secret == "" {
		return EventResult{}, ErrBadSignature
	}
	_, pass, ok := (&http.Request{Header: r.Header}).BasicAuth()
	if !ok || subtle.ConstantTimeCompare([]byte(pass), []byte(creds.Secret)) != 1 {
		return EventResult{}, ErrBadSignature
	}
	var ev struct {
		ID          string `json:"id"`
		EventType   string `json:"eventType"`
		CreatedDate string `json:"createdDate"`
		Resource    struct {
			ID         int `json:"id"`
			WorkItemID int `json:"workItemId"`
			Fields     map[string]struct {
				NewValue string `json:"newValue"`
			} `json:"fields"`
			Revision struct {
				Fields map[string]any `json:"fields"`
			} `json:"revision"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(r.Body, &ev); err != nil {
		return EventResult{}, ErrInvalid("not an event")
	}
	delivery := digest(r.Body)
	if ev.ID != "" {
		delivery = clip(ev.ID, 100)
	}
	at, _ := time.Parse(time.RFC3339, ev.CreatedDate)
	out := issueEvent{Repo: set.Project, At: at, Delivery: delivery}
	switch ev.EventType {
	case "workitem.deleted":
		out.Number, out.State = ev.Resource.ID, "deleted"
	case "workitem.updated":
		out.Number = ev.Resource.WorkItemID
		state := ev.Resource.Fields["System.State"].NewValue
		if state == "" {
			return EventResult{}, nil // an edit that did not change the state
		}
		out.State = "open"
		for _, d := range set.DoneStates {
			if strings.EqualFold(d, state) {
				out.State = "closed"
			}
		}
	default:
		return EventResult{}, nil
	}
	if out.Number <= 0 {
		return EventResult{}, nil
	}
	return EventResult{Events: []issueEvent{out}}, nil
}
