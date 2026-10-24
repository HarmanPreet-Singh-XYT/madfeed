// Package apikey issues and checks the keys used by integrations and AI assistants. A key belongs
// to one workspace and does only what its scopes allow; it can expire, be limited to certain
// network addresses, and leaves a short log of what it did. It is 32 random bytes, so a plain
// SHA-256 of it is enough to store: there is nothing to guess.
package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	Prefix    = "fk_"
	MaxActive = 10
	MaxDays   = 365
	MaxCIDRs  = 10

	// What a key may do.
	ScopeRequests = "requests" // list requests and read one (title, status, counts)
	ScopeQuotes   = "quotes"   // also see the customer quotes behind a request
	ScopeAsk      = "ask"      // ask questions; answers cite quotes
	ScopeSubmit   = "submit"   // add a note to the review queue (nothing is acted on until a person accepts it)
)

var AllScopes = []string{ScopeRequests, ScopeQuotes, ScopeAsk, ScopeSubmit}

// DefaultScopes is what a new key can do if nothing else is asked: read everything, change nothing.
var DefaultScopes = []string{ScopeRequests, ScopeQuotes, ScopeAsk}

var (
	ErrNotFound = errors.New("apikey: not found")
	ErrBadKey   = errors.New("apikey: invalid key")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type Service struct{ Pool *pgxpool.Pool }

type Key struct {
	ID           uuid.UUID
	Name         string
	Prefix       string
	CreatedAt    time.Time
	LastUsedAt   *time.Time
	ExpiresAt    *time.Time
	Revoked      bool
	Scopes       []string
	AllowedCIDRs []string
}

// Info is a key that has been checked and may be used from the address it came from.
type Info struct {
	ID, WorkspaceID uuid.UUID
	Name            string
	Scopes          []string
}

func (i Info) Has(scope string) bool { return slices.Contains(i.Scopes, scope) }

func hash(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(h[:])
}

// Options are what an admin chooses when making a key.
type Options struct {
	Scopes        []string // empty means DefaultScopes
	ExpiresInDays int      // 0 means it does not expire
	AllowedCIDRs  []string // empty means usable from anywhere
	// Set only by the sign-in flow for assistants: the key belongs to that grant, lasts Lifetime, is hidden
	// from the ordinary list and does not count against the plan's key limit.
	GrantID  *uuid.UUID
	Lifetime time.Duration
}

func cleanOptions(o Options) (scopes []string, expires *time.Time, cidrs []string, err error) {
	scopes = o.Scopes
	if len(scopes) == 0 {
		scopes = DefaultScopes
	}
	seen := map[string]bool{}
	var clean []string
	for _, sc := range scopes {
		if !slices.Contains(AllScopes, sc) {
			return nil, nil, nil, ErrInvalid("unknown permission " + `"` + sc + `"`)
		}
		if !seen[sc] {
			seen[sc] = true
			clean = append(clean, sc)
		}
	}
	if o.ExpiresInDays < 0 || o.ExpiresInDays > MaxDays {
		return nil, nil, nil, ErrInvalid("a key can last from 1 to 365 days")
	}
	if o.ExpiresInDays > 0 {
		t := time.Now().Add(time.Duration(o.ExpiresInDays) * 24 * time.Hour)
		expires = &t
	}
	if len(o.AllowedCIDRs) > MaxCIDRs {
		return nil, nil, nil, ErrInvalid("at most 10 allowed addresses")
	}
	for _, c := range o.AllowedCIDRs {
		p, perr := parsePrefix(strings.TrimSpace(c))
		if perr != nil {
			return nil, nil, nil, ErrInvalid("each allowed address must look like 203.0.113.7 or 203.0.113.0/24")
		}
		cidrs = append(cidrs, p.String())
	}
	return clean, expires, cidrs, nil
}

// parsePrefix accepts a single address or a network, and refuses "everywhere".
func parsePrefix(s string) (netip.Prefix, error) {
	if !strings.Contains(s, "/") {
		a, err := netip.ParseAddr(s)
		if err != nil {
			return netip.Prefix{}, err
		}
		return netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()), nil
	}
	p, err := netip.ParsePrefix(s)
	if err != nil || p.Bits() == 0 {
		return netip.Prefix{}, errors.New("bad network")
	}
	return p.Masked(), nil
}

