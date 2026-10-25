package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// LinearConfig is where the tracker's API lives.
type LinearConfig struct {
	APIBase string // default https://api.linear.app
}

func (c LinearConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://api.linear.app"
}

var teamKeyRe = regexp.MustCompile(`^[A-Z0-9]{1,10}$`)

type linearCreds struct {
	Token string `json:"token"`
	// WebhookSecret is the signing secret Linear shows when the webhook is made there; the admin pastes it
	// in. Until then changes made in Linear are not followed (they cannot be checked).
	WebhookSecret string `json:"webhookSecret,omitempty"`
}

type linearConfig struct {
	TeamKey        string `json:"teamKey"`
	TeamID         string `json:"teamId"`
	TeamName       string `json:"teamName,omitempty"`
	CloseStatusID  string `json:"closeStatusId,omitempty"`
	ReopenStatusID string `json:"reopenStatusId,omitempty"`
}

func (s *Service) linearWebhookURL(ws uuid.UUID) string {
	return strings.TrimRight(s.GitHub.APIURL, "/") + "/v1/integrations/linear/" + ws.String() + "/events"
}

// ---- which tracker ----

// activeTracker says which issue tracker the workspace has connected. Only one can be.
func (s *Service) activeTracker(ctx context.Context, ws uuid.UUID) (string, error) {
	var found string
	err := store.WithTenant(ctx, s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
		rows, err := q.ListIntegrations(ctx, ws)
		for _, r := range rows {
			if _, isTracker := trackerNames[r.Kind]; isTracker && s.On(r.Kind) {
				found = r.Kind
			}
		}
		return err
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", ErrNotConnected
	}
	return found, nil
}

// trackerNames are the issue trackers a workspace can connect, one at a time.
var trackerNames = map[string]string{"github": "GitHub", "linear": "Linear", "jira": "Jira"}

// noOtherTracker refuses to connect one tracker while another is connected.
func (s *Service) noOtherTracker(ctx context.Context, t store.Tenant, mine string) error {
	other := ""
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListIntegrations(ctx, t.WorkspaceID)
		for _, r := range rows {
			if _, isTracker := trackerNames[r.Kind]; isTracker && r.Kind != mine {
				other = trackerNames[r.Kind]
			}
		}
		return err
	})
	if err != nil {
		return err
	}
	if other != "" {
		return ErrInvalid(other + " is already connected as the issue tracker. Disconnect it first; a workspace uses one tracker at a time")
	}
	return nil
}

// ---- connecting ----

type LinearInput struct {
	Token          string
	TeamKey        string
	CloseStatusID  *uuid.UUID
	ReopenStatusID *uuid.UUID
}

type LinearSetup struct {
	WebhookURL string
}

