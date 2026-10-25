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

const hubspotPeopleCSV = "Name,Email,Company\nDana Lee,dana@acme.com,Acme Inc\nRaj Patel,raj@acme.com,\nSam Cho,sam@globex.io,Globex\nEve Park,eve@initech.io,\nZed,zed@nowhere.io,\n"

type hsEnv struct {
	h  *harness
	f  *devfakes.HubSpot
	ws string
}

func newHSEnv(t *testing.T) *hsEnv {
	h := newHarness(t)
	f := devfakes.NewHubSpot()
	srv := httptest.NewServer(f.Handler())
	t.Cleanup(srv.Close)
	h.srv.Integrations.HubSpot = integrations.HubSpotConfig{APIBase: srv.URL}
	e := &hsEnv{h: h, f: f, ws: h.workspace(h.alice, "CRM Co")}
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": hubspotPeopleCSV}); c != 200 {
		t.Fatalf("import: %d %v", c, b)
	}
	f.Set(func() {
		f.Contacts["dana@acme.com"] = devfakes.HSContact{ID: "1", CompanyID: "100"}
		f.Contacts["raj@acme.com"] = devfakes.HSContact{ID: "2", CompanyID: "100"}
		f.Contacts["sam@globex.io"] = devfakes.HSContact{ID: "3", CompanyID: "200"}
		f.Contacts["eve@initech.io"] = devfakes.HSContact{ID: "4", CompanyID: "300"}
		f.Companies["100"] = devfakes.HSCompany{ID: "100", Name: "Acme Inc", Domain: "www.Acme.com", AnnualRevenue: "250000"}
		f.Companies["200"] = devfakes.HSCompany{ID: "200", Name: "Globex Corporation", Domain: "globex.io", AnnualRevenue: "9000000"}
		f.Companies["300"] = devfakes.HSCompany{ID: "300", Name: "Initech", Domain: "initech.io", AnnualRevenue: "1200000.5"}
		f.Deals = []devfakes.HSDeal{
			{ID: "900", CompanyID: "100", Amount: "100000", Won: true}, {ID: "901", CompanyID: "100", Amount: "50000", Won: true},
			{ID: "902", CompanyID: "100", Amount: "75000", Won: false},
		}
	})
	return e
}

func (e *hsEnv) base() string { return "/v1/workspaces/" + e.ws + "/integrations/hubspot" }

func (e *hsEnv) connect(valueFrom string) {
	e.h.t.Helper()
	if c, b, _ := e.h.do(e.h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.Token, "valueFrom": valueFrom}); c != 204 {
		e.h.t.Fatalf("connect: %d %v", c, b)
	}
}

func (e *hsEnv) sync() integrations.HubSpotRun {
	e.h.t.Helper()
	run, err := e.h.srv.Integrations.HubSpotSync(context.Background(), uuid.MustParse(e.ws))
	if err != nil {
		e.h.t.Fatalf("sync: %v %+v", err, run)
	}
	return run
}

