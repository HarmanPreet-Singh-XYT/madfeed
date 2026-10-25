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
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// GitHubConfig is where the issue tracker's API lives.
type GitHubConfig struct {
	APIBase string // default https://api.github.com
	// APIURL is this server's public address, shown to the admin as the place GitHub should send notifications.
	APIURL string
}

func (c GitHubConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://api.github.com"
}

var repoRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`)

type githubCreds struct {
	Token         string `json:"token"`
	WebhookSecret string `json:"webhookSecret"`
}

type githubConfig struct {
	Repo            string `json:"repo"`
	CloseStatusID   string `json:"closeStatusId,omitempty"`
	ReopenStatusID  string `json:"reopenStatusId,omitempty"`
	AcknowledgedPub bool   `json:"publicRepo,omitempty"`
}

func (s *Service) webhookURL(ws uuid.UUID) string {
	return strings.TrimRight(s.GitHub.APIURL, "/") + "/v1/integrations/github/" + ws.String() + "/events"
}

// ---- connecting ----

type GitHubSetup struct {
	WebhookURL    string
	WebhookSecret string // shown once: it goes into the repository's webhook settings
}

type GitHubInput struct {
	Token          string
	Repo           string
	AllowPublic    bool
	CloseStatusID  *uuid.UUID
	ReopenStatusID *uuid.UUID
}

func (s *Service) validStatus(ctx context.Context, t store.Tenant, id *uuid.UUID) error {
	if id == nil {
		return nil
	}
	var ok bool
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) (err error) {
		ok, err = q.StatusExists(ctx, dbgen.StatusExistsParams{WorkspaceID: t.WorkspaceID, ID: *id})
		return err
	}); err != nil {
		return err
	}
	if !ok {
		return ErrInvalid("that status does not exist in this workspace")
	}
	return nil
}

// GitHubConnect (admins only) connects a repository using an access token the admin made for it. The token
// is checked against the repository before anything is stored. Issues carry request titles, which come from
// customer words, so a public repository is refused unless the admin says it is meant.
func (s *Service) GitHubConnect(ctx context.Context, t store.Tenant, in GitHubInput) (GitHubSetup, error) {
	if !t.Can(store.PermManage) {
		return GitHubSetup{}, store.ErrForbidden
	}
	if err := s.ready(); err != nil {
		return GitHubSetup{}, err
	}
	if err := s.noOtherTracker(ctx, t, "github"); err != nil {
		return GitHubSetup{}, err
	}
	repo := strings.TrimSpace(in.Repo)
	if !repoRe.MatchString(repo) || strings.Contains(repo, "..") {
		return GitHubSetup{}, ErrInvalid("the repository must look like owner/name")
	}
	if l := len(strings.TrimSpace(in.Token)); l < 10 || l > 300 {
		return GitHubSetup{}, ErrInvalid("paste the access token")
	}
	if err := s.validStatus(ctx, t, in.CloseStatusID); err != nil {
		return GitHubSetup{}, err
	}
	if err := s.validStatus(ctx, t, in.ReopenStatusID); err != nil {
		return GitHubSetup{}, err
	}
	var info struct {
		FullName  string `json:"full_name"`
		Private   bool   `json:"private"`
		HasIssues bool   `json:"has_issues"`
		Archived  bool   `json:"archived"`
	}
	status, err := s.githubDo(ctx, strings.TrimSpace(in.Token), http.MethodGet, "/repos/"+repo, nil, &info)
	switch {
	case err != nil:
		return GitHubSetup{}, err
	case status == http.StatusUnauthorized:
		return GitHubSetup{}, ErrInvalid("GitHub did not accept that token")
	case status == http.StatusNotFound || status == http.StatusForbidden:
		return GitHubSetup{}, ErrInvalid("that repository was not found, or the token cannot reach it")
	case status != http.StatusOK:
		return GitHubSetup{}, ErrInvalid("GitHub could not check that repository; try again")
	}
	if !info.HasIssues || info.Archived {
		return GitHubSetup{}, ErrInvalid("that repository has issues switched off or is archived")
	}
	if !info.Private && !in.AllowPublic {
		return GitHubSetup{}, ErrInvalid("that repository is public, and issues would carry request titles written from customer words. Confirm it is meant, or choose a private repository")
	}
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)
	creds := githubCreds{Token: strings.TrimSpace(in.Token), WebhookSecret: hex.EncodeToString(secret)}
	cfg := githubConfig{Repo: info.FullName, AcknowledgedPub: !info.Private}
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
			WorkspaceID: t.WorkspaceID, Kind: "github", Config: rawCfg,
			Secret: s.Box.Seal(rawCreds, owner(t.WorkspaceID, "github")), ConnectedBy: t.UserID,
		})
	})
	if err != nil {
		return GitHubSetup{}, err
	}
	return GitHubSetup{WebhookURL: s.webhookURL(t.WorkspaceID), WebhookSecret: creds.WebhookSecret}, nil
}

type GitHubInfo struct {
	Repo           string
	State          string
	WebhookURL     string
	CloseStatusID  *uuid.UUID
	ReopenStatusID *uuid.UUID
}

func (s *Service) GitHubInfo(ctx context.Context, t store.Tenant) (GitHubInfo, error) {
	if !t.Can(store.PermManage) {
		return GitHubInfo{}, store.ErrForbidden
	}
	var out GitHubInfo
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "github"})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotConnected
		}
		if err != nil {
			return err
		}
		var cfg githubConfig
		_ = json.Unmarshal(row.Config, &cfg)
		out = GitHubInfo{Repo: cfg.Repo, State: row.State, WebhookURL: s.webhookURL(t.WorkspaceID)}
		out.CloseStatusID, out.ReopenStatusID = parseUUID(cfg.CloseStatusID), parseUUID(cfg.ReopenStatusID)
		return nil
	})
	return out, err
}

func parseUUID(s string) *uuid.UUID {
	if u, err := uuid.Parse(s); err == nil {
		return &u
	}
	return nil
}

// GitHubSetMapping (admins only) chooses which status a request moves to when its issue is closed or reopened.
func (s *Service) GitHubSetMapping(ctx context.Context, t store.Tenant, closeID, reopenID *uuid.UUID) error {
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
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "github"})
		if err != nil {
			return ErrNotConnected
		}
		var cfg githubConfig
		_ = json.Unmarshal(row.Config, &cfg)
		cfg.CloseStatusID, cfg.ReopenStatusID = "", ""
		if closeID != nil {
			cfg.CloseStatusID = closeID.String()
		}
		if reopenID != nil {
			cfg.ReopenStatusID = reopenID.String()
		}
		b, _ := json.Marshal(cfg)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: "github", Config: b})
		return err
	})
}

// githubDo makes one call with a token. The address is the configured API plus a fixed path; nothing a
// person typed is ever used as a host.
func (s *Service) githubDo(ctx context.Context, token, method, path string, body, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.GitHub.api()+path, rdr)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "feedback-app")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := s.client().Do(req)
	if err != nil {
		return 0, fmt.Errorf("could not reach GitHub")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if out != nil && res.StatusCode < 300 {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.StatusCode, fmt.Errorf("GitHub answered in a way we could not read")
		}
	}
	return res.StatusCode, nil
}

// githubCall is githubDo as the connected workspace; a token GitHub refuses marks the connection as needing
// to be set up again.
func (s *Service) githubCall(ctx context.Context, ws uuid.UUID, method, path string, body, out any) (int, githubConfig, error) {
	var creds githubCreds
	row, err := s.load(ctx, ws, "github", &creds)
	if err != nil {
		return 0, githubConfig{}, err
	}
	var cfg githubConfig
	_ = json.Unmarshal(row.Config, &cfg)
	if row.State == "needs_reconnect" {
		return 0, cfg, ErrNeedsReconnect
	}
	status, err := s.githubDo(ctx, creds.Token, method, strings.ReplaceAll(path, "{repo}", cfg.Repo), body, out)
	if err != nil {
		return status, cfg, err
	}
	if status == http.StatusUnauthorized {
		s.markBroken(ctx, ws, "github", "GitHub no longer accepts the token")
		return status, cfg, ErrNeedsReconnect
	}
	if status == http.StatusOK || status == http.StatusCreated {
		s.markOK(ctx, ws, "github")
	}
	return status, cfg, nil
}

// GitHubCheck asks GitHub whether the token still reaches the repository.
func (s *Service) GitHubCheck(ctx context.Context, ws uuid.UUID) error {
	status, _, err := s.githubCall(ctx, ws, http.MethodGet, "/repos/{repo}", nil, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound || status == http.StatusForbidden {
		s.markBroken(ctx, ws, "github", "the repository was not found, or the token cannot reach it")
		return ErrNeedsReconnect
	}
	return nil
}

// GitHubCheckAs is GitHubCheck for an admin.
func (s *Service) GitHubCheckAs(ctx context.Context, t store.Tenant) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	return s.GitHubCheck(ctx, t.WorkspaceID)
}

// ---- linking a request to an issue ----

type IssueLink struct {
	Tracker   string // github, linear, jira, clickup, asana or azuredevops
	Repo      string
	Ref       string
	Number    int
	URL       string
	State     string // open, closed, deleted
	Conflict  string
	UpdatedAt time.Time
}

// Label is how a person would write the issue: owner/repo#12, ENG-12, or just the tracker's own id.
func (l IssueLink) Label() string {
	switch l.Tracker {
	case "github":
		return fmt.Sprintf("%s#%d", l.Repo, l.Number)
	case "linear", "jira":
		return fmt.Sprintf("%s-%d", l.Repo, l.Number)
	case "azuredevops":
		return fmt.Sprintf("%s #%d", l.Repo, l.Number)
	}
	return l.Ref
}

func toLink(r dbgen.RequestIssue) IssueLink {
	return IssueLink{Tracker: r.Tracker, Ref: r.IssueRef, Repo: r.Repo, Number: int(r.IssueNumber), URL: r.IssueUrl, State: r.IssueState, Conflict: r.Conflict, UpdatedAt: r.LastEventAt}
}

// GetIssue is the issue linked to a request.
func (s *Service) GetIssue(ctx context.Context, t store.Tenant, requestID uuid.UUID) (IssueLink, error) {
	var out IssueLink
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetRequestIssue(ctx, dbgen.GetRequestIssueParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		out = toLink(r)
		return err
	})
	return out, err
}

// CreateIssue opens an issue for a request in the connected repository and links them. The issue holds the
// request's title, counts and a link back; customer quotes, names and addresses are never copied into it.
func (s *Service) CreateIssue(ctx context.Context, t store.Tenant, requestID uuid.UUID) (IssueLink, error) {
	if !t.CanWrite() {
		return IssueLink{}, store.ErrForbidden
	}
	var title, status string
	var statusID uuid.UUID
	var evidence, people, accounts int32
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: requestID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := q.GetRequestIssue(ctx, dbgen.GetRequestIssueParams{WorkspaceID: t.WorkspaceID, RequestID: requestID}); err == nil {
			return ErrInvalid("this request already has an issue")
		}
		im, err := q.GetRequestImpact(ctx, dbgen.GetRequestImpactParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		st, err := q.GetStatus(ctx, dbgen.GetStatusParams{WorkspaceID: t.WorkspaceID, ID: r.StatusID})
		if err != nil {
			return err
		}
		title, statusID, status = r.Title, r.StatusID, st.Name
		evidence, people, accounts = im.EvidenceCount, im.PeopleCount, im.AccountCount
		return nil
	})
	if err != nil {
		return IssueLink{}, err
	}
	body := fmt.Sprintf("Customer request tracked in the feedback app.\n\n- Quotes: %d\n- People: %d\n- Accounts: %d\n- Status there: %s\n\nOpen it: %s/w/%s/requests/%s\n\nCustomer quotes, names and email addresses are not copied into this issue.",
		evidence, people, accounts, status, strings.TrimRight(s.WebURL, "/"), t.WorkspaceID, requestID)
	tracker, err := s.activeTracker(ctx, t.WorkspaceID)
	if err != nil {
		return IssueLink{}, err
	}
	var made madeIssue
	switch tracker {
	case "linear":
		made, err = s.linearCreate(ctx, t.WorkspaceID, clip(title, 200), body)
	case "jira":
		made, err = s.jiraCreate(ctx, t.WorkspaceID, clip(title, 200), body)
	case "clickup", "asana", "azuredevops":
		made, err = s.trackerCreate(ctx, tracker, t.WorkspaceID, clip(title, 200), body)
	default:
		made, err = s.githubCreate(ctx, t.WorkspaceID, clip(title, 200), body)
	}
	if err != nil {
		return IssueLink{}, err
	}
	// Events older than the issue itself are never ours to act on; start from the time the tracker gives, not our clock.
	since := made.UpdatedAt
	if since.IsZero() {
		since = s.now()
	}
	var link IssueLink
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if err := q.InsertRequestIssue(ctx, dbgen.InsertRequestIssueParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, Repo: made.Repo, IssueNumber: int32(made.Number), IssueUrl: clip(made.URL, 500), LastSyncedStatusID: uuid.NullUUID{UUID: statusID, Valid: true}, CreatedBy: t.UserID, LastEventAt: since, Tracker: tracker, IssueRef: made.Ref}); err != nil {
			return err
		}
		r, err := q.GetRequestIssue(ctx, dbgen.GetRequestIssueParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		link = toLink(r)
		return err
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return IssueLink{}, ErrInvalid("this request or that issue is already linked")
	}
	return link, err
}

// madeIssue is what a tracker answered when an issue was opened.
type madeIssue struct {
	Repo      string // GitHub owner/name, Linear team key
	Number    int
	Ref       string // a text id, when the tracker's ids are not numbers
	URL       string
	UpdatedAt time.Time
}

func (s *Service) githubCreate(ctx context.Context, ws uuid.UUID, title, body string) (madeIssue, error) {
	var created struct {
		Number    int    `json:"number"`
		HTMLURL   string `json:"html_url"`
		UpdatedAt string `json:"updated_at"`
	}
	code, cfg, err := s.githubCall(ctx, ws, http.MethodPost, "/repos/{repo}/issues", map[string]any{"title": title, "body": body}, &created)
	if err != nil {
		return madeIssue{}, err
	}
	if code != http.StatusCreated || created.Number == 0 {
		return madeIssue{}, ErrInvalid("GitHub did not create the issue; check the token can write issues")
	}
	at, _ := time.Parse(time.RFC3339, created.UpdatedAt)
	return madeIssue{Repo: cfg.Repo, Number: created.Number, URL: created.HTMLURL, UpdatedAt: at}, nil
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Unlink forgets the link. The issue itself is left alone.
func (s *Service) Unlink(ctx context.Context, t store.Tenant, requestID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.DeleteRequestIssue(ctx, dbgen.DeleteRequestIssueParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// ---- the issue changing on the other side ----

type ghEvent struct {
	Action string `json:"action"`
	Issue  struct {
		Number      int    `json:"number"`
		State       string `json:"state"`
		StateReason string `json:"state_reason"`
		UpdatedAt   string `json:"updated_at"`
	} `json:"issue"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
}