// LinearConnect (admins only) connects one Linear team using a personal API key the admin made for it. The
// key is checked against the team before anything is stored.
func (s *Service) LinearConnect(ctx context.Context, t store.Tenant, in LinearInput) (LinearSetup, error) {
	if t.Role != store.RoleAdmin {
		return LinearSetup{}, store.ErrForbidden
	}
	if err := s.ready(); err != nil {
		return LinearSetup{}, err
	}
	if err := s.noOtherTracker(ctx, t, "linear"); err != nil {
		return LinearSetup{}, err
	}
	key := strings.ToUpper(strings.TrimSpace(in.TeamKey))
	if !teamKeyRe.MatchString(key) {
		return LinearSetup{}, ErrInvalid("the team key is the short prefix of its issues, for example ENG")
	}
	token := strings.TrimSpace(in.Token)
	if l := len(token); l < 10 || l > 300 {
		return LinearSetup{}, ErrInvalid("paste the API key")
	}
	if err := s.validStatus(ctx, t, in.CloseStatusID); err != nil {
		return LinearSetup{}, err
	}
	if err := s.validStatus(ctx, t, in.ReopenStatusID); err != nil {
		return LinearSetup{}, err
	}
	var out struct {
		Teams struct {
			Nodes []struct {
				ID, Key, Name string
			} `json:"nodes"`
		} `json:"teams"`
	}
	if err := s.linearDo(ctx, token, `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id key name } } }`, map[string]any{"key": key}, &out); err != nil {
		var auth linearAuthError
		if errors.As(err, &auth) {
			return LinearSetup{}, ErrInvalid(auth.Error())
		}
		return LinearSetup{}, err
	}
	if len(out.Teams.Nodes) == 0 {
		return LinearSetup{}, ErrInvalid("that team was not found, or the key cannot reach it")
	}
	team := out.Teams.Nodes[0]
	cfg := linearConfig{TeamKey: strings.ToUpper(team.Key), TeamID: team.ID, TeamName: clip(team.Name, 100)}
	if in.CloseStatusID != nil {
		cfg.CloseStatusID = in.CloseStatusID.String()
	}
	if in.ReopenStatusID != nil {
		cfg.ReopenStatusID = in.ReopenStatusID.String()
	}
	rawCreds, _ := json.Marshal(linearCreds{Token: token})
	rawCfg, _ := json.Marshal(cfg)
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: "linear", Config: rawCfg,
			Secret: s.Box.Seal(rawCreds, owner(t.WorkspaceID, "linear")), ConnectedBy: t.UserID,
		})
	})
	if err != nil {
		return LinearSetup{}, err
	}
	return LinearSetup{WebhookURL: s.linearWebhookURL(t.WorkspaceID)}, nil
}

// LinearSetSecret (admins only) stores the signing secret Linear showed for the webhook, so changes made in
// Linear can be checked and followed.
func (s *Service) LinearSetSecret(ctx context.Context, t store.Tenant, secret string) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	secret = strings.TrimSpace(secret)
	if l := len(secret); l < 8 || l > 200 {
		return ErrInvalid("paste the signing secret Linear shows for the webhook")
	}
	var creds linearCreds
	row, err := s.load(ctx, t.WorkspaceID, "linear", &creds)
	if err != nil {
		return err
	}
	creds.WebhookSecret = secret
	raw, _ := json.Marshal(creds)
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: "linear", Config: row.Config,
			Secret: s.Box.Seal(raw, owner(t.WorkspaceID, "linear")), ConnectedBy: t.UserID,
		})
	})
}

type LinearInfo struct {
	TeamKey, TeamName string
	State             string
	WebhookURL        string
	HasSecret         bool
	CloseStatusID     *uuid.UUID
	ReopenStatusID    *uuid.UUID
}

func (s *Service) LinearInfo(ctx context.Context, t store.Tenant) (LinearInfo, error) {
	if t.Role != store.RoleAdmin {
		return LinearInfo{}, store.ErrForbidden
	}
	var creds linearCreds
	row, err := s.load(ctx, t.WorkspaceID, "linear", &creds)
	if err != nil {
		return LinearInfo{}, err
	}
	var cfg linearConfig
	_ = json.Unmarshal(row.Config, &cfg)
	return LinearInfo{
		TeamKey: cfg.TeamKey, TeamName: cfg.TeamName, State: row.State, WebhookURL: s.linearWebhookURL(t.WorkspaceID),
		HasSecret: creds.WebhookSecret != "", CloseStatusID: parseUUID(cfg.CloseStatusID), ReopenStatusID: parseUUID(cfg.ReopenStatusID),
	}, nil
}

// LinearSetMapping (admins only) chooses which status a request moves to when its issue is completed or reopened.
func (s *Service) LinearSetMapping(ctx context.Context, t store.Tenant, closeID, reopenID *uuid.UUID) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	if err := s.validStatus(ctx, t, closeID); err != nil {
		return err
	}
	if err := s.validStatus(ctx, t, reopenID); err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "linear"})
		if err != nil {
			return ErrNotConnected
		}
		var cfg linearConfig
		_ = json.Unmarshal(row.Config, &cfg)
		cfg.CloseStatusID, cfg.ReopenStatusID = "", ""
		if closeID != nil {
			cfg.CloseStatusID = closeID.String()
		}
		if reopenID != nil {
			cfg.ReopenStatusID = reopenID.String()
		}
		b, _ := json.Marshal(cfg)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: "linear", Config: b})
		return err
	})
}

