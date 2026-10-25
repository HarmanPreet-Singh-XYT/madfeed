package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// SalesforceConfig is where Salesforce lives. Normally empty: the admin gives their own My Domain address, which
// must be a *.my.salesforce.com host. APIBase replaces it for development stand-ins.
type SalesforceConfig struct {
	APIBase string
}

// salesforceVersion is the REST API version asked for.
const salesforceVersion = "v60.0"

var (
	sfInstanceRe = regexp.MustCompile(`^https://[a-z0-9][a-z0-9-]{1,60}(\.sandbox|\.develop|\.scratch|\.trailblaze)?\.my\.salesforce\.com$`)
	sfIDRe       = regexp.MustCompile(`^[A-Za-z0-9]{15,18}$`)
	sfClientRe   = regexp.MustCompile(`^[A-Za-z0-9._-]{10,300}$`)
)

type salesforceCreds struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type salesforceConfig struct {
	InstanceURL   string  `json:"instanceUrl"`
	ValueFrom     string  `json:"valueFrom"`
	SyncRequested bool    `json:"syncRequested,omitempty"`
	LastSync      *CRMRun `json:"lastSync,omitempty"`
}

type SalesforceInput struct {
	InstanceURL, ClientID, ClientSecret, ValueFrom string
}

type sfAuthError struct{}

func (sfAuthError) Error() string { return "Salesforce did not accept those credentials" }

func (c SalesforceConfig) base(instance string) string {
	if c.APIBase != "" {
		return strings.TrimRight(c.APIBase, "/")
	}
	return instance
}

// salesforceToken asks for an access token with the connected app's client credentials. Tokens are short lived
// and are not kept.
func (s *Service) salesforceToken(ctx context.Context, instance string, creds salesforceCreds) (string, error) {
	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {creds.ClientID}, "client_secret": {creds.ClientSecret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Salesforce.base(instance)+"/services/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := s.client().Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach Salesforce")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusBadRequest || res.StatusCode == http.StatusUnauthorized {
		return "", sfAuthError{}
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if res.StatusCode != http.StatusOK || json.Unmarshal(raw, &out) != nil || out.AccessToken == "" {
		return "", fmt.Errorf("Salesforce could not give an access token; try again")
	}
	return out.AccessToken, nil
}

type sfRecords struct {
	Done           bool             `json:"done"`
	NextRecordsURL string           `json:"nextRecordsUrl"`
	Records        []map[string]any `json:"records"`
}

// salesforceQuery runs one read-only SOQL query and follows its pages (bounded).
func (s *Service) salesforceQuery(ctx context.Context, instance, token, soql string) ([]map[string]any, error) {
	var all []map[string]any
	next := "/services/data/" + salesforceVersion + "/query?q=" + url.QueryEscape(soql)
	for page := 0; page < 20 && next != ""; page++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.Salesforce.base(instance)+next, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		res, err := s.client().Do(req)
		if err != nil {
			return nil, fmt.Errorf("could not reach Salesforce")
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
		res.Body.Close()
		switch res.StatusCode {
		case http.StatusUnauthorized:
			return nil, sfAuthError{}
		case http.StatusForbidden:
			return nil, ErrInvalid("Salesforce refused: the connected app needs permission to read contacts, accounts and opportunities")
		case http.StatusOK:
		default:
			if res.StatusCode == http.StatusServiceUnavailable || res.StatusCode == http.StatusTooManyRequests {
				return nil, hubspotLimit{}
			}
			return nil, fmt.Errorf("Salesforce answered %d", res.StatusCode)
		}
		var r sfRecords
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, fmt.Errorf("Salesforce answered in a way we could not read")
		}
		all = append(all, r.Records...)
		next = ""
		if !r.Done {
			next = r.NextRecordsURL
		}
	}
	return all, nil
}

func soqlString(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s) + "'"
}

func str2(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', 2, 64)
	}
	return ""
}

