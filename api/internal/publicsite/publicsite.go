// Package publicsite is everything a visitor without an account can reach: the
// embeddable feedback form and the public roadmap. Nothing here reads a
// workspace's data except what is explicitly marked public.
package publicsite

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/intake"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("publicsite: not found")
	// ErrOrigin means the page posting to the form is not on the workspace's list.
	ErrOrigin = errors.New("publicsite: origin not allowed")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type ErrQuota string

func (e ErrQuota) Error() string { return string(e) }

const (
	MaxText         = 5000
	MaxOrigins      = 10
	DefaultDailyCap = 200 // form submissions per workspace per rolling 24 hours
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,39}$`)

type Service struct {
	Pool     *pgxpool.Pool
	Intake   *intake.Service
	DailyCap int // 0 means DefaultDailyCap
	// Throttle, when set, is asked once per submission that has proved the key, with the
	// workspace and the caller's address, and says whether both are within their allowance
	// (per workspace per minute; per address per day). The key is public, so the generic
	// per-address limit alone cannot protect the form.
	Throttle func(ctx context.Context, workspaceID, addr string) bool
}

func systemTenant(ws uuid.UUID, role store.Role) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: role}
}

// ---- settings (signed in) ----

type Settings struct {
	Enabled    bool
	Key        string // empty when off
	Origins    []string
	PublicSlug string
}

func (s *Service) GetSettings(ctx context.Context, t store.Tenant) (Settings, error) {
	var out Settings
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetFormSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		out = fromRow(r.FormKey.String, r.FormKey.Valid, r.FormOrigins, r.PublicSlug.String)
		return nil
	})
	return out, err
}

func fromRow(key string, has bool, origins []string, slug string) Settings {
	if origins == nil {
		origins = []string{}
	}
	return Settings{Enabled: has, Key: key, Origins: origins, PublicSlug: slug}
}

// UpdateSettings (admins only) turns the form on or off, sets the allowed web
// origins and optionally issues a new key (the old one stops working at once).
func (s *Service) UpdateSettings(ctx context.Context, t store.Tenant, enabled bool, origins []string, rotate bool) (Settings, error) {
	if t.Role != store.RoleAdmin {
		return Settings{}, store.ErrForbidden
	}
	clean, err := cleanOrigins(origins)
	if err != nil {
		return Settings{}, err
	}
	var out Settings
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		cur, err := q.GetFormSettings(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		key := ""
		if enabled {
			key = cur.FormKey.String
			if key == "" || rotate {
				key = newKey()
			}
			if !cur.PublicSlug.Valid || cur.PublicSlug.String == "" {
				return ErrInvalid("set a public address for the workspace first")
			}
		}
		var kv = pgxText(key)
		if _, err := q.SetFormSettings(ctx, dbgen.SetFormSettingsParams{ID: t.WorkspaceID, FormKey: kv, FormOrigins: clean}); err != nil {
			return err
		}
		out = fromRow(key, key != "", clean, cur.PublicSlug.String)
		return nil
	})
	return out, err
}

func newKey() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// cleanOrigins keeps only plain web origins: scheme, host, optional port. No wildcards,
// no paths, and plain http only for the local machine.
func cleanOrigins(in []string) ([]string, error) {
	if len(in) > MaxOrigins {
		return nil, ErrInvalid("too many allowed sites")
	}
	seen := map[string]bool{}
	out := []string{}
	for _, o := range in {
		o = strings.TrimSpace(o)
		u, err := url.Parse(o)
		if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || strings.Contains(o, "*") {
			return nil, ErrInvalid("each allowed site must look like https://www.example.com")
		}
		host := u.Hostname()
		local := host == "localhost" || host == "127.0.0.1"
		if u.Scheme != "https" && !(u.Scheme == "http" && local) {
			return nil, ErrInvalid("allowed sites must use https")
		}
		norm := u.Scheme + "://" + strings.ToLower(u.Host)
		if len(norm) > 255 {
			return nil, ErrInvalid("that site address is too long")
		}
		if !seen[norm] {
			seen[norm] = true
			out = append(out, norm)
		}
	}
	return out, nil
}

// ---- the form (no sign-in) ----

type formConfig struct {
	ws      uuid.UUID
	key     string
	origins []string
}

func (s *Service) config(ctx context.Context, slug string) (formConfig, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !slugRe.MatchString(slug) {
		return formConfig{}, ErrNotFound
	}
	var c formConfig
	err := s.Pool.QueryRow(ctx, `SELECT workspace_id, form_key, origins FROM form_config($1)`, slug).Scan(&c.ws, &c.key, &c.origins)
	if errors.Is(err, pgx.ErrNoRows) {
		return formConfig{}, ErrNotFound
	}
	return c, err
}

// OriginAllowed reports whether a page at this origin may use the form on this address.
// Used for the browser's cross-site checks; it reveals only yes or no.
func (s *Service) OriginAllowed(ctx context.Context, slug, origin string) bool {
	c, err := s.config(ctx, slug)
	if err != nil {
		return false
	}
	return contains(c.origins, origin)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

type Submission struct {
	Slug   string
	Key    string
	Origin string // the Origin header the browser sent
	Text   string
	Email  string // optional
	Addr   string // the caller's network address, for limits only; never stored
}

// Submit stores a visitor's feedback as an unreviewed source item and queues
// extraction. It lands in the review queue like any pasted conversation: nobody
// has accepted anything, and nothing here is trusted. Sending the same text twice
// stores it once.
func (s *Service) Submit(ctx context.Context, in Submission) error {
	c, err := s.config(ctx, in.Slug)
	if err != nil {
		return err
	}
	// A key for another workspace, a wrong key and a missing form all look alike.
	if subtle.ConstantTimeCompare([]byte(in.Key), []byte(c.key)) != 1 {
		return ErrNotFound
	}
	if !contains(c.origins, in.Origin) {
		return ErrOrigin
	}
	if s.Throttle != nil && !s.Throttle(ctx, c.ws.String(), in.Addr) {
		return ErrQuota("this form is receiving a lot of feedback right now; please try again in a minute")
	}
	text := strings.TrimSpace(in.Text)
	if text == "" || utf8.RuneCountInString(text) > MaxText {
		return ErrInvalid("write a message of up to 5,000 characters")
	}
	email := ""
	if in.Email != "" {
		a, err := mail.ParseAddress(in.Email)
		if err != nil || a.Name != "" || len(a.Address) > 320 {
			return ErrInvalid("that email address does not look right")
		}
		email = strings.ToLower(a.Address)
	}
	t := systemTenant(c.ws, store.RoleMember)
	cap := s.DailyCap
	if cap <= 0 {
		cap = DefaultDailyCap
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.CountFormSubmissionsSince(ctx, dbgen.CountFormSubmissionsSinceParams{WorkspaceID: c.ws, CreatedAt: time.Now().Add(-24 * time.Hour)})
		if err != nil {
			return err
		}
		if int(n) >= cap {
			return ErrQuota("this form has reached its daily limit; please try again tomorrow")
		}
		return nil
	})
	if err != nil {
		return err
	}
	_, err = s.Intake.IngestPaste(ctx, t, intake.PasteInput{Title: "Website feedback", Text: text, Kind: "form", SubmitterEmail: email})
	var qe intake.ErrQuota
	if errors.As(err, &qe) {
		return ErrQuota(qe.Error())
	}
	return err
}

// ForgetSubmitter (admins only) deletes every form submission from this address, with
// everything built on it. Returns how many were removed.
func (s *Service) ForgetSubmitter(ctx context.Context, t store.Tenant, email string) (int, error) {
	if t.Role != store.RoleAdmin {
		return 0, store.ErrForbidden
	}
	a, err := mail.ParseAddress(email)
	if err != nil || a.Name != "" {
		return 0, ErrInvalid("that email address does not look right")
	}
	n := 0
	err = store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		ids, err := q.SourceIDsBySubmitter(ctx, dbgen.SourceIDsBySubmitterParams{WorkspaceID: t.WorkspaceID, SubmitterEmail: pgxText(strings.ToLower(a.Address))})
		if err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := q.DeleteSourceItem(ctx, dbgen.DeleteSourceItemParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	return n, err
}

// ---- roadmap ----

// SetRequestPublic puts one request on the public roadmap or takes it off. The title and
// summary are written for the public and are the only text of the request a visitor sees.
func (s *Service) SetRequestPublic(ctx context.Context, t store.Tenant, id uuid.UUID, public bool, title, summary string) error {
	if t.Role != store.RoleAdmin { // putting something in front of the public is an admin decision
		return store.ErrForbidden
	}
	title, summary = strings.TrimSpace(title), strings.TrimSpace(summary)
	if public && (title == "" || summary == "") {
		return ErrInvalid("write a public title and a short public summary first")
	}
	if utf8.RuneCountInString(title) > 200 {
		return ErrInvalid("the public title is too long")
	}
	if utf8.RuneCountInString(summary) > 1000 {
		return ErrInvalid("the public summary is too long")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.SetRequestPublic(ctx, dbgen.SetRequestPublicParams{WorkspaceID: t.WorkspaceID, ID: id, Public: public, PublicTitle: title, PublicSummary: summary})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

type RoadmapItem struct {
	ID      uuid.UUID
	Title   string
	Summary string
	Status  string
	Bucket  string
}

type Roadmap struct {
	WorkspaceName string
	Items         []RoadmapItem
}

// PublicRoadmap lists the requests somebody marked public, with their status. The
// query selects exactly these columns; no evidence, people, counts or notes.
func (s *Service) PublicRoadmap(ctx context.Context, slug string) (Roadmap, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !slugRe.MatchString(slug) {
		return Roadmap{}, ErrNotFound
	}
	var id uuid.NullUUID
	if err := s.Pool.QueryRow(ctx, `SELECT public_workspace_id($1)`, slug).Scan(&id); err != nil || !id.Valid {
		return Roadmap{}, ErrNotFound
	}
	ws := id.UUID
	var out Roadmap
	err := store.WithTenant(ctx, s.Pool, systemTenant(ws, store.RoleViewer), func(q *dbgen.Queries) error {
		name, err := q.GetWorkspaceName(ctx, ws)
		if err != nil {
			return err
		}
		out.WorkspaceName = name
		rows, err := q.PublicRoadmap(ctx, ws)
		for _, r := range rows {
			out.Items = append(out.Items, RoadmapItem{ID: r.ID, Title: r.Title, Summary: r.PublicSummary, Status: r.StatusName, Bucket: r.StatusBucket})
		}
		return err
	})
	return out, err
}