// ---- talking to Linear ----

type linearAuthError struct{}

func (linearAuthError) Error() string { return "Linear did not accept that key" }

// linearDo runs one GraphQL request. The address is the configured API; nothing a person typed is used as a host.
// A key is sent as is (not as a bearer token), which is how personal keys work.
func (s *Service) linearDo(ctx context.Context, token, query string, vars map[string]any, out any) error {
	body, _ := json.Marshal(map[string]any{"query": query, "variables": vars})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Linear.api()+"/graphql", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "feedback-app")
	res, err := s.client().Do(req)
	if err != nil {
		return fmt.Errorf("could not reach Linear")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	var env struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message    string `json:"message"`
			Extensions struct {
				Type string `json:"type"`
				Code string `json:"code"`
			} `json:"extensions"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(raw, &env)
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return linearAuthError{}
	}
	if len(env.Errors) > 0 {
		e := env.Errors[0]
		if strings.Contains(strings.ToLower(e.Extensions.Type+e.Extensions.Code), "authentication") {
			return linearAuthError{}
		}
		return ErrInvalid("Linear refused that: " + clip(e.Message, 200))
	}
	if res.StatusCode >= 300 || len(env.Data) == 0 {
		return fmt.Errorf("Linear could not do that; try again")
	}
	if out != nil {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return fmt.Errorf("Linear answered in a way we could not read")
		}
	}
	return nil
}

// linearCall is linearDo as the connected workspace; a key Linear refuses marks the connection as needing to
// be set up again.
func (s *Service) linearCall(ctx context.Context, ws uuid.UUID, query string, vars map[string]any, out any) (linearConfig, error) {
	var creds linearCreds
	row, err := s.load(ctx, ws, "linear", &creds)
	if err != nil {
		return linearConfig{}, err
	}
	var cfg linearConfig
	_ = json.Unmarshal(row.Config, &cfg)
	if row.State == "needs_reconnect" {
		return cfg, ErrNeedsReconnect
	}
	err = s.linearDo(ctx, creds.Token, query, vars, out)
	var auth linearAuthError
	if errors.As(err, &auth) {
		s.markBroken(ctx, ws, "linear", "Linear no longer accepts the key")
		return cfg, ErrNeedsReconnect
	}
	if err == nil {
		s.markOK(ctx, ws, "linear")
	}
	return cfg, err
}

// LinearCheck asks Linear whether the key still reaches the team.
func (s *Service) LinearCheck(ctx context.Context, t store.Tenant) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	var creds linearCreds
	row, err := s.load(ctx, t.WorkspaceID, "linear", &creds)
	if err != nil {
		return err
	}
	var cfg linearConfig
	_ = json.Unmarshal(row.Config, &cfg)
	var out struct {
		Team *struct {
			ID string `json:"id"`
		} `json:"team"`
	}
	if _, err := s.linearCall(ctx, t.WorkspaceID, `query($id: String!) { team(id: $id) { id } }`, map[string]any{"id": cfg.TeamID}, &out); err != nil {
		var inv ErrInvalid
		if errors.As(err, &inv) {
			s.markBroken(ctx, t.WorkspaceID, "linear", "the team was not found, or the key cannot reach it")
			return ErrNeedsReconnect
		}
		return err
	}
	if out.Team == nil {
		s.markBroken(ctx, t.WorkspaceID, "linear", "the team was not found, or the key cannot reach it")
		return ErrNeedsReconnect
	}
	return nil
}

func (s *Service) linearCreate(ctx context.Context, ws uuid.UUID, title, body string) (madeIssue, error) {
	var out struct {
		IssueCreate struct {
			Success bool `json:"success"`
			Issue   struct {
				Number    int    `json:"number"`
				URL       string `json:"url"`
				UpdatedAt string `json:"updatedAt"`
				Team      struct {
					Key string `json:"key"`
				} `json:"team"`
			} `json:"issue"`
		} `json:"issueCreate"`
	}
	var creds linearCreds
	row, err := s.load(ctx, ws, "linear", &creds)
	if err != nil {
		return madeIssue{}, err
	}
	var cfg linearConfig
	_ = json.Unmarshal(row.Config, &cfg)
	_, err = s.linearCall(ctx, ws, `mutation($teamId: String!, $title: String!, $description: String!) {
  issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { number url updatedAt team { key } } }
}`, map[string]any{"teamId": cfg.TeamID, "title": title, "description": body}, &out)
	if err != nil {
		return madeIssue{}, err
	}
	i := out.IssueCreate.Issue
	if !out.IssueCreate.Success || i.Number == 0 {
		return madeIssue{}, ErrInvalid("Linear did not create the issue; check the key can create issues in that team")
	}
	at, _ := time.Parse(time.RFC3339, i.UpdatedAt)
	key := i.Team.Key
	if key == "" {
		key = cfg.TeamKey
	}
	return madeIssue{Repo: strings.ToUpper(key), Number: i.Number, URL: i.URL, UpdatedAt: at}, nil
}

// ---- the issue changing in Linear ----

type linearEvent struct {
	Action           string  `json:"action"`
	Type             string  `json:"type"`
	WebhookTimestamp float64 `json:"webhookTimestamp"`
	Data             struct {
		Number int `json:"number"`
		State  struct {
			Type string `json:"type"`
		} `json:"state"`
		Team struct {
			Key string `json:"key"`
		} `json:"team"`
		UpdatedAt string `json:"updatedAt"`
	} `json:"data"`
}

const linearMaxBody = 1 << 20

// linearTolerance is how far a notification's own time may be from ours; older ones may be replays.
const linearTolerance = 2 * time.Minute

// LinearEvent handles a notification from Linear for a workspace. The signature is checked with the secret the
// admin pasted, on the exact bytes received, and the notification's own time must be recent. A delivery is
// acted on once. Moving a request follows the same rules as for GitHub, and only a change between
// open and completed/canceled counts: other edits to the issue are ignored. Nothing is sent back to Linear.
func (s *Service) LinearEvent(ctx context.Context, ws uuid.UUID, body []byte, delivery, signature string) error {
	if len(body) > linearMaxBody || delivery == "" || len(delivery) > 100 {
		return ErrBadSignature
	}
	var creds linearCreds
	row, err := s.load(ctx, ws, "linear", &creds)
	if err != nil || creds.WebhookSecret == "" {
		return ErrBadSignature // unknown, disconnected, or not yet able to check: looks like a wrong signature
	}
	m := hmac.New(sha256.New, []byte(creds.WebhookSecret))
	m.Write(body)
	if !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(strings.ToLower(signature))) {
		return ErrBadSignature
	}
	var ev linearEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return ErrInvalid("not an event")
	}
	ts := ev.WebhookTimestamp
	if ts > 1e12 { // milliseconds
		ts /= 1000
	}
	if d := s.now().Sub(time.Unix(int64(ts), 0)); ts == 0 || d > linearTolerance || d < -linearTolerance {
		return ErrBadSignature
	}
	if ev.Type != "Issue" {
		return nil
	}
	var cfg linearConfig
	_ = json.Unmarshal(row.Config, &cfg)
	if !strings.EqualFold(ev.Data.Team.Key, cfg.TeamKey) || ev.Data.Number == 0 {
		return nil
	}
	state := ""
	switch ev.Action {
	case "remove":
		state = "deleted"
	case "update":
		state = "open"
		if ev.Data.State.Type == "completed" || ev.Data.State.Type == "canceled" {
			state = "closed"
		}
	default:
		return nil
	}
	at, err := time.Parse(time.RFC3339, ev.Data.UpdatedAt)
	if err != nil {
		at = s.now()
	}
	return s.applyIssueEvent(ctx, issueEvent{
		Ws: ws, Tracker: "linear", Name: "Linear", Repo: cfg.TeamKey, Number: ev.Data.Number, State: state, At: at, Delivery: delivery,
		CloseID: cfg.CloseStatusID, ReopenID: cfg.ReopenStatusID, OnlyOnChange: true,
	})
}
