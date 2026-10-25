package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// JiraConfig is where Jira's API lives. Normally empty: the address is built from the site name the admin gives
// (always a *.atlassian.net host, never one typed in full). APIBase replaces it for development stand-ins.
type JiraConfig struct {
	APIBase string
}

var (
	siteRe      = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	jiraProjRe  = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,19}$`)
	jiraKeyRe   = regexp.MustCompile(`^([A-Z][A-Z0-9_]{1,19})-([0-9]{1,9})$`)
	jiraIssueRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 _-]{0,59}$`)
	jiraEmailRe = regexp.MustCompile(`^[^\s@]{1,100}@[^\s@]{1,200}$`)
)

type jiraCreds struct {
	Email         string `json:"email"`
	Token         string `json:"token"`
	WebhookSecret string `json:"webhookSecret"`
}

type jiraConfig struct {
	Site           string `json:"site"` // the part before .atlassian.net
	Project        string `json:"project"`
	IssueType      string `json:"issueType"`
	CloseStatusID  string `json:"closeStatusId,omitempty"`
	ReopenStatusID string `json:"reopenStatusId,omitempty"`
}

func (c JiraConfig) base(site string) string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://" + site + ".atlassian.net"
}

func (s *Service) jiraWebhookURL(ws uuid.UUID) string {
	return strings.TrimRight(s.GitHub.APIURL, "/") + "/v1/integrations/jira/" + ws.String() + "/events"
}

// cleanSite turns "acme", "acme.atlassian.net" or "https://acme.atlassian.net/jira" into "acme", and refuses
// anything else, so a person can never point the server at a host of their choosing.
func cleanSite(in string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(in))
	v = strings.TrimPrefix(strings.TrimPrefix(v, "https://"), "http://")
	if i := strings.IndexAny(v, "/?#"); i >= 0 {
		v = v[:i]
	}
	v = strings.TrimSuffix(v, ".atlassian.net")
	if !siteRe.MatchString(v) {
		return "", ErrInvalid("the site is the first part of your Jira address, for example acme in acme.atlassian.net")
	}
	return v, nil
}

type JiraInput struct {
	Site, Email, Token, Project, IssueType string
	CloseStatusID, ReopenStatusID          *uuid.UUID
}

type JiraSetup struct {
	WebhookURL    string
	WebhookSecret string // shown once: it goes into Jira's webhook settings
}

type jiraAuthError struct{}

func (jiraAuthError) Error() string { return "Jira did not accept that email and API token" }

// jiraDo makes one call. Basic auth with the account's email and an API token, as Atlassian documents.
func (s *Service) jiraDo(ctx context.Context, site string, creds jiraCreds, method, path string, body, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.Jira.base(site)+path, rdr)
	if err != nil {
		return 0, err
	}
	req.SetBasicAuth(creds.Email, creds.Token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "feedback-app")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := s.client().Do(req)
	if err != nil {
		return 0, fmt.Errorf("could not reach Jira")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusUnauthorized {
		return res.StatusCode, jiraAuthError{}
	}
	if out != nil && res.StatusCode < 300 {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.StatusCode, fmt.Errorf("Jira answered in a way we could not read")
		}
	}
	return res.StatusCode, nil
}