const githubMaxBody = 1 << 20

// GitHubEvent handles a notification from GitHub for a workspace. The signature is checked with that
// workspace's own secret on the exact bytes received. A delivery is acted on once; a notification older
// than what the link already knows is ignored; an issue closed or reopened moves the request only if the
// admin chose a status for it and nobody here changed the request in the meantime (otherwise a conflict is
// recorded and shown). Nothing is ever sent back to GitHub from here, so the two cannot trigger each other.
func (s *Service) GitHubEvent(ctx context.Context, ws uuid.UUID, body []byte, event, delivery, signature string) error {
	if len(body) > githubMaxBody || delivery == "" || len(delivery) > 100 {
		return ErrBadSignature
	}
	var creds githubCreds
	row, err := s.load(ctx, ws, "github", &creds)
	if err != nil {
		return ErrBadSignature // an unknown or disconnected workspace looks like a wrong signature
	}
	m := hmac.New(sha256.New, []byte(creds.WebhookSecret))
	m.Write(body)
	if !hmac.Equal([]byte("sha256="+hex.EncodeToString(m.Sum(nil))), []byte(signature)) {
		return ErrBadSignature
	}
	if event != "issues" {
		return nil // ping and everything else: nothing to do
	}
	var cfg githubConfig
	_ = json.Unmarshal(row.Config, &cfg)
	var ev ghEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return ErrInvalid("not an event")
	}
	if !strings.EqualFold(ev.Repository.FullName, cfg.Repo) {
		return nil
	}
	state := ""
	switch ev.Action {
	case "closed":
		state = "closed"
	case "reopened":
		state = "open"
	case "deleted", "transferred":
		state = "deleted"
	default:
		return nil
	}
	at, err := time.Parse(time.RFC3339, ev.Issue.UpdatedAt)
	if err != nil {
		at = s.now()
	}
	return s.applyIssueEvent(ctx, issueEvent{
		Ws: ws, Tracker: "github", Name: "GitHub", Repo: cfg.Repo, Number: ev.Issue.Number, State: state, At: at, Delivery: delivery,
		CloseID: cfg.CloseStatusID, ReopenID: cfg.ReopenStatusID,
	})
}

