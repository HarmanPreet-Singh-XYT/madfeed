// Package hooks sends outbound webhooks: signed JSON messages to web addresses an admin chose, one per event.
//
// Events are written into outbound_delivery inside the transaction of the change that caused them (Emit), so a
// message exists if and only if the change committed. A loop (Sender.Loop) delivers them with bounded retries.
// Messages carry ids, names and titles, never customer quotes, emails or other personal data. Every address is
// checked when it is saved and again when it is dialled, so a name that later points at a private network
// is refused.
package hooks

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/secretbox"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// Event types an endpoint can subscribe to.
const (
	RequestCreated       = "request.created"
	RequestStatusChanged = "request.status_changed"
	SuggestionsReady     = "suggestions.ready"
	ReleaseNotePublished = "release_note.published"
	SurveyResponse       = "survey.response_completed"
	Ping                 = "ping"
)

// Events lists what can be subscribed to (ping is only ever sent by the test button).
var Events = []string{RequestCreated, RequestStatusChanged, SuggestionsReady, ReleaseNotePublished, SurveyResponse}

const (
	// MaxEndpoints keeps one workspace from fanning every event out to a long list of addresses.
	MaxEndpoints = 10
	// PauseAfter consecutive failed attempts switch an endpoint off until an admin turns it back on.
	PauseAfter = 30
	// MaxAttempts per delivery; after the last the delivery is marked failed.
	MaxAttempts = 8
)

var (
	ErrNotFound = errors.New("hooks: not found")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// Service manages endpoints (admins only).
type Service struct {
	Pool *pgxpool.Pool
	Box  *secretbox.Box
	// AllowPrivate lets addresses on private networks and plain http through. For local development and tests only.
	AllowPrivate bool
}

// Available says whether endpoints can be stored here (a SECRETS_KEY is set, so signing secrets can be sealed).
func (s *Service) Available() bool { return s.Box != nil }

type Endpoint struct {
	ID                  uuid.UUID
	URL                 string
	Description         string
	Events              []string
	Enabled             bool
	PausedReason        string
	ConsecutiveFailures int
	CreatedAt           time.Time
	Format              string
}

type Input struct {
	Format      string // json (default), slack, discord or teams
	URL         string
	Description string
	Events      []string
}

func owner(ws, id uuid.UUID) string { return ws.String() + "|webhook|" + id.String() }

func newSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "whsec_" + base64.RawURLEncoding.EncodeToString(b), nil
}

// CheckURL says whether an address may be saved. The same rules are enforced again when connecting.
func (s *Service) CheckURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Hostname() == "" {
		return "", ErrInvalid("enter a full web address, for example https://example.com/hook")
	}
	if u.User != nil {
		return "", ErrInvalid("the address cannot contain a user name or password; use the signature to check messages instead")
	}
	if u.Fragment != "" {
		return "", ErrInvalid("the address cannot contain a #fragment")
	}
	if u.Scheme != "https" && !(s.AllowPrivate && u.Scheme == "http") {
		return "", ErrInvalid("the address must start with https://")
	}
	if !s.AllowPrivate {
		h := strings.ToLower(u.Hostname())
		if h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") {
			return "", ErrInvalid("that address points inside a private network, which messages cannot be sent to")
		}
		if ip, err := netip.ParseAddr(h); err == nil && blockedIP(ip) {
			return "", ErrInvalid("that address points inside a private network, which messages cannot be sent to")
		}
	}
	return u.String(), nil
}

