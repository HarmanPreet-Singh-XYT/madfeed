package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// A tracker driver is everything that is particular to one issue tracker: what an admin must fill in, how to
// check it, how to open an issue, and how to read a notification. Everything else (one tracker at a time,
// sealed credentials, the status mapping, conflict handling, switching on and off) is shared. Adding a tracker
// means writing one driver and listing its kind in Kinds, trackerNames and the database checks.
type trackerDriver interface {
	Kind() string
	Name() string
	// Intro is one plain sentence about what connecting does.
	Intro() string
	Fields() []FieldSpec
	// Connect checks what the admin entered against the service and returns what to store and what to show once.
	Connect(ctx context.Context, s *Service, t store.Tenant, in map[string]string) (connectResult, error)
	Create(ctx context.Context, s *Service, ws uuid.UUID, title, body string) (madeIssue, error)
	Check(ctx context.Context, s *Service, ws uuid.UUID) error
	Event(ctx context.Context, s *Service, ws uuid.UUID, r EventRequest) (EventResult, error)
	// Disconnect is best effort: undo anything made at the service (a webhook), never fail the disconnect.
	Disconnect(ctx context.Context, s *Service, ws uuid.UUID)
}

// FieldSpec describes one box on the connect form.
type FieldSpec struct {
	Name, Label, Help string
	Secret, Optional  bool
}

// Shown is a value to show the admin once, after connecting.
type Shown struct {
	Label, Value string
	Secret       bool
}

type connectResult struct {
	Driver  any // the driver's own settings, stored in plain config
	Creds   any // sealed
	Summary string
	Detail  string
	Show    []Shown
	Note    string
	// After runs once the connection is stored (for example, to register a webhook that needs it). If it fails,
	// the connection is removed again. It may return more driver settings to keep.
	After func(ctx context.Context) (patch map[string]any, err error)
}

// EventRequest is a notification as it arrived.
type EventRequest struct {
	Body   []byte
	Header http.Header
}

// EventResult is what to do about a notification: answer with these headers, and apply these changes.
type EventResult struct {
	Reply  map[string]string
	Events []issueEvent
}

var trackerDrivers = map[string]trackerDriver{}

func registerTracker(d trackerDriver) { trackerDrivers[d.Kind()] = d }

func init() {
	for _, d := range []trackerDriver{clickupDriver{}, asanaDriver{}, azureDriver{}} {
		registerTracker(d)
		trackerNames[d.Kind()] = d.Name()
	}
}

// genericConfig is what is stored in plain config for a driver-based tracker.
type genericConfig struct {
	Summary        string          `json:"summary"`
	Detail         string          `json:"detail"`
	CloseStatusID  string          `json:"closeStatusId,omitempty"`
	ReopenStatusID string          `json:"reopenStatusId,omitempty"`
	Driver         json.RawMessage `json:"driver,omitempty"`
}

func (s *Service) trackerWebhookURL(kind string, ws uuid.UUID) string {
	return strings.TrimRight(s.GitHub.APIURL, "/") + "/v1/integrations/" + kind + "/" + ws.String() + "/events"
}

// TrackerCatalogEntry is what the screens need to draw a connect form.
type TrackerCatalogEntry struct {
	Kind, Name, Intro string
	Fields            []FieldSpec
}

// TrackerCatalog lists the driver-based trackers that are switched on, in a fixed order.
func (s *Service) TrackerCatalog() []TrackerCatalogEntry {
	out := []TrackerCatalogEntry{}
	for _, k := range Kinds {
		if d, ok := trackerDrivers[k]; ok && s.On(k) {
			out = append(out, TrackerCatalogEntry{Kind: k, Name: d.Name(), Intro: d.Intro(), Fields: d.Fields()})
		}
	}
	return out
}

func (s *Service) driver(kind string) (trackerDriver, error) {
	d, ok := trackerDrivers[kind]
	if !ok || !s.On(kind) {
		return nil, ErrNotFound
	}
	return d, nil
}

type TrackerSetup struct {
	WebhookURL string
	Show       []Shown
	Note       string
}