// issueEvent is a tracker telling us an issue closed, reopened or went away.
type issueEvent struct {
	Ws                uuid.UUID
	Tracker, Name     string // "github"/"GitHub", "linear"/"Linear"
	Repo              string
	Number            int
	Ref               string // a text id, for trackers whose ids are not numbers
	State             string // open, closed, deleted
	At                time.Time
	Delivery          string
	CloseID, ReopenID string
	// OnlyOnChange ignores an event that leaves the issue in the state we already know (a tracker that tells
	// us about every edit, not just closing and reopening).
	OnlyOnChange bool
}

func (s *Service) applyIssueEvent(ctx context.Context, p issueEvent) error {
	ws, state, at := p.Ws, p.State, p.At
	t := system(ws, store.RoleMember)
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		n, err := q.InsertWebhookDelivery(ctx, dbgen.InsertWebhookDeliveryParams{WorkspaceID: ws, Source: p.Tracker, DeliveryID: p.Delivery})
		if err != nil {
			return err
		}
		if n == 0 {
			return nil // already handled
		}
		if s.now().UnixNano()%50 == 0 {
			_ = q.PurgeWebhookDeliveries(ctx, ws)
		}
		link, err := q.GetRequestIssueByNumber(ctx, dbgen.GetRequestIssueByNumberParams{WorkspaceID: ws, Tracker: p.Tracker, Lower: p.Repo, IssueNumber: int32(p.Number), IssueRef: p.Ref})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // an issue we did not make for a request
		}
		if err != nil {
			return err
		}
		if at.Before(link.LastEventAt) {
			return nil // older than what we already know: out of order, ignore
		}
		if p.OnlyOnChange && state == link.IssueState {
			return nil
		}
		target := uuid.Nil
		switch state {
		case "closed":
			if u := parseUUID(p.CloseID); u != nil {
				target = *u
			}
		case "open":
			if u := parseUUID(p.ReopenID); u != nil {
				target = *u
			}
		}
		synced, pending, conflict := link.LastSyncedStatusID, link.PendingStatusID, ""
		if state == "deleted" {
			pending = uuid.NullUUID{}
			conflict = "The issue was deleted or moved on " + p.Name + ", so this request no longer follows it."
		} else if target != uuid.Nil {
			cur, err := q.GetRequestForStatusChange(ctx, dbgen.GetRequestForStatusChangeParams{WorkspaceID: ws, ID: link.RequestID})
			if err != nil {
				return err
			}
			switch {
			case cur.StatusID == target:
				synced, pending = uuid.NullUUID{UUID: target, Valid: true}, uuid.NullUUID{}
			case link.LastSyncedStatusID.Valid && cur.StatusID == link.LastSyncedStatusID.UUID:
				// nobody has touched the request since the link last agreed with the issue: follow it
				if err := s.applyStatus(ctx, tx, q, t, link.RequestID, target); err != nil {
					return err
				}
				synced, pending = uuid.NullUUID{UUID: target, Valid: true}, uuid.NullUUID{}
			default:
				pending = uuid.NullUUID{UUID: target, Valid: true}
				conflict = fmt.Sprintf("The issue was %s on %s, but this request's status was changed here since the link was last in step, so it was left as it is.", map[string]string{"closed": "closed", "open": "reopened"}[state], p.Name)
			}
		}
		return q.SetRequestIssueState(ctx, dbgen.SetRequestIssueStateParams{WorkspaceID: ws, RequestID: link.RequestID, IssueState: state, LastEventAt: at, LastSyncedStatusID: synced, PendingStatusID: pending, Conflict: conflict})
	})
}

