package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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
	"github.com/jackc/pgx/v5/pgconn"

	"product/api/internal/intake"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// SlackConfig is the Slack app this server is registered as. All empty means Slack is not set up here.
type SlackConfig struct {
	ClientID, ClientSecret, SigningSecret string
	APIBase                               string // default https://slack.com
	AuthorizeURL                          string // default https://slack.com/oauth/v2/authorize
	RedirectURI                           string // the page on our site Slack sends the person back to
}

func (c SlackConfig) enabled() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.SigningSecret != "" && c.RedirectURI != ""
}

func (c SlackConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://slack.com"
}

func (c SlackConfig) authorize() string {
	if c.AuthorizeURL != "" {
		return c.AuthorizeURL
	}
	return "https://slack.com/oauth/v2/authorize"
}

// SlackEnabled says whether Slack can be connected on this server.
func (s *Service) SlackEnabled() bool { return s.Box != nil && s.Slack.enabled() }

const slackScopes = "channels:history,channels:read,channels:join"

type slackCreds struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitempty"`
}

// ---- connecting ----

type slackState struct {
	W uuid.UUID `json:"w"`
	U uuid.UUID `json:"u"`
	X int64     `json:"x"`
	N string    `json:"n"`
}

func (s *Service) signState(st slackState) string {
	b, _ := json.Marshal(st)
	p := base64.RawURLEncoding.EncodeToString(b)
	m := hmac.New(sha256.New, s.Box.Derive("slack-oauth-state"))
	m.Write([]byte(p))
	return p + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *Service) verifyState(token string) (slackState, error) {
	var st slackState
	p, sig, ok := strings.Cut(token, ".")
	if !ok {
		return st, ErrBadSignature
	}
	m := hmac.New(sha256.New, s.Box.Derive("slack-oauth-state"))
	m.Write([]byte(p))
	want := base64.RawURLEncoding.EncodeToString(m.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(sig)) {
		return st, ErrBadSignature
	}
	raw, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil || json.Unmarshal(raw, &st) != nil || s.now().Unix() > st.X {
		return st, ErrBadSignature
	}
	return st, nil
}

// SlackStateWorkspace says which workspace a connection link was made for (after checking it is genuine and fresh),
// so the page Slack returns the person to does not have to know.
func (s *Service) SlackStateWorkspace(state string) (uuid.UUID, error) {
	if s.Box == nil {
		return uuid.Nil, ErrInvalid("connections are not set up on this server yet")
	}
	st, err := s.verifyState(state)
	if err != nil {
		return uuid.Nil, ErrInvalid("that connection link has expired; start again")
	}
	return st.W, nil
}

// SlackConnectURL (admins only) is where to send the person to approve the connection. The `state` it
// carries is signed, expires in ten minutes and names this workspace and this person, so a link made for
// someone else, or an old one, cannot complete a connection.
func (s *Service) SlackConnectURL(ctx context.Context, t store.Tenant) (string, error) {
	if t.Role != store.RoleAdmin {
		return "", store.ErrForbidden
	}
	if !s.SlackEnabled() {
		return "", ErrInvalid("Slack is not set up on this server yet")
	}
	nonce := uuid.NewString()
	state := s.signState(slackState{W: t.WorkspaceID, U: t.UserID, X: s.now().Add(10 * time.Minute).Unix(), N: nonce})
	q := url.Values{"client_id": {s.Slack.ClientID}, "scope": {slackScopes}, "redirect_uri": {s.Slack.RedirectURI}, "state": {state}}
	return s.Slack.authorize() + "?" + q.Encode(), nil
}

