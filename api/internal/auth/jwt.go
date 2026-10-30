// Package auth verifies Supabase-issued access tokens. It only proves who the
// caller is; membership and role come from our own tables afterwards.
package auth

import (
	"context"
	"errors"
	"fmt"
	"golang.org/x/time/rate"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ErrUnauthorized is the only error callers should surface to clients. The
// cause is for logs; never echo it in a response.
var ErrUnauthorized = errors.New("unauthorized")

type Verifier struct {
	keys     keyfunc.Keyfunc
	issuer   string
	audience string
}

// Config describes where keys come from and which tokens are acceptable.
type Config struct {
	JWKSURL  string // e.g. https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
	Issuer   string // exact match, e.g. https://<ref>.supabase.co/auth/v1
	Audience string // Supabase uses "authenticated"
	Client   *http.Client
}

// NewVerifier fetches the key set and keeps it fresh in the background. New
// or rotated keys are picked up without a restart; unknown key ids trigger a
// rate-limited refresh.
func NewVerifier(ctx context.Context, c Config) (*Verifier, error) {
	if c.JWKSURL == "" || c.Issuer == "" || c.Audience == "" {
		return nil, errors.New("auth: JWKSURL, Issuer and Audience are required")
	}
	override := keyfunc.Override{
		RefreshInterval: time.Hour, RateLimitWaitMax: 5 * time.Second, HTTPTimeout: 5 * time.Second,
		// Refetch when a token names a kid we do not hold, at most once every 30 seconds. Without
		// this, any key rotation (the dev identity provider regenerates on every start; hosted
		// providers rotate too) means an hour of rejected requests before the cache expires.
		RefreshUnknownKID: rate.NewLimiter(rate.Every(30*time.Second), 1),
	}
	if c.Client != nil {
		override.Client = c.Client
	}
	k, err := keyfunc.NewDefaultOverrideCtx(ctx, []string{c.JWKSURL}, override)
	if err != nil {
		return nil, fmt.Errorf("auth: load keys: %w", err)
	}
	return &Verifier{keys: k, issuer: c.Issuer, audience: c.Audience}, nil
}

// Identity is what a valid token proves.
type Identity struct {
	UserID uuid.UUID
	Email  string
	// EmailVerified is true only when the identity service says the person proved they own Email.
	// An unconfirmed address is a claim anyone can make, so it must never be matched to a customer.
	EmailVerified bool
}

type claims struct {
	jwt.RegisteredClaims
	Email        string `json:"email"`
	UserMetadata struct {
		EmailVerified bool `json:"email_verified"`
	} `json:"user_metadata"`
}

// Verify checks signature, algorithm, expiry, issuer and audience. Only
// asymmetric algorithms are accepted, which also rules out "none" and the
// HS256-with-public-key confusion attack.
func (v *Verifier) Verify(raw string) (Identity, error) {
	var c claims
	_, err := jwt.ParseWithClaims(raw, &c, v.keys.Keyfunc,
		jwt.WithValidMethods([]string{"ES256", "RS256", "EdDSA"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(5*time.Second),
	)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}
	id, err := uuid.Parse(c.Subject)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: bad subject", ErrUnauthorized)
	}
	return Identity{UserID: id, Email: c.Email, EmailVerified: c.UserMetadata.EmailVerified}, nil
}

// BearerToken extracts the token from an Authorization header.
func BearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if len(h) < 8 || !strings.EqualFold(h[:7], "bearer ") {
		return "", false
	}
	return strings.TrimSpace(h[7:]), true
}
