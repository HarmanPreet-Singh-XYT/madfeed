package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// HubSpotConfig is where HubSpot's API lives.
type HubSpotConfig struct {
	APIBase string // default https://api.hubapi.com
}

func (c HubSpotConfig) api() string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return "https://api.hubapi.com"
}

// What an account's value is taken from.
const (
	HubSpotRevenue  = "revenue"   // the company's annual revenue property
	HubSpotWonDeals = "won_deals" // the total of the company's closed-won deals
)

type hubspotCreds struct {
	Token string `json:"token"`
}

type hubspotConfig struct {
	ValueFrom     string      `json:"valueFrom"`
	SyncRequested bool        `json:"syncRequested,omitempty"`
	LastSync      *HubSpotRun `json:"lastSync,omitempty"`
}

type HubSpotInput struct {
	Token     string
	ValueFrom string
}

type hubspotAuthError struct{}

func (hubspotAuthError) Error() string { return "HubSpot did not accept that token" }

type hubspotLimit struct{}

func (hubspotLimit) Error() string {
	return "HubSpot asked us to slow down; the next sync will carry on"
}

func (s *Service) hubspotDo(ctx context.Context, token, method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.HubSpot.api()+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "feedback-app")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := s.client().Do(req)
	if err != nil {
		return fmt.Errorf("could not reach HubSpot")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return hubspotAuthError{}
	case res.StatusCode == http.StatusForbidden:
		return ErrInvalid("HubSpot refused: the token needs permission to read contacts, companies and deals")
	case res.StatusCode == http.StatusTooManyRequests:
		return hubspotLimit{}
	case res.StatusCode >= 300 && res.StatusCode != http.StatusMultiStatus:
		return fmt.Errorf("HubSpot answered %d", res.StatusCode)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("HubSpot answered in a way we could not read")
		}
	}
	return nil
}

// HubSpotConnect (admins only) connects HubSpot with a private-app access token the admin made, read-only. The
// token is checked before it is stored.
func (s *Service) HubSpotConnect(ctx context.Context, t store.Tenant, in HubSpotInput) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	if err := s.ready(); err != nil {
		return err
	}
	token := strings.TrimSpace(in.Token)
	if l := len(token); l < 10 || l > 500 {
		return ErrInvalid("paste the access token")
	}
	if in.ValueFrom != HubSpotRevenue && in.ValueFrom != HubSpotWonDeals {
		return ErrInvalid("choose what a company's value is taken from")
	}
	var probe struct{}
	if err := s.hubspotDo(ctx, token, http.MethodGet, "/crm/v3/objects/companies?limit=1", nil, &probe); err != nil {
		var auth hubspotAuthError
		if errors.As(err, &auth) {
			return ErrInvalid(auth.Error())
		}
		return err
	}
	if err := s.hubspotDo(ctx, token, http.MethodGet, "/crm/v3/objects/contacts?limit=1", nil, &probe); err != nil {
		return err
	}
	if in.ValueFrom == HubSpotWonDeals {
		if err := s.hubspotDo(ctx, token, http.MethodGet, "/crm/v3/objects/deals?limit=1", nil, &probe); err != nil {
			return err
		}
	}
	rawCreds, _ := json.Marshal(hubspotCreds{Token: token})
	rawCfg, _ := json.Marshal(hubspotConfig{ValueFrom: in.ValueFrom, SyncRequested: true})
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: "hubspot", Config: rawCfg,
			Secret: s.Box.Seal(rawCreds, owner(t.WorkspaceID, "hubspot")), ConnectedBy: t.UserID,
		})
	})
}

type HubSpotInfo struct {
	State     string
	ValueFrom string
	Syncing   bool // a sync has been asked for and has not run yet
	Last      *HubSpotRun
}

func (s *Service) HubSpotInfo(ctx context.Context, t store.Tenant) (HubSpotInfo, error) {
	if t.Role != store.RoleAdmin {
		return HubSpotInfo{}, store.ErrForbidden
	}
	var out HubSpotInfo
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "hubspot"})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotConnected
		}
		if err != nil {
			return err
		}
		var cfg hubspotConfig
		_ = json.Unmarshal(row.Config, &cfg)
		out = HubSpotInfo{State: row.State, ValueFrom: cfg.ValueFrom, Syncing: cfg.SyncRequested, Last: cfg.LastSync}
		return nil
	})
	return out, err
}

