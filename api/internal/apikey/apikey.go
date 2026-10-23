// Package apikey issues and checks the read-only keys used by integrations and AI assistants.
// A key is 32 random bytes, so a plain SHA-256 of it is enough to store: there is nothing to guess.
package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	Prefix    = "fk_"
	MaxActive = 10
)

var (
	ErrNotFound     = errors.New("apikey: not found")
	ErrBadKey       = errors.New("apikey: invalid key")
	errPrefixLength = 10
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type Service struct{ Pool *pgxpool.Pool }

type Key struct {
	ID         uuid.UUID
	Name       string
	Prefix     string
	CreatedAt  time.Time
	LastUsedAt *time.Time
	Revoked    bool
}

func hash(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(h[:])
}

// Create (admins only) makes a key and returns the secret, which cannot be read again.
func (s *Service) Create(ctx context.Context, t store.Tenant, name string) (Key, string, error) {
	if t.Role != store.RoleAdmin {
		return Key{}, "", store.ErrForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return Key{}, "", ErrInvalid("give the key a name of up to 80 characters")
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	secret := Prefix + base64.RawURLEncoding.EncodeToString(b)
	var out Key
	err := store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		n, err := q.CountActiveAPIKeys(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if n >= MaxActive {
			return ErrInvalid("a workspace can have at most 10 active keys; revoke one first")
		}
		r, err := q.CreateAPIKey(ctx, dbgen.CreateAPIKeyParams{WorkspaceID: t.WorkspaceID, Name: name, Prefix: secret[:errPrefixLength], KeyHash: hash(secret), CreatedBy: t.UserID})
		if err != nil {
			return err
		}
		out = Key{ID: r.ID, Name: name, Prefix: secret[:errPrefixLength], CreatedAt: r.CreatedAt}
		return nil
	})
	return out, secret, err
}

func (s *Service) List(ctx context.Context, t store.Tenant) ([]Key, error) {
	if t.Role != store.RoleAdmin {
		return nil, store.ErrForbidden
	}
	out := []Key{}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListAPIKeys(ctx, t.WorkspaceID)
		for _, r := range rows {
			k := Key{ID: r.ID, Name: r.Name, Prefix: r.Prefix, CreatedAt: r.CreatedAt, Revoked: r.RevokedAt.Valid}
			if r.LastUsedAt.Valid {
				lu := r.LastUsedAt.Time
				k.LastUsedAt = &lu
			}
			out = append(out, k)
		}
		return err
	})
	return out, err
}

func (s *Service) Revoke(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.RevokeAPIKey(ctx, dbgen.RevokeAPIKeyParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// Authenticate resolves a key to its workspace. A key that is unknown, revoked or malformed is just ErrBadKey.
func (s *Service) Authenticate(ctx context.Context, secret string) (keyID, workspaceID uuid.UUID, err error) {
	if !strings.HasPrefix(secret, Prefix) || len(secret) != len(Prefix)+43 {
		return uuid.Nil, uuid.Nil, ErrBadKey
	}
	h := hash(secret)
	var id, ws uuid.UUID
	if err := s.Pool.QueryRow(ctx, `SELECT id, workspace_id FROM api_key_lookup($1)`, h).Scan(&id, &ws); err != nil {
		return uuid.Nil, uuid.Nil, ErrBadKey
	}
	return id, ws, nil
}
