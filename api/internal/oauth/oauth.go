// Package oauth lets a remote assistant (an MCP "connector") be approved by a workspace admin and then act with
// a short-lived access token. It follows OAuth 2.1 for public clients: the assistant registers itself, the
// admin approves it in our web app, a one-time code is returned to its registered address, and it trades the
// code (with a PKCE proof) for an access token and a single-use refresh token. The access token is an
// ordinary API key that expires in an hour, so scopes, revocation, limits and the activity log all apply
// unchanged. Reusing a refresh token that was already replaced ends the whole grant.
package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/apikey"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	AccessTokenLife = time.Hour
	RefreshLife     = 30 * 24 * time.Hour
	CodeLife        = 5 * time.Minute
	MaxGrants       = 10
	MaxClients      = 20000
)

var (
	ErrNotFound = errors.New("oauth: not found")
	ErrDenied   = errors.New("oauth: not allowed")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// TokenError is an answer for the token address, in the shape the standard asks for.
type TokenError struct{ Code, Description string }

func (e TokenError) Error() string { return e.Code + ": " + e.Description }

type Service struct {
	Pool *pgxpool.Pool
	Keys *apikey.Service
	// Resource is the address of the assistant-facing endpoint (the /mcp address); Issuer is this server's address.
	Resource, Issuer string
	// WebURL is the web app, where the admin approves.
	WebURL string
	// Allow, when set, is asked before a grant is made or renewed (for example: does the plan include API access).
	Allow func(ctx context.Context, workspaceID uuid.UUID) error
	Now   func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func hash(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(h[:])
}

func newSecret(prefix string) string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

// ---- metadata ----

type ProtectedResource struct {
	Resource             string   `json:"resource"`
	AuthorizationServers []string `json:"authorization_servers"`
	ScopesSupported      []string `json:"scopes_supported"`
	BearerMethods        []string `json:"bearer_methods_supported"`
}

type ServerMetadata struct {
	Issuer                   string   `json:"issuer"`
	AuthorizationEndpoint    string   `json:"authorization_endpoint"`
	TokenEndpoint            string   `json:"token_endpoint"`
	RegistrationEndpoint     string   `json:"registration_endpoint"`
	ResponseTypes            []string `json:"response_types_supported"`
	GrantTypes               []string `json:"grant_types_supported"`
	CodeChallengeMethods     []string `json:"code_challenge_methods_supported"`
	TokenEndpointAuthMethods []string `json:"token_endpoint_auth_methods_supported"`
	ScopesSupported          []string `json:"scopes_supported"`
}

func (s *Service) ResourceMetadata() ProtectedResource {
	return ProtectedResource{Resource: s.Resource, AuthorizationServers: []string{s.Issuer}, ScopesSupported: apikey.AllScopes, BearerMethods: []string{"header"}}
}

func (s *Service) ServerMetadata() ServerMetadata {
	iss := strings.TrimRight(s.Issuer, "/")
	return ServerMetadata{
		Issuer: iss, AuthorizationEndpoint: strings.TrimRight(s.WebURL, "/") + "/oauth/authorize", TokenEndpoint: iss + "/oauth/token", RegistrationEndpoint: iss + "/oauth/register",
		ResponseTypes: []string{"code"}, GrantTypes: []string{"authorization_code", "refresh_token"}, CodeChallengeMethods: []string{"S256"},
		TokenEndpointAuthMethods: []string{"none"}, ScopesSupported: apikey.AllScopes,
	}
}

// ---- registration ----

var schemeRe = regexp.MustCompile(`^[a-z][a-z0-9+.-]{1,30}$`)
var blockedSchemes = map[string]bool{"javascript": true, "data": true, "file": true, "vbscript": true, "about": true, "blob": true, "ftp": true, "ws": true, "wss": true, "http+unix": true}

func isLoopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
}

// cleanRedirect accepts addresses an assistant can really be sent back to: https, http only on this
// computer, or an application's own scheme. Never a page that runs script, no fragments, no credentials.
func cleanRedirect(raw string) (string, error) {
	if raw == "" || len(raw) > 300 || strings.ContainsAny(raw, " \t\r\n\\") {
		return "", ErrInvalid("a return address is not valid")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" || u.User != nil || u.Scheme == "" {
		return "", ErrInvalid("a return address is not valid")
	}
	switch {
	case u.Scheme == "https" && u.Host != "":
	case u.Scheme == "http" && isLoopback(u.Hostname()):
	case u.Scheme != "http" && u.Scheme != "https" && schemeRe.MatchString(u.Scheme) && !blockedSchemes[u.Scheme]:
	default:
		return "", ErrInvalid("return addresses must use https, or http on this computer, or an application's own scheme")
	}
	return u.String(), nil
}

type Client struct {
	ID           string
	Name         string
	RedirectURIs []string
}

func cleanName(n string) string {
	n = strings.Join(strings.Fields(n), " ")
	var b strings.Builder
	for _, r := range n {
		if r >= ' ' && r != 0x7f && utf8.ValidRune(r) {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if r := []rune(out); len(r) > 80 {
		out = string(r[:80])
	}
	return strings.TrimSpace(out)
}

// Register records an assistant. Anyone can register (that is how the standard works), so it records nothing
// but a name and return addresses, hands out nothing, and is limited by the caller's address.
func (s *Service) Register(ctx context.Context, name string, redirects []string) (Client, error) {
	name = cleanName(name)
	if name == "" {
		name = "An assistant"
	}
	if len(redirects) == 0 || len(redirects) > 5 {
		return Client{}, ErrInvalid("give between 1 and 5 return addresses")
	}
	var clean []string
	for _, r := range redirects {
		c, err := cleanRedirect(r)
		if err != nil {
			return Client{}, err
		}
		if !slices.Contains(clean, c) {
			clean = append(clean, c)
		}
	}
	id := newSecret("oc_")
	q := dbgen.New(s.Pool)
	n, err := q.CountOAuthClients(ctx)
	if err != nil {
		return Client{}, err
	}
	if n >= MaxClients {
		_ = q.PurgeOAuthClients(ctx)
		if n, _ = q.CountOAuthClients(ctx); n >= MaxClients {
			return Client{}, ErrInvalid("too many assistants are registered right now; try again later")
		}
	}
	if err := q.InsertOAuthClient(ctx, dbgen.InsertOAuthClientParams{ClientID: id, Name: name, RedirectUris: clean}); err != nil {
		return Client{}, err
	}
	return Client{ID: id, Name: name, RedirectURIs: clean}, nil
}

func (s *Service) client(ctx context.Context, id string) (Client, error) {
	if len(id) < 20 || len(id) > 64 {
		return Client{}, ErrNotFound
	}
	r, err := dbgen.New(s.Pool).GetOAuthClient(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Client{}, ErrNotFound
	}
	if err != nil {
		return Client{}, err
	}
	return Client{ID: r.ClientID, Name: r.Name, RedirectURIs: r.RedirectUris}, nil
}

// ClientInfo is what the approval page shows about an assistant (any signed-in person may ask).
func (s *Service) ClientInfo(ctx context.Context, id string) (Client, error) {
	return s.client(ctx, id)
}

// redirectAllowed: exactly one of the registered addresses; for an address on this computer the port may differ,
// because such programs listen on whatever port is free.
func redirectAllowed(c Client, got string) bool {
	cu, err := url.Parse(got)
	if err != nil {
		return false
	}
	for _, reg := range c.RedirectURIs {
		if reg == got {
			return true
		}
		ru, err := url.Parse(reg)
		if err == nil && ru.Scheme == "http" && isLoopback(ru.Hostname()) && cu.Scheme == "http" && cu.Hostname() == ru.Hostname() && cu.Path == ru.Path && cu.RawQuery == ru.RawQuery {
			return true
		}
	}
	return false
}

// ---- approval ----

type AuthorizeInput struct {
	ClientID, RedirectURI, State, CodeChallenge, Method, Resource string
	Scopes                                                        []string
	Approve                                                       bool
}

var challengeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func withParams(base string, kv map[string]string) string {
	u, _ := url.Parse(base)
	q := u.Query()
	for k, v := range kv {
		if v != "" {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// Authorize (admins only) records the admin's answer and returns the address to send them to: back to the
// assistant with a one-time code, or with "access_denied". The address is only ever one the assistant
// registered, so a crafted link cannot send a code anywhere else.
func (s *Service) Authorize(ctx context.Context, t store.Tenant, in AuthorizeInput) (string, error) {
	if !t.Can(store.PermManage) {
		return "", store.ErrForbidden
	}
	c, err := s.client(ctx, in.ClientID)
	if err != nil {
		return "", ErrInvalid("that assistant is not registered")
	}
	if !redirectAllowed(c, in.RedirectURI) {
		return "", ErrInvalid("that return address is not one the assistant registered")
	}
	if in.Method != "S256" || !challengeRe.MatchString(in.CodeChallenge) {
		return "", ErrInvalid("the request is missing its proof key (PKCE, S256)")
	}
	if in.Resource != "" && in.Resource != s.Resource {
		return "", ErrInvalid("that is not this server's assistant address")
	}
	if !in.Approve {
		return withParams(in.RedirectURI, map[string]string{"error": "access_denied", "state": in.State}), nil
	}
	scopes, err := cleanScopes(in.Scopes)
	if err != nil {
		return "", err
	}
	if s.Allow != nil {
		if err := s.Allow(ctx, t.WorkspaceID); err != nil {
			return "", err
		}
	}
	code := newSecret("ac_")
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.CountOAuthGrants(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if n >= MaxGrants {
			return ErrInvalid("this workspace has 10 connected assistants; disconnect one first")
		}
		return q.InsertOAuthCode(ctx, dbgen.InsertOAuthCodeParams{
			CodeHash: hash(code), WorkspaceID: t.WorkspaceID, ClientID: c.ID, UserID: t.UserID, Scopes: scopes,
			RedirectUri: in.RedirectURI, CodeChallenge: in.CodeChallenge, ExpiresAt: s.now().Add(CodeLife),
		})
	})
	if err != nil {
		return "", err
	}
	return withParams(in.RedirectURI, map[string]string{"code": code, "state": in.State}), nil
}

func cleanScopes(in []string) ([]string, error) {
	var out []string
	for _, sc := range in {
		if !slices.Contains(apikey.AllScopes, sc) {
			return nil, ErrInvalid("unknown permission")
		}
		if !slices.Contains(out, sc) {
			out = append(out, sc)
		}
	}
	if len(out) == 0 {
		return nil, ErrInvalid("choose at least one permission")
	}
	return out, nil
}

// ---- trading a code or a refresh token for tokens ----

type Tokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	Scope        string
}

var verifierRe = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

func bad(code, desc string) error { return TokenError{Code: code, Description: desc} }

// approverStillAdmin: access rides on the person who approved it. If they are no longer an admin of the workspace,
// the grant stops working.
func approverStillAdmin(ctx context.Context, pool *pgxpool.Pool, ws, user uuid.UUID) bool {
	var role string
	err := store.WithTenant(ctx, pool, store.Tenant{WorkspaceID: ws, UserID: user, Role: store.RoleViewer}, func(q *dbgen.Queries) error {
		r, err := q.GetMemberRole(ctx, dbgen.GetMemberRoleParams{WorkspaceID: ws, UserID: user})
		role = r
		return err
	})
	return err == nil && role == string(store.RoleAdmin)
}

// Exchange trades an authorization code for tokens. The code works once, within five minutes, only for the
// assistant and return address it was made for, and only with the proof key the assistant chose at the start.
func (s *Service) Exchange(ctx context.Context, clientID, code, redirectURI, verifier, resource string) (Tokens, error) {
	if code == "" || len(code) > 100 || clientID == "" {
		return Tokens{}, bad("invalid_request", "a code and client_id are required")
	}
	if !verifierRe.MatchString(verifier) {
		return Tokens{}, bad("invalid_request", "code_verifier is missing or not valid")
	}
	if resource != "" && resource != s.Resource {
		return Tokens{}, bad("invalid_target", "unknown resource")
	}
	var row struct {
		ws, user                    uuid.UUID
		client, redirect, challenge string
		scopes                      []string
	}
	err := s.Pool.QueryRow(ctx, `SELECT workspace_id, client_id, user_id, scopes, redirect_uri, code_challenge FROM oauth_take_code($1)`, hash(code)).
		Scan(&row.ws, &row.client, &row.user, &row.scopes, &row.redirect, &row.challenge)
	if err != nil {
		return Tokens{}, bad("invalid_grant", "the code is wrong, expired or already used")
	}
	sum := sha256.Sum256([]byte(verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if row.client != clientID || row.redirect != redirectURI || subtle.ConstantTimeCompare([]byte(want), []byte(row.challenge)) != 1 {
		return Tokens{}, bad("invalid_grant", "the code does not match this request")
	}
	if !approverStillAdmin(ctx, s.Pool, row.ws, row.user) {
		return Tokens{}, bad("invalid_grant", "the approval is no longer valid")
	}
	if s.Allow != nil {
		if err := s.Allow(ctx, row.ws); err != nil {
			return Tokens{}, bad("invalid_grant", "this workspace's plan does not include this")
		}
	}
	c, err := s.client(ctx, clientID)
	if err != nil {
		return Tokens{}, bad("invalid_client", "unknown client")
	}
	t := store.Tenant{WorkspaceID: row.ws, UserID: row.user, Role: store.RoleAdmin}
	refresh := newSecret("fr_")
	var grant uuid.UUID
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) (err error) {
		grant, err = q.InsertOAuthGrant(ctx, dbgen.InsertOAuthGrantParams{
			WorkspaceID: row.ws, ClientID: c.ID, ClientName: c.Name, ApprovedBy: row.user, Scopes: row.scopes,
			RefreshHash: hash(refresh), RefreshExpiresAt: s.now().Add(RefreshLife),
		})
		return err
	}); err != nil {
		return Tokens{}, err
	}
	tok, key, err := s.mintAccess(ctx, t, grant, c.Name, row.scopes)
	if err != nil {
		_ = s.revoke(ctx, t, grant)
		return Tokens{}, err
	}
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.SetOAuthGrantKey(ctx, dbgen.SetOAuthGrantKeyParams{WorkspaceID: row.ws, ID: grant, KeyID: uuid.NullUUID{UUID: key, Valid: true}})
	}); err != nil {
		return Tokens{}, err
	}
	return Tokens{AccessToken: tok, RefreshToken: refresh, ExpiresIn: int(AccessTokenLife.Seconds()), Scope: strings.Join(row.scopes, " ")}, nil
}

func (s *Service) mintAccess(ctx context.Context, t store.Tenant, grant uuid.UUID, client string, scopes []string) (secret string, keyID uuid.UUID, err error) {
	k, secret, err := s.Keys.Create(ctx, t, "Assistant: "+client, apikey.Options{Scopes: scopes, GrantID: &grant, Lifetime: AccessTokenLife})
	return secret, k.ID, err
}

func (s *Service) revoke(ctx context.Context, t store.Tenant, grant uuid.UUID) error {
	var ended []string
	err := store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) (err error) {
		if _, err := q.RevokeOAuthGrant(ctx, dbgen.RevokeOAuthGrantParams{WorkspaceID: t.WorkspaceID, ID: grant}); err != nil {
			return err
		}
		ended, err = q.RevokeKeysOfGrant(ctx, dbgen.RevokeKeysOfGrantParams{WorkspaceID: t.WorkspaceID, OauthGrantID: uuid.NullUUID{UUID: grant, Valid: true}})
		return err
	})
	s.Keys.Forget(ctx, ended...)
	return err
}

