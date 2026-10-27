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
	"encoding/json"
	"errors"
	"log/slog"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/cache"
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
	ScopeWrite    = "write"    // change a request's status (never into or out of shipped) and add tags
)

var AllScopes = []string{ScopeRequests, ScopeQuotes, ScopeAsk, ScopeSubmit, ScopeWrite}

// DefaultScopes is what a new key can do if nothing else is asked: read everything, change nothing.
var DefaultScopes = []string{ScopeRequests, ScopeQuotes, ScopeAsk}

var (
	ErrNotFound = errors.New("apikey: not found")
	ErrBadKey   = errors.New("apikey: invalid key")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type Service struct {
	Pool *pgxpool.Pool
	// Cache, when set, remembers what a key may do for cache.KeyTTL, so a busy assistant does not look its key
	// up on every call. Whoever ends a key calls Forget after the commit.
	Cache cache.Store

	flight cache.Flight

	logMu  sync.RWMutex
	events chan usage // set while StartLog runs
}

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
	if !t.Can(store.PermManage) {
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
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		// Count and insert must not interleave with another request, or the limit can be passed.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "apikey:"+t.WorkspaceID.String()); err != nil {
			return err
		}
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
	if !t.Can(store.PermManage) {
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
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	var ended []string
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		if ended, err = q.RevokeAPIKey(ctx, dbgen.RevokeAPIKeyParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
			return err
		}
		if len(ended) == 0 {
			return ErrNotFound
		}
		return nil
	})
	s.Forget(ctx, ended...)
	return err
}

// Forget drops remembered keys by their stored hashes; call it once the change that ended them has committed.
func (s *Service) Forget(ctx context.Context, hashes ...string) {
	cache.ForgetAPIKeys(ctx, s.Cache, hashes...)
}

// remembered is what is kept about a key between calls: what it may do, never the secret.
type remembered struct {
	Info
	CIDRs   []string
	Expires *time.Time
}

// lookup finds the key behind a secret, from the cache when it is there and is still within its own expiry.
func (s *Service) lookup(ctx context.Context, secret string) (remembered, error) {
	h := hash(secret)
	if s.Cache != nil {
		if v, ok, err := s.Cache.Get(ctx, cache.APIKeyKey(h)); err == nil && ok {
			var r remembered
			if json.Unmarshal(v, &r) == nil && (r.Expires == nil || r.Expires.After(time.Now())) {
				return r, nil
			}
		}
	}
	r, err := cache.Load(ctx, &s.flight, cache.APIKeyKey(h), func(ctx context.Context) (remembered, error) {
		var r remembered
		var exp pgtype.Timestamptz
		if err := s.Pool.QueryRow(ctx, `SELECT id, workspace_id, name, scopes, allowed_cidrs, expires_at FROM api_key_lookup($1)`, h).Scan(&r.ID, &r.WorkspaceID, &r.Name, &r.Scopes, &r.CIDRs, &exp); err != nil {
			return remembered{}, ErrBadKey
		}
		if exp.Valid {
			e := exp.Time
			r.Expires = &e
		}
		return r, nil
	})
	if err != nil {
		return remembered{}, err
	}
	if s.Cache != nil {
		ttl := cache.KeyTTL
		if r.Expires != nil {
			ttl = min(ttl, time.Until(*r.Expires))
		}
		if v, err := json.Marshal(r); err == nil && ttl > 0 {
			_ = s.Cache.Set(ctx, cache.APIKeyKey(h), v, ttl)
		}
	}
	return r, nil
}

// Authenticate resolves a key used from clientIP. A key that is unknown, revoked, expired, malformed
// or used from an address it is not allowed from is just ErrBadKey, whatever the reason.
func (s *Service) Authenticate(ctx context.Context, secret, clientIP string) (Info, error) {
	if !strings.HasPrefix(secret, Prefix) || len(secret) != len(Prefix)+43 {
		return Info{}, ErrBadKey
	}
	r, err := s.lookup(ctx, secret)
	if err != nil {
		return Info{}, err
	}
	if len(r.CIDRs) > 0 { // checked on every call: the address is the caller's, not the key's
		ip, err := netip.ParseAddr(clientIP)
		if err != nil {
			return Info{}, ErrBadKey
		}
		ip = ip.Unmap()
		ok := false
		for _, c := range r.CIDRs {
			if p, perr := netip.ParsePrefix(c); perr == nil && p.Contains(ip) {
				ok = true
				break
			}
		}
		if !ok {
			return Info{}, ErrBadKey
		}
	}
	return r.Info, nil
}