type slackAPIResult struct {
	OK           bool   `json:"ok"`
	Error        string `json:"error"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	BotUserID    string `json:"bot_user_id"`
	Team         struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"team"`
	Channels []struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		IsArchived bool   `json:"is_archived"`
	} `json:"channels"`
	Channel struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"channel"`
}

func (s *Service) slackForm(ctx context.Context, method string, form url.Values, token string) (slackAPIResult, error) {
	var out slackAPIResult
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Slack.api()+"/api/"+method, strings.NewReader(form.Encode()))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := s.client().Do(req)
	if err != nil {
		return out, fmt.Errorf("could not reach Slack")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusTooManyRequests {
		return out, fmt.Errorf("Slack asked us to slow down; try again in a minute")
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("Slack answered in a way we could not read")
	}
	return out, nil
}

// SlackComplete finishes the connection when Slack sends the person back with a code.
func (s *Service) SlackComplete(ctx context.Context, t store.Tenant, code, state string) (Status, error) {
	if t.Role != store.RoleAdmin {
		return Status{}, store.ErrForbidden
	}
	if !s.SlackEnabled() {
		return Status{}, ErrInvalid("Slack is not set up on this server yet")
	}
	st, err := s.verifyState(state)
	if err != nil || st.W != t.WorkspaceID || st.U != t.UserID {
		return Status{}, ErrInvalid("that connection link has expired or was not made for you; start again")
	}
	if code == "" || len(code) > 200 {
		return Status{}, ErrInvalid("Slack did not send a code; start again")
	}
	res, err := s.slackForm(ctx, "oauth.v2.access", url.Values{
		"client_id": {s.Slack.ClientID}, "client_secret": {s.Slack.ClientSecret}, "code": {code}, "redirect_uri": {s.Slack.RedirectURI},
	}, "")
	if err != nil {
		return Status{}, err
	}
	if !res.OK || res.AccessToken == "" || res.Team.ID == "" {
		return Status{}, ErrInvalid("Slack did not accept the connection; start again")
	}
	creds := slackCreds{AccessToken: res.AccessToken, RefreshToken: res.RefreshToken}
	if res.ExpiresIn > 0 {
		creds.ExpiresAt = s.now().Add(time.Duration(res.ExpiresIn) * time.Second)
	}
	raw, _ := json.Marshal(creds) // #nosec G117 -- sealed with the server key before it is stored
	cfgMap := map[string]string{"teamName": res.Team.Name, "channelId": "", "channelName": ""}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		// Connecting the same Slack workspace again (after a revoke) keeps the channel that was chosen.
		if old, gerr := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "slack"}); gerr == nil && old.ExternalID.String == res.Team.ID {
			var prev map[string]string
			if json.Unmarshal(old.Config, &prev) == nil {
				cfgMap["channelId"], cfgMap["channelName"] = prev["channelId"], prev["channelName"]
			}
		}
		cfg, _ := json.Marshal(cfgMap)
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: "slack", ExternalID: pgText(res.Team.ID), Config: cfg,
			Secret: s.Box.Seal(raw, owner(t.WorkspaceID, "slack")), ConnectedBy: t.UserID,
		})
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return Status{}, ErrInvalid("that Slack workspace is already connected to another workspace here")
	}
	if err != nil {
		return Status{}, err
	}
	return Status{Kind: "slack", State: "connected", Summary: res.Team.Name}, nil
}

// ---- using the connection ----

var slackBroken = map[string]bool{"invalid_auth": true, "token_revoked": true, "account_inactive": true, "token_expired": true, "not_authed": true, "invalid_refresh_token": true, "app_uninstalled": true}

// slackCall makes one call as the connected workspace, refreshing a token that is about to expire. A
// credential Slack no longer accepts marks the connection as needing to be set up again.
func (s *Service) slackCall(ctx context.Context, ws uuid.UUID, method string, form url.Values) (slackAPIResult, error) {
	var creds slackCreds
	if _, err := s.load(ctx, ws, "slack", &creds); err != nil {
		return slackAPIResult{}, err
	}
	if !creds.ExpiresAt.IsZero() && s.now().Add(5*time.Minute).After(creds.ExpiresAt) {
		if creds.RefreshToken == "" {
			s.markBroken(ctx, ws, "slack", "token expired")
			return slackAPIResult{}, ErrNeedsReconnect
		}
		r, err := s.slackForm(ctx, "oauth.v2.access", url.Values{
			"client_id": {s.Slack.ClientID}, "client_secret": {s.Slack.ClientSecret}, "grant_type": {"refresh_token"}, "refresh_token": {creds.RefreshToken},
		}, "")
		if err != nil {
			return slackAPIResult{}, err
		}
		if !r.OK || r.AccessToken == "" {
			s.markBroken(ctx, ws, "slack", "could not refresh the token")
			return slackAPIResult{}, ErrNeedsReconnect
		}
		creds.AccessToken = r.AccessToken
		if r.RefreshToken != "" {
			creds.RefreshToken = r.RefreshToken
		}
		if r.ExpiresIn > 0 {
			creds.ExpiresAt = s.now().Add(time.Duration(r.ExpiresIn) * time.Second)
		}
		raw, _ := json.Marshal(creds) // #nosec G117 -- sealed with the server key before it is stored
		_ = store.WithTenant(ctx, s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
			return q.UpdateIntegrationSecret(ctx, dbgen.UpdateIntegrationSecretParams{WorkspaceID: ws, Kind: "slack", Secret: s.Box.Seal(raw, owner(ws, "slack"))})
		})
	}
	res, err := s.slackForm(ctx, method, form, creds.AccessToken)
	if err != nil {
		return res, err
	}
	if !res.OK && slackBroken[res.Error] {
		s.markBroken(ctx, ws, "slack", "Slack no longer accepts the connection ("+res.Error+")")
		return res, ErrNeedsReconnect
	}
	if !res.OK {
		return res, fmt.Errorf("Slack said: %s", sanitizeSlackError(res.Error))
	}
	s.markOK(ctx, ws, "slack")
	return res, nil
}

var errWord = regexp.MustCompile(`[^a-z_]`)

func sanitizeSlackError(e string) string {
	e = errWord.ReplaceAllString(strings.ToLower(e), "")
	if e == "" || len(e) > 60 {
		return "an error"
	}
	return strings.ReplaceAll(e, "_", " ")
}

type Channel struct{ ID, Name string }

// SlackChannels (admins only) lists the public channels feedback could be collected from.
func (s *Service) SlackChannels(ctx context.Context, t store.Tenant) ([]Channel, error) {
	if t.Role != store.RoleAdmin {
		return nil, store.ErrForbidden
	}
	res, err := s.slackCall(ctx, t.WorkspaceID, "conversations.list", url.Values{"types": {"public_channel"}, "exclude_archived": {"true"}, "limit": {"200"}})
	if err != nil {
		return nil, err
	}
	out := []Channel{}
	for _, c := range res.Channels {
		if !c.IsArchived {
			out = append(out, Channel{ID: c.ID, Name: c.Name})
		}
	}
	return out, nil
}

var channelID = regexp.MustCompile(`^C[A-Z0-9]{2,30}$`)

// SlackSetChannel (admins only) chooses the one channel whose messages become feedback, and has the app
// join it so Slack sends its messages.
func (s *Service) SlackSetChannel(ctx context.Context, t store.Tenant, id string) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	if !channelID.MatchString(id) {
		return ErrInvalid("that is not a channel")
	}
	info, err := s.slackCall(ctx, t.WorkspaceID, "conversations.info", url.Values{"channel": {id}})
	if err != nil {
		return err
	}
	if _, err := s.slackCall(ctx, t.WorkspaceID, "conversations.join", url.Values{"channel": {id}}); err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "slack"})
		if err != nil {
			return ErrNotConnected
		}
		var cfg map[string]string
		_ = json.Unmarshal(row.Config, &cfg)
		if cfg == nil {
			cfg = map[string]string{}
		}
		cfg["channelId"], cfg["channelName"] = info.Channel.ID, info.Channel.Name
		b, _ := json.Marshal(cfg)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: "slack", Config: b})
		return err
	})
}

// SlackCheck (admins only) asks Slack whether the connection still works, and says so.
func (s *Service) SlackCheck(ctx context.Context, t store.Tenant) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	_, err := s.slackCall(ctx, t.WorkspaceID, "auth.test", url.Values{})
	return err
}

// ---- messages coming in ----

const slackMaxBody = 256 << 10

type slackEnvelope struct {
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
	TeamID    string `json:"team_id"`
	EventID   string `json:"event_id"`
	Event     struct {
		Type        string `json:"type"`
		Subtype     string `json:"subtype"`
		BotID       string `json:"bot_id"`
		User        string `json:"user"`
		Channel     string `json:"channel"`
		ChannelType string `json:"channel_type"`
		Text        string `json:"text"`
		TS          string `json:"ts"`
	} `json:"event"`
}

// verifySlack checks that a request really came from Slack: the signature covers the timestamp and the
// body, and a request more than five minutes old is refused so a captured one cannot be replayed later.
func (s *Service) verifySlack(body []byte, timestamp, signature string) error {
	if s.Slack.SigningSecret == "" {
		return ErrBadSignature
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	if d := s.now().Unix() - ts; d > 300 || d < -300 {
		return ErrBadSignature
	}
	m := hmac.New(sha256.New, []byte(s.Slack.SigningSecret))
	m.Write([]byte("v0:" + timestamp + ":"))
	m.Write(body)
	want := "v0=" + hex.EncodeToString(m.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(signature)) {
		return ErrBadSignature
	}
	return nil
}

// SlackEvent handles one call from Slack's event delivery. It returns the challenge to echo for the
// one-time URL check, or "". Messages in the chosen channel become feedback, through the same intake path
// as anything pasted: redacted, size-limited, counted against the daily allowance, queued for extraction
// and reviewed by a person. A message delivered twice is stored once.
func (s *Service) SlackEvent(ctx context.Context, body []byte, timestamp, signature string) (string, error) {
	if len(body) > slackMaxBody {
		return "", ErrBadSignature
	}
	if err := s.verifySlack(body, timestamp, signature); err != nil {
		return "", err
	}
	var env slackEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return "", ErrInvalid("not an event")
	}
	switch env.Type {
	case "url_verification":
		return env.Challenge, nil
	case "event_callback":
	default:
		return "", nil
	}
	e := env.Event
	switch e.Type {
	case "app_uninstalled", "tokens_revoked":
		if env.TeamID != "" {
			var n int
			_ = s.Pool.QueryRow(ctx, `SELECT integration_slack_revoked($1)`, env.TeamID).Scan(&n)
		}
		return "", nil
	case "message":
	default:
		return "", nil
	}
	// Only plain messages from people: edits, deletions, joins and bot posts are ignored.
	if e.Subtype != "" || e.BotID != "" || e.User == "" || e.ChannelType != "channel" || e.TS == "" || env.TeamID == "" {
		return "", nil
	}
	var ws uuid.UUID
	var chosen string
	if err := s.Pool.QueryRow(ctx, `SELECT workspace_id, channel_id FROM integration_for_slack_team($1)`, env.TeamID).Scan(&ws, &chosen); err != nil {
		return "", nil // a team we do not know: nothing to do, and nothing to reveal
	}
	if chosen == "" || e.Channel != chosen {
		return "", nil
	}
	text := cleanSlackText(e.Text)
	if text == "" {
		return "", nil
	}
	var name string
	_ = store.WithTenant(ctx, s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: ws, Kind: "slack"})
		if err == nil {
			var cfg map[string]any
			_ = json.Unmarshal(row.Config, &cfg)
			name = str(cfg, "channelName")
		}
		return nil
	})
	_, err := s.Intake.IngestPaste(ctx, system(ws, store.RoleMember), intake.PasteInput{
		Kind: "chat", Title: "Slack #" + name, Text: text,
		ExternalID: "slack:" + env.TeamID + ":" + e.Channel + ":" + e.TS,
	})
	var qe intake.ErrQuota
	if errors.As(err, &qe) {
		return "", nil // over the daily allowance: dropped quietly, Slack must not retry
	}
	var ie intake.ErrInvalid
	if errors.As(err, &ie) {
		return "", nil // for example a message too long to keep
	}
	return "", err
}

var (
	slackUser    = regexp.MustCompile(`<@[A-Z0-9]+(\|[^>]*)?>`)
	slackChannel = regexp.MustCompile(`<#[A-Z0-9]+\|([^>]*)>`)
	slackLink    = regexp.MustCompile(`<(https?://[^|>]+)(\|([^>]*))?>`)
	slackSpecial = regexp.MustCompile(`<!([a-z]+)(\|[^>]*)?>`)
)