// Refresh trades a refresh token for new tokens. The old refresh token and the old access token stop working at
// once. A refresh token that was already replaced being presented again means it was copied, so the whole
// grant is ended.
func (s *Service) Refresh(ctx context.Context, clientID, refresh string) (Tokens, error) {
	if refresh == "" || len(refresh) > 100 || clientID == "" {
		return Tokens{}, bad("invalid_request", "refresh_token and client_id are required")
	}
	h := hash(refresh)
	var grant, ws uuid.UUID
	var client, which string
	if err := s.Pool.QueryRow(ctx, `SELECT grant_id, workspace_id, client_id, which FROM oauth_grant_for_refresh($1)`, h).Scan(&grant, &ws, &client, &which); err != nil {
		return Tokens{}, bad("invalid_grant", "the refresh token is not valid")
	}
	if client != clientID {
		return Tokens{}, bad("invalid_grant", "the refresh token is not valid")
	}
	var out Tokens
	var reuse bool
	var replaced []string
	sys := store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
	err := store.WithTenantTx(ctx, s.Pool, sys, func(_ pgx.Tx, q *dbgen.Queries) error {
		g, err := q.GetOAuthGrantForUpdate(ctx, dbgen.GetOAuthGrantForUpdateParams{WorkspaceID: ws, ID: grant})
		if err != nil {
			return bad("invalid_grant", "the refresh token is not valid")
		}
		if g.RevokedAt.Valid || s.now().After(g.RefreshExpiresAt) {
			return bad("invalid_grant", "the refresh token is not valid")
		}
		if g.RefreshHash != h { // it was current a moment ago, and has been replaced: this is a second use
			reuse = true
			return nil
		}
		if !approverStillAdmin(ctx, s.Pool, ws, g.ApprovedBy) {
			return bad("invalid_grant", "the approval is no longer valid")
		}
		if s.Allow != nil {
			if err := s.Allow(ctx, ws); err != nil {
				return bad("invalid_grant", "this workspace's plan does not include this")
			}
		}
		t := store.Tenant{WorkspaceID: ws, UserID: g.ApprovedBy, Role: store.RoleAdmin}
		next := newSecret("fr_")
		tok, key, err := s.mintAccess(ctx, t, grant, g.ClientName, g.Scopes)
		if err != nil {
			return err
		}
		if replaced, err = q.RevokeKeysOfGrantExcept(ctx, dbgen.RevokeKeysOfGrantExceptParams{WorkspaceID: ws, OauthGrantID: uuid.NullUUID{UUID: grant, Valid: true}, ID: key}); err != nil {
			return err
		}
		if err := q.RotateOAuthGrant(ctx, dbgen.RotateOAuthGrantParams{WorkspaceID: ws, ID: grant, RefreshHash: hash(next), RefreshExpiresAt: s.now().Add(RefreshLife), KeyID: uuid.NullUUID{UUID: key, Valid: true}}); err != nil {
			return err
		}
		out = Tokens{AccessToken: tok, RefreshToken: next, ExpiresIn: int(AccessTokenLife.Seconds()), Scope: strings.Join(g.Scopes, " ")}
		return nil
	})
	s.Keys.Forget(ctx, replaced...) // the old access token stops working now, not when its entry runs out
	if reuse {
		_ = s.revoke(ctx, sys, grant)
		return Tokens{}, bad("invalid_grant", "the refresh token is not valid")
	}
	return out, err
}