// HubSpotRequestSync (admins only) asks for a sync now; the worker runs it within a minute.
func (s *Service) HubSpotRequestSync(ctx context.Context, t store.Tenant) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "hubspot"})
		if err != nil {
			return ErrNotConnected
		}
		if row.State == "needs_reconnect" {
			return ErrNeedsReconnect
		}
		var cfg hubspotConfig
		_ = json.Unmarshal(row.Config, &cfg)
		cfg.SyncRequested = true
		b, _ := json.Marshal(cfg)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: "hubspot", Config: b})
		return err
	})
}

// ---- the sync ----

var moneyRe = regexp.MustCompile(`^[0-9]{1,12}(\.[0-9]+)?$`)

func money(s string) *string {
	s = strings.TrimSpace(s)
	if !moneyRe.MatchString(s) {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 || f >= 1e12 {
		return nil
	}
	v := strconv.FormatFloat(f, 'f', 2, 64)
	return &v
}

func cleanDomain(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(strings.TrimPrefix(s, "https://"), "http://")
	s = strings.TrimPrefix(s, "www.")
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if len(s) > 253 {
		return ""
	}
	return s
}

func chunks[T any](in []T, n int) [][]T {
	var out [][]T
	for len(in) > 0 {
		k := min(n, len(in))
		out = append(out, in[:k])
		in = in[k:]
	}
	return out
}

type hsAssoc struct {
	Results []struct {
		From struct {
			ID string `json:"id"`
		} `json:"from"`
		To []struct {
			ToObjectID json.Number `json:"toObjectId"`
			Types      []struct {
				TypeID int    `json:"typeId"`
				Label  string `json:"label"`
			} `json:"associationTypes"`
		} `json:"to"`
	} `json:"results"`
}

// associations returns, for each from-id, the id of the object it is associated with: the primary association when
// there is one, otherwise the first. With many=true it returns all of them.
func (s *Service) hubspotAssociations(ctx context.Context, token, from, to string, ids []string, many bool) (map[string][]string, error) {
	out := map[string][]string{}
	for _, part := range chunks(ids, 1000) {
		inputs := make([]map[string]string, 0, len(part))
		for _, id := range part {
			inputs = append(inputs, map[string]string{"id": id})
		}
		var res hsAssoc
		if err := s.hubspotDo(ctx, token, http.MethodPost, "/crm/v4/associations/"+from+"/"+to+"/batch/read", map[string]any{"inputs": inputs}, &res); err != nil {
			return nil, err
		}
		for _, r := range res.Results {
			var all []string
			primary := ""
			for _, t := range r.To {
				id := t.ToObjectID.String()
				all = append(all, id)
				for _, ty := range t.Types {
					if ty.TypeID == 1 || strings.EqualFold(ty.Label, "primary") {
						primary = id
					}
				}
			}
			switch {
			case many:
				out[r.From.ID] = all
			case primary != "":
				out[r.From.ID] = []string{primary}
			case len(all) > 0:
				out[r.From.ID] = all[:1]
			}
		}
	}
	return out, nil
}

type hsObjects struct {
	Results []struct {
		ID         string            `json:"id"`
		Properties map[string]string `json:"properties"`
	} `json:"results"`
}

func (s *Service) hubspotRead(ctx context.Context, token, object, idProperty string, props, ids []string) (hsObjects, error) {
	var all hsObjects
	for _, part := range chunks(ids, 100) {
		inputs := make([]map[string]string, 0, len(part))
		for _, id := range part {
			inputs = append(inputs, map[string]string{"id": id})
		}
		body := map[string]any{"properties": props, "inputs": inputs}
		if idProperty != "" {
			body["idProperty"] = idProperty
		}
		var res hsObjects
		if err := s.hubspotDo(ctx, token, http.MethodPost, "/crm/v3/objects/"+object+"/batch/read", body, &res); err != nil {
			return all, err
		}
		all.Results = append(all.Results, res.Results...)
	}
	return all, nil
}

// HubSpotSync reads HubSpot for the people we know and updates accounts. It changes only what is safe: a person's
// own account is updated (value, domain if empty) only when it is the same company; a person with no account is
// given the matching account, or a new one; people are never created or deleted; nothing is written to HubSpot.
func (s *Service) HubSpotSync(ctx context.Context, ws uuid.UUID) (HubSpotRun, error) {
	run := HubSpotRun{At: s.now().UTC()}
	var creds hubspotCreds
	row, err := s.load(ctx, ws, "hubspot", &creds)
	if err != nil {
		return run, err
	}
	var cfg hubspotConfig
	_ = json.Unmarshal(row.Config, &cfg)
	finish := func(err error) (HubSpotRun, error) {
		run.OK = err == nil
		if err != nil {
			run.Error = clip(err.Error(), 200)
			var auth hubspotAuthError
			if errors.As(err, &auth) {
				s.markBroken(ctx, ws, "hubspot", "HubSpot no longer accepts the token")
			}
		} else {
			s.markOK(ctx, ws, "hubspot")
		}
		cfg.SyncRequested = false
		cfg.LastSync = &run
		b, _ := json.Marshal(cfg)
		_ = store.WithTenant(context.WithoutCancel(ctx), s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
			_, err := q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: ws, Kind: "hubspot", Config: b})
			return err
		})
		return run, err
	}

	people, err := s.crmPeople(ctx, ws)
	if err != nil {
		return finish(err)
	}
	run.People = len(people)
	if len(people) == 0 {
		return finish(nil)
	}

	emails := make([]string, len(people))
	for i, p := range people {
		emails[i] = p.Email
	}
	contacts, err := s.hubspotRead(ctx, creds.Token, "contacts", "email", []string{"email"}, emails)
	if err != nil {
		return finish(err)
	}
	contactByEmail := map[string]string{}
	var contactIDs []string
	for _, c := range contacts.Results {
		if e := strings.ToLower(c.Properties["email"]); e != "" {
			contactByEmail[e] = c.ID
			contactIDs = append(contactIDs, c.ID)
		}
	}
	companyOf, err := s.hubspotAssociations(ctx, creds.Token, "contacts", "companies", contactIDs, false)
	if err != nil {
		return finish(err)
	}
	seen := map[string]bool{}
	var companyIDs []string
	for _, cs := range companyOf {
		if !seen[cs[0]] {
			seen[cs[0]] = true
			companyIDs = append(companyIDs, cs[0])
		}
	}
	companies := map[string]crmCompany{}
	cr, err := s.hubspotRead(ctx, creds.Token, "companies", "", []string{"name", "domain", "annualrevenue"}, companyIDs)
	if err != nil {
		return finish(err)
	}
	for _, c := range cr.Results {
		name := strings.Join(strings.Fields(c.Properties["name"]), " ")
		if name == "" {
			continue
		}
		hc := crmCompany{ID: c.ID, Name: clip(name, 200), Domain: cleanDomain(c.Properties["domain"])}
		if cfg.ValueFrom == HubSpotRevenue {
			hc.Value = money(c.Properties["annualrevenue"])
		}
		companies[c.ID] = hc
	}
	if cfg.ValueFrom == HubSpotWonDeals && len(companies) > 0 {
		ids := make([]string, 0, len(companies))
		for id := range companies {
			ids = append(ids, id)
		}
		dealsOf, err := s.hubspotAssociations(ctx, creds.Token, "companies", "deals", ids, true)
		if err != nil {
			return finish(err)
		}
		var dealIDs []string
		for _, ds := range dealsOf {
			dealIDs = append(dealIDs, ds...)
		}
		deals, err := s.hubspotRead(ctx, creds.Token, "deals", "", []string{"amount", "hs_is_closed_won"}, dealIDs)
		if err != nil {
			return finish(err)
		}
		won := map[string]float64{}
		for _, d := range deals.Results {
			if d.Properties["hs_is_closed_won"] != "true" {
				continue
			}
			if m := money(d.Properties["amount"]); m != nil {
				f, _ := strconv.ParseFloat(*m, 64)
				won[d.ID] = f
			}
		}
		for cid, ds := range dealsOf {
			total, any := 0.0, false
			for _, d := range ds {
				if v, ok := won[d]; ok {
					total += v
					any = true
				}
			}
			if hc, ok := companies[cid]; ok && any && total < 1e12 {
				v := strconv.FormatFloat(total, 'f', 2, 64)
				hc.Value = &v
				companies[cid] = hc
			}
		}
	}

	byEmail := map[string]crmCompany{}
	for _, p := range people {
		if cid, ok := contactByEmail[p.Email]; ok {
			if co, ok := companyOf[cid]; ok {
				if c, ok := companies[co[0]]; ok {
					byEmail[p.Email] = c
				}
			}
		}
	}
	return finish(s.crmApply(ctx, ws, people, byEmail, &run))
}