// applyStatus moves the request inside the caller's transaction, by the same rules as a person doing it:
// moving into a shipped status prepares message drafts for review (nothing is sent), moving out withdraws
// drafts nobody approved.
func (s *Service) applyStatus(ctx context.Context, tx pgx.Tx, q *dbgen.Queries, t store.Tenant, requestID, statusID uuid.UUID) error {
	if s.Workflow == nil {
		return ErrInvalid("status changes are not available here")
	}
	return s.Workflow.ChangeStatusIn(ctx, tx, q, t, requestID, statusID)
}

// ResolveConflict (people who can edit) settles a held-back change: apply the status the issue wants, or
// keep things as they are here.
func (s *Service) ResolveConflict(ctx context.Context, t store.Tenant, requestID uuid.UUID, apply bool) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		link, err := q.GetRequestIssue(ctx, dbgen.GetRequestIssueParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if link.Conflict == "" {
			return ErrInvalid("there is nothing to resolve")
		}
		cur, err := q.GetRequestForStatusChange(ctx, dbgen.GetRequestForStatusChangeParams{WorkspaceID: t.WorkspaceID, ID: requestID})
		if err != nil {
			return err
		}
		synced := uuid.NullUUID{UUID: cur.StatusID, Valid: true}
		if apply && link.PendingStatusID.Valid {
			if err := s.applyStatus(ctx, tx, q, t, requestID, link.PendingStatusID.UUID); err != nil {
				return err
			}
			synced = link.PendingStatusID
		}
		return q.SetRequestIssueState(ctx, dbgen.SetRequestIssueStateParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, IssueState: link.IssueState, LastEventAt: link.LastEventAt, LastSyncedStatusID: synced, PendingStatusID: uuid.NullUUID{}, Conflict: ""})
	})
}
