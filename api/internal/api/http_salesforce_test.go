package api

import (
	"bytes"
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/devfakes"
	"product/api/internal/integrations"
)

type sfEnv struct {
	h  *harness
	f  *devfakes.Salesforce
	ws string
}

func newSFEnv(t *testing.T) *sfEnv {
	h := newHarness(t)
	f := devfakes.NewSalesforce()
	srv := httptest.NewServer(f.Handler())
	t.Cleanup(srv.Close)
	h.srv.Integrations.Salesforce = integrations.SalesforceConfig{APIBase: srv.URL}
	e := &sfEnv{h: h, f: f, ws: h.workspace(h.alice, "SF Co")}
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": hubspotPeopleCSV}); c != 200 {
		t.Fatalf("import: %d %v", c, b)
	}
	f.Set(func() {
		f.Contacts["dana@acme.com"] = "001000000000001AAA"
		f.Contacts["raj@acme.com"] = "001000000000001AAA"
		f.Contacts["sam@globex.io"] = "001000000000002AAA"
		f.Contacts["eve@initech.io"] = "001000000000003AAA"
		f.Accounts["001000000000001AAA"] = devfakes.SFAccount{ID: "001000000000001AAA", Name: "Acme Inc", Website: "https://www.acme.com/", AnnualRevenue: 250000}
		f.Accounts["001000000000002AAA"] = devfakes.SFAccount{ID: "001000000000002AAA", Name: "Globex Corporation", Website: "globex.io", AnnualRevenue: 9000000}
		f.Accounts["001000000000003AAA"] = devfakes.SFAccount{ID: "001000000000003AAA", Name: "Initech", Website: "initech.io", AnnualRevenue: 1200000.5}
		f.Opportunities = []devfakes.SFOpportunity{
			{AccountID: "001000000000001AAA", Amount: 100000, Won: true}, {AccountID: "001000000000001AAA", Amount: 50000, Won: true},
			{AccountID: "001000000000001AAA", Amount: 75000, Won: false},
		}
	})
	return e
}

func (e *sfEnv) base() string { return "/v1/workspaces/" + e.ws + "/integrations/salesforce" }

func (e *sfEnv) body(valueFrom string) map[string]any {
	return map[string]any{"instanceUrl": "https://acme.my.salesforce.com", "clientId": e.f.ClientID, "clientSecret": e.f.ClientSecret, "valueFrom": valueFrom}
}

func (e *sfEnv) connect(valueFrom string) {
	e.h.t.Helper()
	if c, b, _ := e.h.do(e.h.alice, "POST", e.base()+"/connect", e.body(valueFrom)); c != 204 {
		e.h.t.Fatalf("connect: %d %v", c, b)
	}
}

func (e *sfEnv) sync() integrations.CRMRun {
	e.h.t.Helper()
	run, err := e.h.srv.Integrations.SalesforceSync(context.Background(), uuid.MustParse(e.ws))
	if err != nil {
		e.h.t.Fatalf("sync: %v %+v", err, run)
	}
	return run
}

func (e *sfEnv) account(name string) (revenue, domain string, people int) {
	var rev, dom *string
	e.h.db.Super.QueryRow(context.Background(), `SELECT revenue::text, domain FROM account WHERE workspace_id=$1 AND lower(name)=lower($2)`, e.ws, name).Scan(&rev, &dom)
	e.h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM person p JOIN account a ON a.id=p.account_id WHERE a.workspace_id=$1 AND lower(a.name)=lower($2)`, e.ws, name).Scan(&people)
	if rev != nil {
		revenue = *rev
	}
	if dom != nil {
		domain = *dom
	}
	return
}

func TestConnectingSalesforceIsCheckedAndTheSecretIsSealed(t *testing.T) {
	e := newSFEnv(t)
	h := e.h
	if c, _, _ := h.do(h.bob, "POST", e.base()+"/connect", e.body("revenue")); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	// with a real server only a My Domain address is accepted; the stand-in override is for tests
	h.srv.Integrations.Salesforce = integrations.SalesforceConfig{}
	for _, u := range []string{"https://evil.example.com", "http://acme.my.salesforce.com", "https://acme.my.salesforce.com.evil.com", "https://user@acme.my.salesforce.com", "acme"} {
		b := e.body("revenue")
		b["instanceUrl"] = u
		if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", b); c != 400 {
			t.Errorf("%s: %d", u, c)
		}
	}
	srv := httptest.NewServer(e.f.Handler())
	t.Cleanup(srv.Close)
	h.srv.Integrations.Salesforce = integrations.SalesforceConfig{APIBase: srv.URL}

	bad := e.body("revenue")
	bad["clientSecret"] = "not-the-secret-0000"
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", bad); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("wrong credentials: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", e.body("everything")); c != 400 {
		t.Errorf("an unknown value source: %d", c)
	}
	e.f.Set(func() { e.f.NoOpportunities = true })
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", e.body("won_deals")); c != 400 || !strings.Contains(fmt.Sprint(b), "permission") {
		t.Errorf("opportunities not allowed: %d %v", c, b)
	}
	e.connect("revenue")
	_, d, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if d["state"] != "connected" || d["valueFrom"] != "revenue" || d["syncing"] != true {
		t.Errorf("details %v", d)
	}
	_, list, _ := h.rawJSON(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", "", nil)
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='salesforce'`, e.ws).Scan(&sealed)
	if strings.Contains(list, e.f.ClientSecret) || len(sealed) == 0 || bytes.Contains(sealed, []byte(e.f.ClientSecret)) {
		t.Error("the secret is not kept sealed")
	}
}