// JiraConnect (admins only) connects one Jira Cloud project using an API token. The account and project are
// checked before anything is stored. The signing secret for Jira's webhook is made here and shown once.
func (s *Service) JiraConnect(ctx context.Context, t store.Tenant, in JiraInput) (JiraSetup, error) {
	if !t.Can(store.PermManage) {
		return JiraSetup{}, store.ErrForbidden
	}
	if err := s.ready(); err != nil {
		return JiraSetup{}, err
	}
	if err := s.noOtherTracker(ctx, t, "jira"); err != nil {
		return JiraSetup{}, err
	}
	site, err := cleanSite(in.Site)
	if err != nil {
		return JiraSetup{}, err
	}
	project := strings.ToUpper(strings.TrimSpace(in.Project))
	if !jiraProjRe.MatchString(project) {
		return JiraSetup{}, ErrInvalid("the project key is the short prefix of its issues, for example PROJ")
	}
	issueType := strings.TrimSpace(in.IssueType)
	if issueType == "" {
		issueType = "Task"
	}
	if !jiraIssueRe.MatchString(issueType) {
		return JiraSetup{}, ErrInvalid("the issue type is a name such as Task or Story")
	}
	email, token := strings.TrimSpace(in.Email), strings.TrimSpace(in.Token)
	if !jiraEmailRe.MatchString(email) {
		return JiraSetup{}, ErrInvalid("enter the email address of the Atlassian account the token belongs to")
	}
	if l := len(token); l < 10 || l > 500 {
		return JiraSetup{}, ErrInvalid("paste the API token")
	}
	if err := s.validStatus(ctx, t, in.CloseStatusID); err != nil {
		return JiraSetup{}, err
	}
	if err := s.validStatus(ctx, t, in.ReopenStatusID); err != nil {
		return JiraSetup{}, err
	}
	creds := jiraCreds{Email: email, Token: token}
	status, err := s.jiraDo(ctx, site, creds, http.MethodGet, "/rest/api/2/project/"+url.PathEscape(project), nil, nil)
	var auth jiraAuthError
	switch {
	case errors.As(err, &auth):
		return JiraSetup{}, ErrInvalid(auth.Error())
	case err != nil:
		return JiraSetup{}, err
	case status == http.StatusNotFound || status == http.StatusForbidden:
		return JiraSetup{}, ErrInvalid("that project was not found, or the account cannot see it")
	case status != http.StatusOK:
		return JiraSetup{}, ErrInvalid("Jira could not check that project; try again")
	}
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)
	creds.WebhookSecret = hex.EncodeToString(secret)
	cfg := jiraConfig{Site: site, Project: project, IssueType: issueType}
	if in.CloseStatusID != nil {
		cfg.CloseStatusID = in.CloseStatusID.String()
	}
	if in.ReopenStatusID != nil {
		cfg.ReopenStatusID = in.ReopenStatusID.String()
	}
	rawCreds, _ := json.Marshal(creds)
	rawCfg, _ := json.Marshal(cfg)
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: "jira", Config: rawCfg,
			Secret: s.Box.Seal(rawCreds, owner(t.WorkspaceID, "jira")), ConnectedBy: t.UserID,
		})
	})
	if err != nil {
		return JiraSetup{}, err
	}
	return JiraSetup{WebhookURL: s.jiraWebhookURL(t.WorkspaceID), WebhookSecret: creds.WebhookSecret}, nil
}

type JiraInfo struct {
	Site, Project, IssueType string
	State                    string
	WebhookURL               string
	CloseStatusID            *uuid.UUID
	ReopenStatusID           *uuid.UUID
}

func (s *Service) JiraInfo(ctx context.Context, t store.Tenant) (JiraInfo, error) {
	if !t.Can(store.PermManage) {
		return JiraInfo{}, store.ErrForbidden
	}
	var out JiraInfo
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "jira"})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotConnected
		}
		if err != nil {
			return err
		}
		var cfg jiraConfig
		_ = json.Unmarshal(row.Config, &cfg)
		out = JiraInfo{Site: cfg.Site, Project: cfg.Project, IssueType: cfg.IssueType, State: row.State, WebhookURL: s.jiraWebhookURL(t.WorkspaceID),
			CloseStatusID: parseUUID(cfg.CloseStatusID), ReopenStatusID: parseUUID(cfg.ReopenStatusID)}
		return nil
	})
	return out, err
}

// JiraSetMapping (admins only) chooses which status a request moves to when its issue is done or reopened.
func (s *Service) JiraSetMapping(ctx context.Context, t store.Tenant, closeID, reopenID *uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	if err := s.validStatus(ctx, t, closeID); err != nil {
		return err
	}
	if err := s.validStatus(ctx, t, reopenID); err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "jira"})
		if err != nil {
			return ErrNotConnected
		}
		var cfg jiraConfig
		_ = json.Unmarshal(row.Config, &cfg)
		cfg.CloseStatusID, cfg.ReopenStatusID = "", ""
		if closeID != nil {
			cfg.CloseStatusID = closeID.String()
		}
		if reopenID != nil {
			cfg.ReopenStatusID = reopenID.String()
		}
		b, _ := json.Marshal(cfg)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: "jira", Config: b})
		return err
	})
}

// jiraCall is jiraDo as the connected workspace; a token Jira refuses marks the connection as needing to be
// set up again.
func (s *Service) jiraCall(ctx context.Context, ws uuid.UUID, method, path string, body, out any) (int, jiraConfig, error) {
	var creds jiraCreds
	row, err := s.load(ctx, ws, "jira", &creds)
	if err != nil {
		return 0, jiraConfig{}, err
	}
	var cfg jiraConfig
	_ = json.Unmarshal(row.Config, &cfg)
	if row.State == "needs_reconnect" {
		return 0, cfg, ErrNeedsReconnect
	}
	status, err := s.jiraDo(ctx, cfg.Site, creds, method, strings.ReplaceAll(path, "{project}", url.PathEscape(cfg.Project)), body, out)
	var auth jiraAuthError
	if errors.As(err, &auth) {
		s.markBroken(ctx, ws, "jira", "Jira no longer accepts the token")
		return status, cfg, ErrNeedsReconnect
	}
	if err != nil {
		return status, cfg, err
	}
	if status == http.StatusOK || status == http.StatusCreated {
		s.markOK(ctx, ws, "jira")
	}
	return status, cfg, nil
}

