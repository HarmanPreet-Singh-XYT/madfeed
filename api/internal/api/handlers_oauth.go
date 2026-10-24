package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/oauth"
	"product/api/internal/ratelimit"
)

func (s *Server) oauthReady() error {
	if s.OAuth == nil {
		return errNotConfigured
	}
	return nil
}

func (s *Server) GetOAuthClient(ctx context.Context, req GetOAuthClientRequestObject) (GetOAuthClientResponseObject, error) {
	if err := s.oauthReady(); err != nil {
		return nil, err
	}
	c, err := s.OAuth.ClientInfo(ctx, req.ClientId)
	if err != nil {
		return nil, err
	}
	return GetOAuthClient200JSONResponse{Name: c.Name, RedirectUris: c.RedirectURIs}, nil
}

func (s *Server) AuthorizeAssistant(ctx context.Context, req AuthorizeAssistantRequestObject) (AuthorizeAssistantResponseObject, error) {
	if err := s.oauthReady(); err != nil {
		return nil, err
	}
	b := req.Body
	t, err := s.tenant(ctx, b.WorkspaceId)
	if err != nil {
		return nil, err
	}
	in := oauth.AuthorizeInput{ClientID: b.ClientId, RedirectURI: b.RedirectUri, CodeChallenge: b.CodeChallenge, Method: string(b.CodeChallengeMethod), Approve: b.Approve}
	if b.State != nil {
		in.State = *b.State
	}
	if b.Resource != nil {
		in.Resource = *b.Resource
	}
	for _, sc := range b.Scopes {
		in.Scopes = append(in.Scopes, string(sc))
	}
	u, err := s.OAuth.Authorize(ctx, t, in)
	if err != nil {
		return nil, err
	}
	return AuthorizeAssistant200JSONResponse{RedirectUrl: u}, nil
}

func (s *Server) ListOAuthGrants(ctx context.Context, req ListOAuthGrantsRequestObject) (ListOAuthGrantsResponseObject, error) {
	if err := s.oauthReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	gs, err := s.OAuth.Grants(ctx, t)
	if err != nil {
		return nil, err
	}
	type g = struct {
		ClientName string                                           `json:"clientName"`
		CreatedAt  time.Time                                        `json:"createdAt"`
		Id         openapi_types.UUID                               `json:"id"`
		LastUsedAt *time.Time                                       `json:"lastUsedAt,omitempty"`
		Scopes     []ListOAuthGrants200JSONResponseBodyGrantsScopes `json:"scopes"`
	}
	out := ListOAuthGrants200JSONResponse{Grants: make([]g, 0, len(gs))}
	for _, x := range gs {
		row := g{ClientName: x.ClientName, CreatedAt: x.CreatedAt, Id: x.ID, LastUsedAt: x.LastUsedAt}
		for _, sc := range x.Scopes {
			row.Scopes = append(row.Scopes, ListOAuthGrants200JSONResponseBodyGrantsScopes(sc))
		}
		out.Grants = append(out.Grants, row)
	}
	return out, nil
}

func (s *Server) DisconnectAssistant(ctx context.Context, req DisconnectAssistantRequestObject) (DisconnectAssistantResponseObject, error) {
	if err := s.oauthReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.OAuth.Disconnect(ctx, t, req.GrantId); err != nil {
		return nil, err
	}
	return DisconnectAssistant204Response{}, nil
}

// ---- the parts the assistant itself calls (no sign-in; standard shapes) ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func oauthError(w http.ResponseWriter, status int, code, desc string) {
	writeJSON(w, status, map[string]string{"error": code, "error_description": desc})
}

// oauthWellKnown serves the two documents an assistant reads to find out how to connect.
func (s *Server) oauthWellKnown() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || s.OAuth == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", "*") // public documents
		if strings.HasPrefix(r.URL.Path, "/.well-known/oauth-protected-resource") {
			writeJSON(w, http.StatusOK, s.OAuth.ResourceMetadata())
			return
		}
		writeJSON(w, http.StatusOK, s.OAuth.ServerMetadata())
	})
}

// oauthRegister is dynamic client registration (RFC 7591) for public clients: anyone may register an assistant
// by name and return addresses; it gets an id and nothing else.
func (s *Server) oauthRegister() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.OAuth == nil {
			http.NotFound(w, r)
			return
		}
		if s.Limiter != nil {
			if d := s.Limiter.Allow(r.Context(), "oauth-register", ratelimit.ClientIP(r, s.Limits.TrustedHops), s.Limits.register(), 3600); !d.Allowed {
				ratelimit.Reject(w, d)
				return
			}
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
		var in struct {
			ClientName   string   `json:"client_name"`
			RedirectURIs []string `json:"redirect_uris"`
			AuthMethod   string   `json:"token_endpoint_auth_method"`
			GrantTypes   []string `json:"grant_types"`
		}
		if err != nil || json.Unmarshal(body, &in) != nil {
			oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "the request is not valid JSON")
			return
		}
		if in.AuthMethod != "" && in.AuthMethod != "none" {
			oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "only public clients (token_endpoint_auth_method none) are supported")
			return
		}
		for _, g := range in.GrantTypes {
			if g != "authorization_code" && g != "refresh_token" {
				oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "unsupported grant type")
				return
			}
		}
		c, err := s.OAuth.Register(r.Context(), in.ClientName, in.RedirectURIs)
		var ie oauth.ErrInvalid
		if errors.As(err, &ie) {
			oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", ie.Error())
			return
		}
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"client_id": c.ID, "client_name": c.Name, "redirect_uris": c.RedirectURIs, "token_endpoint_auth_method": "none",
			"grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"},
		})
	})
}

// oauthToken trades a one-time code or a refresh token for tokens (RFC 6749 with PKCE, RFC 7636).
func (s *Server) oauthToken() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.OAuth == nil {
			http.NotFound(w, r)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
		if err := r.ParseForm(); err != nil {
			oauthError(w, http.StatusBadRequest, "invalid_request", "the request must be a form")
			return
		}
		var tok oauth.Tokens
		var err error
		switch r.PostForm.Get("grant_type") {
		case "authorization_code":
			tok, err = s.OAuth.Exchange(r.Context(), r.PostForm.Get("client_id"), r.PostForm.Get("code"), r.PostForm.Get("redirect_uri"), r.PostForm.Get("code_verifier"), r.PostForm.Get("resource"))
		case "refresh_token":
			tok, err = s.OAuth.Refresh(r.Context(), r.PostForm.Get("client_id"), r.PostForm.Get("refresh_token"))
		default:
			oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "use authorization_code or refresh_token")
			return
		}
		var te oauth.TokenError
		switch {
		case err == nil:
			writeJSON(w, http.StatusOK, map[string]any{"access_token": tok.AccessToken, "token_type": "Bearer", "expires_in": tok.ExpiresIn, "refresh_token": tok.RefreshToken, "scope": tok.Scope})
		case errors.As(err, &te):
			status := http.StatusBadRequest
			if te.Code == "invalid_client" {
				status = http.StatusUnauthorized
			}
			oauthError(w, status, te.Code, te.Description)
		default:
			writeError(w, r, err)
		}
	})
}