// TrackerConnect (admins only) connects one workspace to a driver-based tracker.
func (s *Service) TrackerConnect(ctx context.Context, t store.Tenant, kind string, in map[string]string, closeID, reopenID *uuid.UUID) (TrackerSetup, error) {
	if !t.Can(store.PermManage) {
		return TrackerSetup{}, store.ErrForbidden
	}
	d, err := s.driver(kind)
	if err != nil {
		return TrackerSetup{}, err
	}
	if err := s.ready(); err != nil {
		return TrackerSetup{}, err
	}
	if err := s.noOtherTracker(ctx, t, kind); err != nil {
		return TrackerSetup{}, err
	}
	if err := s.validStatus(ctx, t, closeID); err != nil {
		return TrackerSetup{}, err
	}
	if err := s.validStatus(ctx, t, reopenID); err != nil {
		return TrackerSetup{}, err
	}
	clean := map[string]string{}
	for _, f := range d.Fields() {
		v := strings.TrimSpace(in[f.Name])
		if v == "" && !f.Optional {
			return TrackerSetup{}, ErrInvalid("fill in: " + f.Label)
		}
		if len(v) > 600 {
			return TrackerSetup{}, ErrInvalid(f.Label + " is too long")
		}
		clean[f.Name] = v
	}
	res, err := d.Connect(ctx, s, t, clean)
	if err != nil {
		return TrackerSetup{}, err
	}
	gc := genericConfig{Summary: clip(res.Summary, 200), Detail: clip(res.Detail, 200)}
	gc.Driver, _ = json.Marshal(res.Driver)
	if closeID != nil {
		gc.CloseStatusID = closeID.String()
	}
	if reopenID != nil {
		gc.ReopenStatusID = reopenID.String()
	}
	rawCfg, _ := json.Marshal(gc)
	rawCreds, _ := json.Marshal(res.Creds)
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: kind, Config: rawCfg,
			Secret: s.Box.Seal(rawCreds, owner(t.WorkspaceID, kind)), ConnectedBy: t.UserID,
		})
	})
	if err != nil {
		return TrackerSetup{}, err
	}
	if res.After != nil {
		patch, aerr := res.After(ctx)
		if aerr != nil {
			_ = store.WithTenant(context.WithoutCancel(ctx), s.Pool, t, func(q *dbgen.Queries) error {
				_, err := q.DeleteIntegration(ctx, dbgen.DeleteIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: kind})
				return err
			})
			return TrackerSetup{}, aerr
		}
		if len(patch) > 0 {
			var cur map[string]any
			_ = json.Unmarshal(gc.Driver, &cur)
			if cur == nil {
				cur = map[string]any{}
			}
			for k, v := range patch {
				cur[k] = v
			}
			gc.Driver, _ = json.Marshal(cur)
			rawCfg, _ = json.Marshal(gc)
			_ = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
				_, err := q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: kind, Config: rawCfg})
				return err
			})
		}
	}
	return TrackerSetup{WebhookURL: s.trackerWebhookURL(kind, t.WorkspaceID), Show: res.Show, Note: res.Note}, nil
}

type TrackerInfo struct {
	Summary, Detail, State string
	WebhookURL             string
	CloseStatusID          *uuid.UUID
	ReopenStatusID         *uuid.UUID
}

func (s *Service) TrackerInfo(ctx context.Context, t store.Tenant, kind string) (TrackerInfo, error) {
	if !t.Can(store.PermManage) {
		return TrackerInfo{}, store.ErrForbidden
	}
	if _, err := s.driver(kind); err != nil {
		return TrackerInfo{}, err
	}
	var out TrackerInfo
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: kind})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotConnected
		}
		if err != nil {
			return err
		}
		var gc genericConfig
		_ = json.Unmarshal(row.Config, &gc)
		out = TrackerInfo{Summary: gc.Summary, Detail: gc.Detail, State: row.State, WebhookURL: s.trackerWebhookURL(kind, t.WorkspaceID),
			CloseStatusID: parseUUID(gc.CloseStatusID), ReopenStatusID: parseUUID(gc.ReopenStatusID)}
		return nil
	})
	return out, err
}