// cleanSlackText turns Slack's markup into the words a person typed.
func cleanSlackText(t string) string {
	t = slackUser.ReplaceAllString(t, "@someone")
	t = slackChannel.ReplaceAllString(t, "#$1")
	t = slackLink.ReplaceAllStringFunc(t, func(m string) string {
		g := slackLink.FindStringSubmatch(m)
		if g[3] != "" {
			return g[3]
		}
		return g[1]
	})
	t = slackSpecial.ReplaceAllString(t, "@$1")
	t = strings.NewReplacer("&lt;", "<", "&gt;", ">", "&amp;", "&").Replace(t)
	return strings.TrimSpace(t)
}

// ---- health ----

// CheckAll asks each connection that has not been confirmed lately whether it still works, so a token
// that was revoked or expired is noticed (and shown to the admin) without waiting for someone to look.
func (s *Service) CheckAll(ctx context.Context) {
	rows, err := s.Pool.Query(ctx, `SELECT workspace_id, kind FROM integrations_to_check()`)
	if err != nil {
		return
	}
	type item struct {
		ws   uuid.UUID
		kind string
	}
	var todo []item
	for rows.Next() {
		var it item
		if rows.Scan(&it.ws, &it.kind) == nil {
			todo = append(todo, it)
		}
	}
	rows.Close()
	for _, it := range todo {
		switch it.kind {
		case "slack":
			if s.SlackEnabled() {
				_, _ = s.slackCall(ctx, it.ws, "auth.test", url.Values{})
			}
		case "github":
			_ = s.GitHubCheck(ctx, it.ws)
		}
	}
}

// Loop runs CheckAll now and then until ctx ends.
func (s *Service) Loop(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = 15 * time.Minute
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		s.CheckAll(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