// SalesforceConnect (admins only) connects Salesforce with a connected app's client credentials, read-only.
func (s *Service) SalesforceConnect(ctx context.Context, t store.Tenant, in SalesforceInput) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	if err := s.ready(); err != nil {
		return err
	}
	instance := strings.TrimRight(strings.ToLower(strings.TrimSpace(in.InstanceURL)), "/")
	if s.Salesforce.APIBase == "" && !sfInstanceRe.MatchString(instance) {
		return ErrInvalid("enter your My Domain address, for example https://acme.my.salesforce.com")
	}
	if !sfClientRe.MatchString(strings.TrimSpace(in.ClientID)) || len(strings.TrimSpace(in.ClientSecret)) < 10 || len(in.ClientSecret) > 300 {
		return ErrInvalid("paste the connected app's consumer key and secret")
	}
	if in.ValueFrom != HubSpotRevenue && in.ValueFrom != HubSpotWonDeals {
		return ErrInvalid("choose what a company's value is taken from")
	}
	creds := salesforceCreds{ClientID: strings.TrimSpace(in.ClientID), ClientSecret: strings.TrimSpace(in.ClientSecret)}
	token, err := s.salesforceToken(ctx, instance, creds)
	if err != nil {
		var auth sfAuthError
		if errors.As(err, &auth) {
			return ErrInvalid(auth.Error())
		}
		return err
	}
	if _, err := s.salesforceQuery(ctx, instance, token, "SELECT Id FROM Contact LIMIT 1"); err != nil {
		return err
	}
	if _, err := s.salesforceQuery(ctx, instance, token, "SELECT Id FROM Account LIMIT 1"); err != nil {
		return err
	}
	if in.ValueFrom == HubSpotWonDeals {
		if _, err := s.salesforceQuery(ctx, instance, token, "SELECT Id FROM Opportunity LIMIT 1"); err != nil {
			return err
		}
	}
	rawCreds, _ := json.Marshal(creds)
	rawCfg, _ := json.Marshal(salesforceConfig{InstanceURL: instance, ValueFrom: in.ValueFrom, SyncRequested: true})
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		return q.UpsertIntegration(ctx, dbgen.UpsertIntegrationParams{
			WorkspaceID: t.WorkspaceID, Kind: "salesforce", Config: rawCfg,
			Secret: s.Box.Seal(rawCreds, owner(t.WorkspaceID, "salesforce")), ConnectedBy: t.UserID,
		})
	})
}

type SalesforceInfo struct {
	State       string
	InstanceURL string
	ValueFrom   string
	Syncing     bool
	Last        *CRMRun
}

func (s *Service) SalesforceInfo(ctx context.Context, t store.Tenant) (SalesforceInfo, error) {
	if t.Role != store.RoleAdmin {
		return SalesforceInfo{}, store.ErrForbidden
	}
	var out SalesforceInfo
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "salesforce"})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotConnected
		}
		if err != nil {
			return err
		}
		var cfg salesforceConfig
		_ = json.Unmarshal(row.Config, &cfg)
		out = SalesforceInfo{State: row.State, InstanceURL: cfg.InstanceURL, ValueFrom: cfg.ValueFrom, Syncing: cfg.SyncRequested, Last: cfg.LastSync}
		return nil
	})
	return out, err
}

// SalesforceRequestSync (admins only) asks for a sync now; the worker runs it within a minute.
func (s *Service) SalesforceRequestSync(ctx context.Context, t store.Tenant) error {
	if t.Role != store.RoleAdmin {
		return store.ErrForbidden
	}
	return store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		row, err := q.GetIntegration(ctx, dbgen.GetIntegrationParams{WorkspaceID: t.WorkspaceID, Kind: "salesforce"})
		if err != nil {
			return ErrNotConnected
		}
		if row.State == "needs_reconnect" {
			return ErrNeedsReconnect
		}
		var cfg salesforceConfig
		_ = json.Unmarshal(row.Config, &cfg)
		cfg.SyncRequested = true
		b, _ := json.Marshal(cfg)
		_, err = q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: t.WorkspaceID, Kind: "salesforce", Config: b})
		return err
	})
}