func (s *Service) TrackerSetMapping(ctx context.Context, t store.Tenant, kind string, closeID, reopenID *uuid.UUID) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	if _, err := s.driver(kind); err != nil {
		return err
	}
	if err := s.validStatus(ctx, t, closeID); err != nil {
		return err
	}
	if err := s.validStatus(ctx, t, reopenID); err != nil {
		return err
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: kind})
		if err != nil {
			return ErrNotConnected
		}
		var gc genericConfig
		_ = json.Unmarshal(row.Config, &gc)
		gc.CloseStatusID, gc.ReopenStatusID = "", ""
		if closeID != nil {
			gc.CloseStatusID = closeID.String()
		}
		if reopenID != nil {
			gc.ReopenStatusID = reopenID.String()
		}
		b, _ := json.Marshal(gc)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: kind, Config: b})
		return err
	})
}

func (s *Service) TrackerCheck(ctx context.Context, t store.Tenant, kind string) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	d, err := s.driver(kind)
	if err != nil {
		return err
	}
	return d.Check(ctx, s, t.WorkspaceID)
}

// loadTracker opens a driver-based connection: its sealed credentials into creds, its own settings into drv.
func (s *Service) loadTracker(ctx context.Context, ws uuid.UUID, kind string, creds, drv any) (genericConfig, dbgen.Integration, error) {
	row, err := s.load(ctx, ws, kind, creds)
	if err != nil {
		return genericConfig{}, row, err
	}
	var gc genericConfig
	_ = json.Unmarshal(row.Config, &gc)
	if drv != nil && len(gc.Driver) > 0 {
		_ = json.Unmarshal(gc.Driver, drv)
	}
	return gc, row, nil
}

// TrackerEvent handles a notification from a driver-based tracker for one workspace.
func (s *Service) TrackerEvent(ctx context.Context, ws uuid.UUID, kind string, r EventRequest) (map[string]string, error) {
	d, err := s.driver(kind)
	if err != nil {
		return nil, ErrBadSignature
	}
	if len(r.Body) > 1<<20 {
		return nil, ErrBadSignature
	}
	res, err := d.Event(ctx, s, ws, r)
	if err != nil {
		return nil, err
	}
	if len(res.Events) == 0 {
		return res.Reply, nil
	}
	_, row, err := s.loadTracker(ctx, ws, kind, &struct{}{}, nil)
	if err != nil {
		return nil, ErrBadSignature
	}
	var gc genericConfig
	_ = json.Unmarshal(row.Config, &gc)
	for _, ev := range res.Events {
		ev.Ws, ev.Tracker, ev.Name = ws, kind, d.Name()
		ev.CloseID, ev.ReopenID, ev.OnlyOnChange = gc.CloseStatusID, gc.ReopenStatusID, true
		if ev.At.IsZero() {
			ev.At = s.now()
		}
		if err := s.applyIssueEvent(ctx, ev); err != nil {
			return nil, err
		}
	}
	return res.Reply, nil
}

// trackerCreate is CreateIssue for a driver-based tracker.
func (s *Service) trackerCreate(ctx context.Context, kind string, ws uuid.UUID, title, body string) (madeIssue, error) {
	d, err := s.driver(kind)
	if err != nil {
		return madeIssue{}, err
	}
	return d.Create(ctx, s, ws, strings.Join(strings.Fields(title), " "), body)
}

// TrackerDisconnect undoes what a driver made at the service, then forgets the connection.
func (s *Service) trackerDisconnect(ctx context.Context, ws uuid.UUID, kind string) {
	if d, ok := trackerDrivers[kind]; ok {
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		d.Disconnect(cctx, s, ws)
	}
}

// replaceCreds swaps the sealed credentials of a stored connection, keeping everything else.
func (s *Service) replaceCreds(ctx context.Context, t store.Tenant, kind string, creds []byte) error {
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpdateIntegrationSecret(ctx, dbgen.UpdateIntegrationSecretParams{WorkspaceID: t.WorkspaceID, Kind: kind, Secret: s.Box.Seal(creds, owner(t.WorkspaceID, kind))})
	})
}