// Create (admins only) makes a key and returns the secret, which cannot be read again.
func (s *Service) Create(ctx context.Context, t store.Tenant, name string, o Options) (Key, string, error) {
	if t.Role != store.RoleAdmin {
		return Key{}, "", store.ErrForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return Key{}, "", ErrInvalid("give the key a name of up to 80 characters")
	}
	scopes, expires, cidrs, err := cleanOptions(o)
	if err != nil {
		return Key{}, "", err
	}
	if o.Lifetime > 0 {
		e := time.Now().Add(o.Lifetime)
		expires = &e
	}
	if cidrs == nil {
		cidrs = []string{}
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	secret := Prefix + base64.RawURLEncoding.EncodeToString(b)
	var out Key
	err = store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		n, err := q.CountActiveAPIKeys(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if n >= MaxActive && o.GrantID == nil {
			return ErrInvalid("a workspace can have at most 10 active keys; revoke one first")
		}
		grant := uuid.NullUUID{}
		if o.GrantID != nil {
			grant = uuid.NullUUID{UUID: *o.GrantID, Valid: true}
		}
		exp := pgtype.Timestamptz{}
		if expires != nil {
			exp = pgtype.Timestamptz{Time: *expires, Valid: true}
		}
		r, err := q.CreateAPIKey(ctx, dbgen.CreateAPIKeyParams{WorkspaceID: t.WorkspaceID, Name: name, Prefix: secret[:10], KeyHash: hash(secret), CreatedBy: t.UserID, Scopes: scopes, ExpiresAt: exp, AllowedCidrs: cidrs, OauthGrantID: grant})
		if err != nil {
			return err
		}
		out = Key{ID: r.ID, Name: name, Prefix: secret[:10], CreatedAt: r.CreatedAt, ExpiresAt: expires, Scopes: scopes, AllowedCIDRs: cidrs}
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
			k := Key{ID: r.ID, Name: r.Name, Prefix: r.Prefix, CreatedAt: r.CreatedAt, Revoked: r.RevokedAt.Valid, Scopes: r.Scopes, AllowedCIDRs: r.AllowedCidrs}
			if r.LastUsedAt.Valid {
				lu := r.LastUsedAt.Time
				k.LastUsedAt = &lu
			}
			if r.ExpiresAt.Valid {
				ex := r.ExpiresAt.Time
				k.ExpiresAt = &ex
				if ex.Before(time.Now()) {
					k.Revoked = true // expired keys are listed as ended
				}
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

// Authenticate resolves a key used from clientIP. A key that is unknown, revoked, expired, malformed
// or used from an address it is not allowed from is just ErrBadKey, whatever the reason.
func (s *Service) Authenticate(ctx context.Context, secret, clientIP string) (Info, error) {
	if !strings.HasPrefix(secret, Prefix) || len(secret) != len(Prefix)+43 {
		return Info{}, ErrBadKey
	}
	var in Info
	var cidrs []string
	if err := s.Pool.QueryRow(ctx, `SELECT id, workspace_id, name, scopes, allowed_cidrs FROM api_key_lookup($1)`, hash(secret)).Scan(&in.ID, &in.WorkspaceID, &in.Name, &in.Scopes, &cidrs); err != nil {
		return Info{}, ErrBadKey
	}
	if len(cidrs) > 0 {
		ip, err := netip.ParseAddr(clientIP)
		if err != nil {
			return Info{}, ErrBadKey
		}
		ip = ip.Unmap()
		ok := false
		for _, c := range cidrs {
			if p, perr := netip.ParsePrefix(c); perr == nil && p.Contains(ip) {
				ok = true
				break
			}
		}
		if !ok {
			return Info{}, ErrBadKey
		}
	}
	return in, nil
}

// ---- the log of what a key did ----

type Event struct {
	At     time.Time
	Action string
	Detail string
	OK     bool
}

// Record notes one use of a key. Best effort: a failure to log never stops the request.
func (s *Service) Record(ctx context.Context, in Info, action, detail string, ok bool) {
	if len(detail) > 200 {
		detail = detail[:200]
	}
	t := store.Tenant{WorkspaceID: in.WorkspaceID, UserID: in.ID, Role: store.RoleViewer}
	_ = store.WithTenant(context.WithoutCancel(ctx), s.Pool, t, func(q *dbgen.Queries) error {
		if err := q.InsertKeyEvent(ctx, dbgen.InsertKeyEventParams{WorkspaceID: in.WorkspaceID, KeyID: in.ID, Action: action, Detail: detail, Ok: ok}); err != nil {
			return err
		}
		if time.Now().UnixNano()%50 == 0 { // now and then, drop entries older than 30 days
			return q.PurgeKeyEvents(ctx, in.WorkspaceID)
		}
		return nil
	})
}

// Events (admins only) are the last things this key did.
func (s *Service) Events(ctx context.Context, t store.Tenant, id uuid.UUID) ([]Event, error) {
	if t.Role != store.RoleAdmin {
		return nil, store.ErrForbidden
	}
	out := []Event{}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		ok, err := q.KeyExists(ctx, dbgen.KeyExistsParams{WorkspaceID: t.WorkspaceID, ID: id})
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		rows, err := q.ListKeyEvents(ctx, dbgen.ListKeyEventsParams{WorkspaceID: t.WorkspaceID, KeyID: id})
		for _, r := range rows {
			out = append(out, Event{At: r.At, Action: r.Action, Detail: r.Detail, OK: r.Ok})
		}
		return err
	})
	return out, err
}