// SalesforceSync reads Salesforce for the people we know and updates accounts by the same safe rules as every CRM sync.
func (s *Service) SalesforceSync(ctx context.Context, ws uuid.UUID) (CRMRun, error) {
	run := CRMRun{At: s.now().UTC()}
	var creds salesforceCreds
	row, err := s.load(ctx, ws, "salesforce", &creds)
	if err != nil {
		return run, err
	}
	var cfg salesforceConfig
	_ = json.Unmarshal(row.Config, &cfg)
	finish := func(err error) (CRMRun, error) {
		run.OK = err == nil
		if err != nil {
			run.Error = clip(err.Error(), 200)
			var auth sfAuthError
			if errors.As(err, &auth) {
				s.markBroken(ctx, ws, "salesforce", "Salesforce no longer accepts the credentials")
			}
		} else {
			s.markOK(ctx, ws, "salesforce")
		}
		cfg.SyncRequested = false
		cfg.LastSync = &run
		b, _ := json.Marshal(cfg)
		_ = store.WithTenant(context.WithoutCancel(ctx), s.Pool, system(ws, store.RoleMember), func(q *dbgen.Queries) error {
			_, err := q.UpdateIntegrationConfig(ctx, dbgen.UpdateIntegrationConfigParams{WorkspaceID: ws, Kind: "salesforce", Config: b})
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
	token, err := s.salesforceToken(ctx, cfg.InstanceURL, creds)
	if err != nil {
		return finish(err)
	}

	// contact email -> account id
	acctOf := map[string]string{}
	var emails []string
	for _, p := range people {
		if !strings.ContainsAny(p.Email, `'"\ `) {
			emails = append(emails, p.Email)
		}
	}
	accountIDs := map[string]bool{}
	for _, part := range chunks(emails, 100) {
		lits := make([]string, len(part))
		for i, e := range part {
			lits[i] = soqlString(e)
		}
		recs, err := s.salesforceQuery(ctx, cfg.InstanceURL, token, "SELECT Email, AccountId FROM Contact WHERE AccountId != null AND Email IN ("+strings.Join(lits, ",")+")")
		if err != nil {
			return finish(err)
		}
		for _, r := range recs {
			e, a := strings.ToLower(str2(r, "Email")), str2(r, "AccountId")
			if e != "" && sfIDRe.MatchString(a) {
				acctOf[e] = a
				accountIDs[a] = true
			}
		}
	}
	ids := make([]string, 0, len(accountIDs))
	for id := range accountIDs {
		ids = append(ids, id)
	}
	companies := map[string]crmCompany{}
	for _, part := range chunks(ids, 100) {
		lits := make([]string, len(part))
		for i, id := range part {
			lits[i] = soqlString(id)
		}
		recs, err := s.salesforceQuery(ctx, cfg.InstanceURL, token, "SELECT Id, Name, Website, AnnualRevenue FROM Account WHERE Id IN ("+strings.Join(lits, ",")+")")
		if err != nil {
			return finish(err)
		}
		for _, r := range recs {
			name := strings.Join(strings.Fields(str2(r, "Name")), " ")
			if name == "" {
				continue
			}
			c := crmCompany{ID: str2(r, "Id"), Name: clip(name, 200), Domain: cleanDomain(str2(r, "Website"))}
			if cfg.ValueFrom == HubSpotRevenue {
				c.Value = money(strconv.FormatFloat(numberOf(r["AnnualRevenue"]), 'f', 2, 64))
				if numberOf(r["AnnualRevenue"]) <= 0 {
					c.Value = nil
				}
			}
			companies[c.ID] = c
		}
		if cfg.ValueFrom == HubSpotWonDeals {
			recs, err := s.salesforceQuery(ctx, cfg.InstanceURL, token, "SELECT AccountId, SUM(Amount) total FROM Opportunity WHERE IsWon = true AND AccountId IN ("+strings.Join(lits, ",")+") GROUP BY AccountId")
			if err != nil {
				return finish(err)
			}
			for _, r := range recs {
				id := str2(r, "AccountId")
				if c, ok := companies[id]; ok && numberOf(r["total"]) > 0 {
					c.Value = money(strconv.FormatFloat(numberOf(r["total"]), 'f', 2, 64))
					companies[id] = c
				}
			}
		}
	}
	byEmail := map[string]crmCompany{}
	for _, p := range people {
		if a, ok := acctOf[p.Email]; ok {
			if c, ok := companies[a]; ok {
				byEmail[p.Email] = c
			}
		}
	}
	return finish(s.crmApply(ctx, ws, people, byEmail, &run))
}

func numberOf(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	}
	return 0
}