// JiraCheck asks Jira whether the token still reaches the project.
func (s *Service) JiraCheck(ctx context.Context, t store.Tenant) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	status, _, err := s.jiraCall(ctx, t.WorkspaceID, http.MethodGet, "/rest/api/2/project/{project}", nil, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound || status == http.StatusForbidden {
		s.markBroken(ctx, t.WorkspaceID, "jira", "the project was not found, or the account cannot see it")
		return ErrNeedsReconnect
	}
	return nil
}

func (s *Service) jiraCreate(ctx context.Context, ws uuid.UUID, title, body string) (madeIssue, error) {
	var created struct {
		Key string `json:"key"`
	}
	var cfg jiraConfig
	var creds jiraCreds
	row, err := s.load(ctx, ws, "jira", &creds)
	if err != nil {
		return madeIssue{}, err
	}
	_ = json.Unmarshal(row.Config, &cfg)
	title = strings.Join(strings.Fields(title), " ") // a Jira summary is a single line
	fields := map[string]any{
		"project":     map[string]string{"key": cfg.Project},
		"issuetype":   map[string]string{"name": cfg.IssueType},
		"summary":     title,
		"description": body,
	}
	code, _, err := s.jiraCall(ctx, ws, http.MethodPost, "/rest/api/2/issue", map[string]any{"fields": fields}, &created)
	if err != nil {
		return madeIssue{}, err
	}
	m := jiraKeyRe.FindStringSubmatch(created.Key)
	if code != http.StatusCreated || m == nil {
		return madeIssue{}, ErrInvalid("Jira did not create the issue; check the account can create " + cfg.IssueType + " issues in that project")
	}
	n, _ := strconv.Atoi(m[2])
	return madeIssue{Repo: m[1], Number: n, URL: "https://" + cfg.Site + ".atlassian.net/browse/" + created.Key, UpdatedAt: s.now().Add(-time.Second)}, nil
}

// ---- the issue changing in Jira ----

type jiraEvent struct {
	WebhookEvent string  `json:"webhookEvent"`
	Timestamp    float64 `json:"timestamp"`
	Issue        struct {
		Key    string `json:"key"`
		Fields struct {
			Status struct {
				StatusCategory struct {
					Key string `json:"key"`
				} `json:"statusCategory"`
			} `json:"status"`
		} `json:"fields"`
	} `json:"issue"`
}

const jiraMaxBody = 1 << 20

// JiraEvent handles a notification from Jira for a workspace. The signature (X-Hub-Signature, sha256 of the exact
// bytes under the secret made at connection) is checked first; a delivery is acted on once (Jira repeats the
// same identifier on retries and can retry for over an hour, so there is no short time window); an older
// notification than what the link already knows is ignored. Only a change between done and not done counts.
func (s *Service) JiraEvent(ctx context.Context, ws uuid.UUID, body []byte, delivery, signature string) error {
	if len(body) > jiraMaxBody || delivery == "" || len(delivery) > 100 {
		return ErrBadSignature
	}
	var creds jiraCreds
	row, err := s.load(ctx, ws, "jira", &creds)
	if err != nil {
		return ErrBadSignature
	}
	m := hmac.New(sha256.New, []byte(creds.WebhookSecret))
	m.Write(body)
	if !hmac.Equal([]byte("sha256="+hex.EncodeToString(m.Sum(nil))), []byte(strings.ToLower(signature))) {
		return ErrBadSignature
	}
	var ev jiraEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return ErrInvalid("not an event")
	}
	var cfg jiraConfig
	_ = json.Unmarshal(row.Config, &cfg)
	km := jiraKeyRe.FindStringSubmatch(ev.Issue.Key)
	if km == nil || km[1] != cfg.Project {
		return nil
	}
	number, _ := strconv.Atoi(km[2])
	state := ""
	switch ev.WebhookEvent {
	case "jira:issue_deleted":
		state = "deleted"
	case "jira:issue_updated":
		state = "open"
		if ev.Issue.Fields.Status.StatusCategory.Key == "done" {
			state = "closed"
		}
	default:
		return nil
	}
	at := s.now()
	if ev.Timestamp > 0 {
		at = time.UnixMilli(int64(ev.Timestamp))
	}
	return s.applyIssueEvent(ctx, issueEvent{
		Ws: ws, Tracker: "jira", Name: "Jira", Repo: cfg.Project, Number: number, State: state, At: at, Delivery: delivery,
		CloseID: cfg.CloseStatusID, ReopenID: cfg.ReopenStatusID, OnlyOnChange: true,
	})
}