func TestTheSalesforceSyncFillsAccountsAndTouchesNothingElse(t *testing.T) {
	e := newSFEnv(t)
	e.connect("revenue")
	other := e.h.workspace(e.h.bob, "Other")
	e.h.do(e.h.bob, "POST", "/v1/workspaces/"+other+"/people/import", map[string]any{"csv": "Name,Email,Company,ARR\nDana Two,dana2@acme.com,Acme Inc,1\n"})

	run := e.sync()
	if run.People != 5 || run.Matched != 4 || run.PeopleLinked != 2 || run.AccountsCreated != 1 || run.AccountsUpdated != 1 || run.Skipped != 1 {
		t.Fatalf("run %+v", run)
	}
	if rev, dom, n := e.account("Acme Inc"); rev != "250000.00" || dom != "acme.com" || n != 2 {
		t.Errorf("Acme: %q %q %d", rev, dom, n)
	}
	if rev, dom, n := e.account("Globex"); rev != "" || dom != "" || n != 1 {
		t.Errorf("Globex was changed: %q %q %d", rev, dom, n)
	}
	if rev, dom, n := e.account("Initech"); rev != "1200000.50" || dom != "initech.io" || n != 1 {
		t.Errorf("Initech: %q %q %d", rev, dom, n)
	}
	var people int
	e.h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM person WHERE workspace_id=$1`, e.ws).Scan(&people)
	if people != 5 {
		t.Errorf("%d people", people)
	}
	var orev string
	e.h.db.Super.QueryRow(context.Background(), `SELECT revenue::text FROM account WHERE workspace_id=$1`, other).Scan(&orev)
	if orev != "1.00" {
		t.Errorf("another workspace's account changed: %s", orev)
	}
	e.f.Mu.Lock()
	for _, q := range e.f.Queries {
		if !strings.HasPrefix(q, "SELECT ") {
			t.Errorf("a query that is not a read: %s", q)
		}
	}
	e.f.Mu.Unlock()
	if again := e.sync(); again.PeopleLinked != 0 || again.AccountsCreated != 0 || again.AccountsUpdated != 0 {
		t.Errorf("second run %+v", again)
	}
}

func TestSalesforceValueCanComeFromWonOpportunitiesAndFailuresAreShown(t *testing.T) {
	e := newSFEnv(t)
	e.connect("won_deals")
	if run := e.sync(); !run.OK {
		t.Fatalf("%+v", run)
	}
	if rev, _, _ := e.account("Acme Inc"); rev != "150000.00" {
		t.Errorf("Acme %q", rev)
	}
	if rev, _, _ := e.account("Initech"); rev != "" {
		t.Errorf("Initech %q", rev)
	}
	// the secret stops working: recorded in plain words, the connection asks to be redone
	e.f.Set(func() { e.f.ClientSecret += "-rotated" })
	run, err := e.h.srv.Integrations.SalesforceSync(context.Background(), uuid.MustParse(e.ws))
	if err == nil || run.OK || !strings.Contains(run.Error, "did not accept") {
		t.Errorf("%v %+v", err, run)
	}
	_, d, _ := e.h.do(e.h.alice, "GET", e.base()+"/details", nil)
	if d["state"] != "needs_reconnect" {
		t.Errorf("details %v", d)
	}
	if c, _, _ := e.h.do(e.h.alice, "POST", e.base()+"/sync", nil); c != 409 {
		t.Errorf("a sync on a broken connection: %d", c)
	}
}