func cleanEvents(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, e := range in {
		if !slices.Contains(Events, e) {
			return nil, ErrInvalid("unknown event: " + e)
		}
		if !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	if len(out) == 0 {
		return nil, ErrInvalid("choose at least one event")
	}
	return out, nil
}

// Formats an endpoint can use. "json" is the signed envelope for programs; the others are the message shapes of
// chat tools, so a channel can be notified directly.
var Formats = []string{"json", "slack", "discord", "teams"}

func (in Input) clean(s *Service) (Input, error) {
	if in.Format == "" {
		in.Format = "json"
	}
	if !slices.Contains(Formats, in.Format) {
		return in, ErrInvalid("unknown format: " + in.Format)
	}
	u, err := s.CheckURL(in.URL)
	if err != nil {
		return in, err
	}
	desc := strings.TrimSpace(in.Description)
	if len([]rune(desc)) > 200 {
		return in, ErrInvalid("the description can be at most 200 characters")
	}
	ev, err := cleanEvents(in.Events)
	if err != nil {
		return in, err
	}
	return Input{URL: u, Description: desc, Events: ev, Format: in.Format}, nil
}

func (s *Service) admin(t store.Tenant) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	if s.Box == nil {
		return ErrInvalid("webhooks are not set up on this server yet")
	}
	return nil
}

const endpointCols = `id, url, description, events, enabled, paused_reason, consecutive_failures, created_at, format`

func scanEndpoint(r pgx.Row) (Endpoint, error) {
	var e Endpoint
	err := r.Scan(&e.ID, &e.URL, &e.Description, &e.Events, &e.Enabled, &e.PausedReason, &e.ConsecutiveFailures, &e.CreatedAt, &e.Format)
	return e, err
}

// List (admins only) shows the endpoints. Secrets are never returned.
func (s *Service) List(ctx context.Context, t store.Tenant) ([]Endpoint, error) {
	if t.Role != store.RoleAdmin {
		return nil, store.ErrForbidden
	}
	out := []Endpoint{}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		rows, err := tx.Query(ctx, `SELECT `+endpointCols+` FROM outbound_endpoint WHERE workspace_id = $1 ORDER BY created_at, id`, t.WorkspaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			e, err := scanEndpoint(rows)
			if err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	return out, err
}

// Create (admins only) saves an endpoint and returns its signing secret. This is the only time it is shown.
func (s *Service) Create(ctx context.Context, t store.Tenant, in Input) (Endpoint, string, error) {
	var e Endpoint
	if err := s.admin(t); err != nil {
		return e, "", err
	}
	in, err := in.clean(s)
	if err != nil {
		return e, "", err
	}
	secret, err := newSecret()
	if err != nil {
		return e, "", err
	}
	id := uuid.New()
	sealed := s.Box.Seal([]byte(secret), owner(t.WorkspaceID, id))
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM outbound_endpoint WHERE workspace_id = $1`, t.WorkspaceID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxEndpoints {
			return ErrInvalid(fmt.Sprintf("a workspace can have at most %d addresses; remove one first", MaxEndpoints))
		}
		e, err = scanEndpoint(tx.QueryRow(ctx,
			`INSERT INTO outbound_endpoint (id, workspace_id, url, description, events, secret, created_by, format) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+endpointCols,
			id, t.WorkspaceID, in.URL, in.Description, in.Events, sealed, t.UserID, in.Format))
		return err
	})
	return e, secret, err
}

// Update (admins only) changes the address, description and events. Turning an endpoint on again clears its failure count.
func (s *Service) Update(ctx context.Context, t store.Tenant, id uuid.UUID, in Input, enabled bool) error {
	if err := s.admin(t); err != nil {
		return err
	}
	in, err := in.clean(s)
	if err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		tag, err := tx.Exec(ctx, `
			UPDATE outbound_endpoint SET url = $3, description = $4, events = $5, enabled = $6, format = $7,
			  consecutive_failures = CASE WHEN $6 AND NOT enabled THEN 0 ELSE consecutive_failures END,
			  paused_reason = CASE WHEN $6 THEN '' ELSE paused_reason END
			WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id, in.URL, in.Description, in.Events, enabled, in.Format)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// RotateSecret (admins only) replaces the signing secret and returns the new one (shown once). Messages already
// queued are signed with the new secret when they go out.
func (s *Service) RotateSecret(ctx context.Context, t store.Tenant, id uuid.UUID) (string, error) {
	if err := s.admin(t); err != nil {
		return "", err
	}
	secret, err := newSecret()
	if err != nil {
		return "", err
	}
	sealed := s.Box.Seal([]byte(secret), owner(t.WorkspaceID, id))
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		tag, err := tx.Exec(ctx, `UPDATE outbound_endpoint SET secret = $3 WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id, sealed)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
	return secret, err
}