// ---- what admins see ----

type Grant struct {
	ID         uuid.UUID
	ClientName string
	Scopes     []string
	CreatedAt  time.Time
	LastUsedAt *time.Time
}

func (s *Service) Grants(ctx context.Context, t store.Tenant) ([]Grant, error) {
	if !t.Can(store.PermManage) {
		return nil, store.ErrForbidden
	}
	out := []Grant{}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListOAuthGrants(ctx, t.WorkspaceID)
		for _, r := range rows {
			g := Grant{ID: r.ID, ClientName: r.ClientName, Scopes: r.Scopes, CreatedAt: r.CreatedAt}
			if r.LastUsedAt.Valid {
				v := r.LastUsedAt.Time
				g.LastUsedAt = &v
			}
			out = append(out, g)
		}
		return err
	})
	return out, err
}

// Disconnect (admins only) ends a grant: its access token stops working at once and its refresh token is dead.
func (s *Service) Disconnect(ctx context.Context, t store.Tenant, grant uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	var n int64
	var ended []string
	err := store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) (err error) {
		if n, err = q.RevokeOAuthGrant(ctx, dbgen.RevokeOAuthGrantParams{WorkspaceID: t.WorkspaceID, ID: grant}); err != nil {
			return err
		}
		ended, err = q.RevokeKeysOfGrant(ctx, dbgen.RevokeKeysOfGrantParams{WorkspaceID: t.WorkspaceID, OauthGrantID: uuid.NullUUID{UUID: grant, Valid: true}})
		return err
	})
	s.Keys.Forget(ctx, ended...)
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}
