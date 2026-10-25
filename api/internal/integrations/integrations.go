// Package integrations connects a workspace to other services: a chat workspace that feedback is
// collected from, and an issue tracker whose issues follow requests. Credentials are sealed with the
// server's SECRETS_KEY; each connection has a plain state (connected, or needs reconnecting); and
// nothing here acts on anything without the same checks a person's action would face.
package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/intake"
	"product/api/internal/secretbox"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/workflow"
)

var (
	ErrNotFound       = errors.New("integrations: not found")
	ErrNotConnected   = errors.New("integrations: not connected")
	ErrNeedsReconnect = errors.New("integrations: the connection needs to be set up again")
	ErrBadSignature   = errors.New("integrations: signature does not verify")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// Service holds what every connection needs. Without a Box (no SECRETS_KEY) nothing can be connected.
type Service struct {
	Pool     *pgxpool.Pool
	Box      *secretbox.Box
	Intake   *intake.Service
	Workflow *workflow.Service
	HTTP     *http.Client
	Now      func() time.Time

	Slack   SlackConfig
	GitHub  GitHubConfig
	Linear  LinearConfig
	Jira    JiraConfig
	HubSpot HubSpotConfig
	// WebURL is the public address of the web app, used for links back to requests and for sign-in redirects.
	WebURL string
}

// Available says whether connections can be stored on this server (a SECRETS_KEY is set).
func (s *Service) Available() bool { return s.Box != nil }

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) client() *http.Client {
	if s.HTTP != nil {
		return s.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func (s *Service) ready() error {
	if s.Box == nil {
		return ErrInvalid("connections are not set up on this server yet")
	}
	return nil
}

func owner(ws uuid.UUID, kind string) string { return ws.String() + "|" + kind }

func system(ws uuid.UUID, role store.Role) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: role}
}

// Status is what a person is shown about one connection. It carries no credentials.
type Status struct {
	Kind        string
	State       string // connected, needs_reconnect
	Summary     string // for example the chat workspace's name, or owner/repo
	Detail      string // for example the chosen channel
	LastOK      *time.Time
	LastError   string
	ConnectedAt time.Time
}

func (s *Service) List(ctx context.Context, t store.Tenant) ([]Status, error) {
	if t.Role != store.RoleAdmin {
		return nil, store.ErrForbidden
	}
	out := []Status{}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListIntegrations(ctx, t.WorkspaceID)
		for _, r := range rows {
			st := Status{Kind: r.Kind, State: r.State, LastError: r.LastError, ConnectedAt: r.ConnectedAt}
			if r.LastOkAt.Valid {
				v := r.LastOkAt.Time
				st.LastOK = &v
			}
			var cfg map[string]any
			_ = json.Unmarshal(r.Config, &cfg)
			st.Summary, st.Detail = describe(r.Kind, cfg)
			out = append(out, st)
		}
		return err
	})
	return out, err
}

func str(m map[string]any, k string) string {
	v, _ := m[k].(string)
	return v
}

func describe(kind string, cfg map[string]any) (string, string) {
	switch kind {
	case "slack":
		d := ""
		if c := str(cfg, "channelName"); c != "" {
			d = "#" + c
		}
		return str(cfg, "teamName"), d
	case "github":
		return str(cfg, "repo"), ""
	case "linear":
		return str(cfg, "teamKey"), str(cfg, "teamName")
	case "jira":
		return str(cfg, "project"), str(cfg, "site") + ".atlassian.net"
	case "hubspot":
		return "HubSpot", map[string]string{"revenue": "value from company annual revenue", "won_deals": "value from closed-won deals"}[str(cfg, "valueFrom")]
	}
	return "", ""
}

// Disconnect (admins only) forgets the credentials. Data already collected stays.
func (s *Service) Disconnect(ctx context.Context, t store.Tenant, kind string) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.DeleteIntegration(ctx, dbgen.DeleteIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: kind})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// load opens a connection's sealed credentials into v.
func (s *Service) load(ctx context.Context, ws uuid.UUID, kind string, v any) (dbgen.Integration, error) {
	var row dbgen.Integration
	err := store.WithTenant(ctx, s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) (err error) {
		row, err = q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: ws, Kind: kind})
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, ErrNotConnected
	}
	if err != nil {
		return row, err
	}
	if s.Box == nil {
		return row, ErrInvalid("connections are not set up on this server yet")
	}
	raw, err := s.Box.Open(row.Secret, owner(ws, kind))
	if err != nil {
		return row, err
	}
	return row, json.Unmarshal(raw, v)
}

func (s *Service) markBroken(ctx context.Context, ws uuid.UUID, kind, why string) {
	_ = store.WithTenant(context.WithoutCancel(ctx), s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
		return q.MarkIntegrationBroken(ctx, dbgen.MarkIntegrationBrokenParams{WorkspaceID: ws, Kind: kind, LastError: why})
	})
}

func (s *Service) markOK(ctx context.Context, ws uuid.UUID, kind string) {
	_ = store.WithTenant(context.WithoutCancel(ctx), s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
		return q.MarkIntegrationOK(ctx, dbgen.MarkIntegrationOKParams{WorkspaceID: ws, Kind: kind})
	})
}