// Delete (admins only) removes an endpoint and its delivery history.
func (s *Service) Delete(ctx context.Context, t store.Tenant, id uuid.UUID) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		tag, err := tx.Exec(ctx, `DELETE FROM outbound_endpoint WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// SendTest (admins only) queues a ping to one endpoint, even if it is switched off or not subscribed to anything in particular.
func (s *Service) SendTest(ctx context.Context, t store.Tenant, id uuid.UUID) (uuid.UUID, error) {
	var did uuid.UUID
	if err := s.admin(t); err != nil {
		return did, err
	}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var one int
		if err := tx.QueryRow(ctx, `SELECT 1 FROM outbound_endpoint WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id).Scan(&one); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		payload, _ := envelope(uuid.New(), Ping, t.WorkspaceID, map[string]any{"message": "This is a test message."})
		return tx.QueryRow(ctx,
			`INSERT INTO outbound_delivery (workspace_id, endpoint_id, event_id, event_type, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			t.WorkspaceID, id, uuid.New(), Ping, payload).Scan(&did)
	})
	return did, err
}

type Delivery struct {
	ID         uuid.UUID
	EventType  string
	State      string
	Attempts   int
	LastStatus *int
	LastError  string
	CreatedAt  time.Time
	SentAt     *time.Time
}

// Deliveries (admins only) shows the latest messages to one endpoint and how each went.
func (s *Service) Deliveries(ctx context.Context, t store.Tenant, id uuid.UUID) ([]Delivery, error) {
	if t.Role != store.RoleAdmin {
		return nil, store.ErrForbidden
	}
	out := []Delivery{}
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var one int
		if err := tx.QueryRow(ctx, `SELECT 1 FROM outbound_endpoint WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, id).Scan(&one); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT id, event_type, state, attempts, last_status, last_error, created_at, sent_at
			FROM outbound_delivery WHERE workspace_id = $1 AND endpoint_id = $2 ORDER BY created_at DESC, id LIMIT 50`, t.WorkspaceID, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d Delivery
			if err := rows.Scan(&d.ID, &d.EventType, &d.State, &d.Attempts, &d.LastStatus, &d.LastError, &d.CreatedAt, &d.SentAt); err != nil {
				return err
			}
			out = append(out, d)
		}
		return rows.Err()
	})
	return out, err
}

// envelope is the JSON every message carries. The id is the same on every retry.
func envelope(id uuid.UUID, typ string, ws uuid.UUID, data any) ([]byte, error) {
	return json.Marshal(map[string]any{
		"id":          id,
		"type":        typ,
		"createdAt":   time.Now().UTC().Format(time.RFC3339),
		"workspaceId": ws,
		"data":        data,
	})
}

// Emit records an event for every enabled endpoint that subscribes to it, inside the caller's transaction (which
// must belong to the workspace). With no subscribers it costs one small query.
func Emit(ctx context.Context, tx pgx.Tx, ws uuid.UUID, typ string, data any) error {
	id := uuid.New() // one event id for every endpoint and every retry
	payload, err := envelope(id, typ, ws, data)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO outbound_delivery (workspace_id, endpoint_id, event_id, event_type, payload)
		SELECT workspace_id, id, $3, $2, $4 FROM outbound_endpoint
		WHERE workspace_id = $1 AND enabled AND $2 = ANY (events)`, ws, typ, id, payload)
	return err
}

// RequestTitle looks up a request's title for an event message, inside the caller's transaction.
func RequestTitle(ctx context.Context, tx pgx.Tx, ws, id uuid.UUID) string {
	var title string
	_ = tx.QueryRow(ctx, `SELECT title FROM request WHERE workspace_id = $1 AND id = $2`, ws, id).Scan(&title)
	return title
}