func (e *hsEnv) account(name string) (revenue, domain string, people int) {
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

func TestConnectingHubSpotIsCheckedAndTheTokenIsSealed(t *testing.T) {
	e := newHSEnv(t)
	h := e.h
	good := map[string]any{"token": e.f.Token, "valueFrom": "revenue"}
	if c, _, _ := h.do(h.bob, "POST", e.base()+"/connect", good); c != 403 && c != 404 {
		t.Errorf("a stranger: %d", c)
	}
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": "wrong-token-000000", "valueFrom": "revenue"}); c != 400 || !strings.Contains(fmt.Sprint(b), "did not accept") {
		t.Errorf("a wrong token: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.Token, "valueFrom": "everything"}); c != 400 {
		t.Errorf("an unknown value source: %d", c)
	}
	e.f.Set(func() { e.f.NoDeals = true })
	if c, b, _ := h.do(h.alice, "POST", e.base()+"/connect", map[string]any{"token": e.f.Token, "valueFrom": "won_deals"}); c != 400 || !strings.Contains(fmt.Sprint(b), "permission") {
		t.Errorf("deals not allowed: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/connect", good); c != 204 {
		t.Errorf("revenue does not need deals: %d", c)
	}
	_, d, _ := h.do(h.alice, "GET", e.base()+"/details", nil)
	if d["state"] != "connected" || d["valueFrom"] != "revenue" || d["syncing"] != true || d["lastSync"] != nil {
		t.Errorf("details %v", d)
	}
	_, list, _ := h.rawJSON(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", "", nil)
	var sealed []byte
	h.db.Super.QueryRow(context.Background(), `SELECT secret FROM integration WHERE workspace_id=$1 AND kind='hubspot'`, e.ws).Scan(&sealed)
	if strings.Contains(list, e.f.Token) || len(sealed) == 0 || bytes.Contains(sealed, []byte(e.f.Token)) {
		t.Error("the token is not kept sealed")
	}
}

func TestTheSyncFillsAccountsFromHubSpotAndTouchesNothingElse(t *testing.T) {
	e := newHSEnv(t)
	e.connect("revenue")
	// an account in another workspace with the same name is never touched
	other := e.h.workspace(e.h.bob, "Other")
	e.h.do(e.h.bob, "POST", "/v1/workspaces/"+other+"/people/import", map[string]any{"csv": "Name,Email,Company,ARR\nDana Two,dana2@acme.com,Acme Inc,1\n"})

	run := e.sync()
	if run.People != 5 || run.Matched != 4 || run.PeopleLinked != 2 || run.AccountsCreated != 1 || run.AccountsUpdated != 1 || run.Skipped != 1 {
		t.Fatalf("run %+v", run)
	}
	if rev, dom, n := e.account("Acme Inc"); rev != "250000.00" || dom != "acme.com" || n != 2 {
		t.Errorf("Acme: %q %q %d", rev, dom, n)
	}
	// the person's own account is a different company: left alone
	if rev, dom, n := e.account("Globex"); rev != "" || dom != "" || n != 1 {
		t.Errorf("Globex was changed: %q %q %d", rev, dom, n)
	}
	if _, _, n := e.account("Globex Corporation"); n != 0 {
		t.Error("an account was made for a company the person already has another account for")
	}
	if rev, dom, n := e.account("Initech"); rev != "1200000.50" || dom != "initech.io" || n != 1 {
		t.Errorf("Initech: %q %q %d", rev, dom, n)
	}
	var people int
	e.h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM person WHERE workspace_id=$1`, e.ws).Scan(&people)
	if people != 5 {
		t.Errorf("%d people: nobody may be created or removed", people)
	}
	var orev string
	e.h.db.Super.QueryRow(context.Background(), `SELECT revenue::text FROM account WHERE workspace_id=$1`, other).Scan(&orev)
	if orev != "1.00" {
		t.Errorf("another workspace's account changed: %s", orev)
	}
	if e.f.Writes() != 0 {
		t.Errorf("%d calls could have changed HubSpot", e.f.Writes())
	}

	// again: nothing new
	again := e.sync()
	if again.PeopleLinked != 0 || again.AccountsCreated != 0 || again.AccountsUpdated != 0 {
		t.Errorf("second run %+v", again)
	}
	_, d, _ := e.h.do(e.h.alice, "GET", e.base()+"/details", nil)
	ls, _ := d["lastSync"].(map[string]any)
	if ls == nil || ls["ok"] != true || d["syncing"] != false {
		t.Errorf("details %v", d)
	}
}

func TestValueCanComeFromClosedWonDeals(t *testing.T) {
	e := newHSEnv(t)
	e.connect("won_deals")
	run := e.sync()
	if !run.OK {
		t.Fatalf("%+v", run)
	}
	// 100000 + 50000 won; the open 75000 deal does not count; Initech has no deals so no value
	if rev, _, _ := e.account("Acme Inc"); rev != "150000.00" {
		t.Errorf("Acme %q", rev)
	}
	if rev, _, _ := e.account("Initech"); rev != "" {
		t.Errorf("Initech %q", rev)
	}
}

func TestAskedForSyncsRunFromTheQueueAndAFailureIsShown(t *testing.T) {
	e := newHSEnv(t)
	e.connect("revenue")
	if c, _, _ := e.h.do(e.h.bob, "POST", e.base()+"/sync", nil); c != 403 && c != 404 {
		t.Errorf("a stranger asked for a sync: %d", c)
	}
	e.h.srv.Integrations.CRMSyncDue(context.Background()) // first sync is due as soon as it is connected
	_, d, _ := e.h.do(e.h.alice, "GET", e.base()+"/details", nil)
	if d["syncing"] != false || d["lastSync"] == nil {
		t.Fatalf("details %v", d)
	}
	n := len(e.f.Calls)
	e.h.srv.Integrations.CRMSyncDue(context.Background())
	if len(e.f.Calls) != n {
		t.Error("a sync ran again straight away")
	}
	if c, _, _ := e.h.do(e.h.alice, "POST", e.base()+"/sync", nil); c != 202 {
		t.Fatalf("ask: %d", c)
	}
	if _, d, _ := e.h.do(e.h.alice, "GET", e.base()+"/details", nil); d["syncing"] != true {
		t.Errorf("not marked as waiting: %v", d)
	}
	// HubSpot stops accepting the token: the failure is recorded in plain words and the connection asks to be redone
	e.f.Set(func() { e.f.Token += "-rotated" })
	e.h.srv.Integrations.CRMSyncDue(context.Background())
	_, d, _ = e.h.do(e.h.alice, "GET", e.base()+"/details", nil)
	ls, _ := d["lastSync"].(map[string]any)
	if d["state"] != "needs_reconnect" || ls == nil || ls["ok"] != false || !strings.Contains(fmt.Sprint(ls["error"]), "did not accept") {
		t.Errorf("details %v", d)
	}
	if c, _, _ := e.h.do(e.h.alice, "POST", e.base()+"/sync", nil); c != 409 {
		t.Errorf("asking for a sync on a broken connection: %d", c)
	}
	// HubSpot asks us to slow down: recorded, retried next time, nothing half done
	e.f.Set(func() { e.f.Token = strings.TrimSuffix(e.f.Token, "-rotated") })
	e.connect("revenue")
	e.f.Set(func() { e.f.Throttle = true })
	run, err := e.h.srv.Integrations.HubSpotSync(context.Background(), uuid.MustParse(e.ws))
	if err == nil || run.OK || !strings.Contains(run.Error, "slow down") {
		t.Errorf("throttled: %v %+v", err, run)
	}
}