// ---- the log of what a key did ----

type Event struct {
	At     time.Time
	Action string
	Detail string
	OK     bool
}

// usage is one use of a key, waiting to be written.
// flushEvery is how long a usage entry can wait before it is written.
const flushEvery = 250 * time.Millisecond

type usage struct {
	in             Info
	action, detail string
	ok             bool
	at             time.Time // when it happened, not when it was written
}

// Record notes one use of a key. Best effort: a failure to log never stops the request. While StartLog runs the
// entry is queued and written with its neighbours; otherwise it is written now.
func (s *Service) Record(ctx context.Context, in Info, action, detail string, ok bool) {
	if len(detail) > 200 {
		detail = strings.ToValidUTF8(detail[:200], "") // a cut inside a character would make the insert fail
	}
	u := usage{in, action, detail, ok, time.Now()}
	// Held while sending, so StartLog's shutdown cannot close the queue between the check and the send.
	s.logMu.RLock()
	if s.events != nil {
		select {
		case s.events <- u:
			s.logMu.RUnlock()
			return
		default: // the queue is full: write this one directly rather than drop it
		}
	}
	s.logMu.RUnlock()
	s.writeUsage(context.WithoutCancel(ctx), []usage{u})
}

// StartLog batches what Record is given into one write per workspace every flushEvery, so a busy key costs a few
// transactions a second instead of one per call, while an admin opening the activity view sees a call at once. When ctx ends it writes what is left and Record goes back to
// writing directly. The returned function waits for that to finish.
func (s *Service) StartLog(ctx context.Context) (wait func()) {
	ch := make(chan usage, 1024)
	s.logMu.Lock()
	s.events = ch
	s.logMu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(flushEvery)
		defer tick.Stop()
		var batch []usage
		flush := func() {
			if len(batch) > 0 {
				s.writeUsage(context.Background(), batch)
				batch = batch[:0]
			}
		}
		for {
			select {
			case u := <-ch:
				if batch = append(batch, u); len(batch) >= 100 {
					flush()
				}
			case <-tick.C:
				flush()
			case <-ctx.Done():
				s.logMu.Lock() // waits for any Record mid-send; after this none can queue
				s.events = nil
				s.logMu.Unlock()
				for {
					select {
					case u := <-ch:
						batch = append(batch, u)
						continue
					default:
					}
					break
				}
				flush()
				return
			}
		}
	}()
	return func() { <-done }
}

// writeUsage stores entries, one transaction for each workspace they belong to.
func (s *Service) writeUsage(ctx context.Context, list []usage) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	byWS := map[uuid.UUID][]usage{}
	for _, u := range list {
		byWS[u.in.WorkspaceID] = append(byWS[u.in.WorkspaceID], u)
	}
	for ws, us := range byWS {
		keys, actions, details, oks, ats := make([]uuid.UUID, len(us)), make([]string, len(us)), make([]string, len(us)), make([]bool, len(us)), make([]time.Time, len(us))
		for i, u := range us {
			keys[i], actions[i], details[i], oks[i], ats[i] = u.in.ID, u.action, u.detail, u.ok, u.at
		}
		t := store.Tenant{WorkspaceID: ws, UserID: us[0].in.ID, Role: store.RoleViewer}
		err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
			// Each entry keeps the time it happened (a batch would otherwise share one), so the log reads in order.
			if _, err := tx.Exec(ctx, `INSERT INTO api_key_event (workspace_id, key_id, action, detail, ok, at)
				SELECT $1::uuid, k, a, d, o, t FROM unnest($2::uuid[], $3::text[], $4::text[], $5::bool[], $6::timestamptz[]) AS x(k, a, d, o, t)`, ws, keys, actions, details, oks, ats); err != nil {
				return err
			}
			if time.Now().UnixNano()%50 == 0 { // now and then, drop entries older than 30 days
				return q.PurgeKeyEvents(ctx, ws)
			}
			return nil
		})
		if err != nil && len(us) > 1 { // one bad entry must not take its neighbours with it
			for _, u := range us {
				s.writeUsage(ctx, []usage{u})
			}
			continue
		}
		if err != nil { // best effort, but not silent: the log is what an admin checks after something odd
			slog.Warn("key usage log could not be written", "workspace_id", ws, "entries", len(us), "error", err)
		}
	}
}

// Events (admins only) are the last things this key did.
func (s *Service) Events(ctx context.Context, t store.Tenant, id uuid.UUID) ([]Event, error) {
	if !t.Can(store.PermManage) {
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
