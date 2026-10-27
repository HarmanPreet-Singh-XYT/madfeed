package api

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"product/api/internal/billing"
	"product/api/internal/cache"
	"product/api/internal/modules"
)

func modules2() []modules.ID { return modules.All() }

// withCache gives every service that remembers things the same signed Redis, as in production.
func withCache(t *testing.T, h *harness) *miniredis.Miniredis {
	t.Helper()
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })
	data := cache.Sign(rc, []byte("http-test-cache-secret"))
	h.srv.Cache = data
	h.srv.Team.Cache = data
	h.srv.Workspaces.Cache = data
	h.srv.APIKeys.Cache = data
	h.srv.OAuth.Keys.Cache = data
	h.srv.Inbox.Cache = data
	h.srv.Billing.Cache = data
	h.srv.Limiter.Cache = rc
	return mr
}

func TestRolesAreRememberedThroughTheRealHandlersAndChangesTakeEffectAtOnce(t *testing.T) {
	h := newHarness(t)
	withCache(t, h)
	ws := h.workspace(h.alice, "Cached Co")
	bobID := uuid.New()
	bob := "t:" + bobID.String()
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID)
	role := func() (int, string) {
		code, b, _ := h.do(bob, "GET", "/v1/workspaces/"+ws+"/access", nil)
		r, _ := b["role"].(string)
		return code, r
	}

	if c, r := role(); c != 200 || r != "member" {
		t.Fatalf("start: %d %s", c, r)
	}
	// Changed behind the cache's back, so the old role is still served: proof the handlers use the cache.
	h.db.Super.Exec(context.Background(), `UPDATE member SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`, ws, bobID)
	if c, r := role(); c != 200 || r != "member" {
		t.Fatalf("the remembered role was not used: %d %s", c, r)
	}
	// Changed through the API: felt at once.
	if c, b, _ := h.do(h.alice, "PUT", "/v1/workspaces/"+ws+"/members/"+bobID.String(), map[string]any{"role": "viewer"}); c != 204 && c != 200 {
		t.Fatalf("set role: %d %v", c, b)
	}
	if c, r := role(); c != 200 || r != "viewer" {
		t.Fatalf("after the change: %d %s", c, r)
	}
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+ws+"/members/"+bobID.String(), nil); c != 204 {
		t.Fatalf("remove: %d", c)
	}
	if c, _ := role(); c != 404 {
		t.Fatalf("a removed person still gets in: %d", c)
	}
}

func TestAPlanChangeFromStripeIsFeltAtOnceAndToolRoutesStillWork(t *testing.T) {
	e := newBillEnv(t)
	withCache(t, e.h)
	e.b.Cache = e.h.srv.Cache
	// Free switches on one tool, Team all of them, so /access shows which plan the server believes in. (The
	// billing page reads the database directly and would not notice a stale remembered plan.)
	e.b.Plans = billing.PlanSet{Plans: []billing.Plan{
		{ID: "free", Name: "Free", PriceText: "Free", Entitlements: billing.Entitlements{AIBudgetUSD: 1, Modules: []string{"feedback"}}},
		{ID: "team", Name: "Team", PriceText: "$20 a month", StripePriceID: priceTeam, Entitlements: billing.Entitlements{AIBudgetUSD: 5, Surveys: true}},
	}}
	ws := "/v1/workspaces/" + e.ws
	modules := func() int {
		c, b, _ := e.h.do(e.h.alice, "GET", ws+"/access", nil)
		if c != 200 {
			t.Fatalf("access: %d %v", c, b)
		}
		return len(b["modules"].([]any))
	}
	if n := modules(); n != 1 {
		t.Fatalf("free plan: %d tools", n)
	}
	// A tool the plan leaves out is refused, from the remembered plan, through the module gate and the memo.
	if c, _, _ := e.h.do(e.h.alice, "GET", ws+"/inbox/stats", nil); c != 402 {
		t.Fatalf("a tool outside the plan: %d", c)
	}
	// The upgrade, step by step, with the plan remembered just before the notification that changes it.
	if c, b := e.startCheckout("team"); c != 200 {
		t.Fatalf("checkout: %d %v", c, b)
	}
	now := time.Now()
	if c, _ := e.send("evt_cs_"+uuid.NewString(), "checkout.session.completed", now, fmt.Sprintf(`{"id":"cs_test_1","customer":%q,"subscription":%q,"client_reference_id":%q,"mode":"subscription"}`, e.cus, e.sub, e.ws)); c != 200 {
		t.Fatalf("checkout completed: %d", c)
	}
	if n := modules(); n != 1 { // still Free, and now remembered
		t.Fatalf("after checkout but before the subscription is active: %d tools", n)
	}
	e.setSub("active", priceTeam, false, now)
	if n := modules(); n != len(modules2()) {
		t.Fatalf("the remembered plan outlived the Stripe notification: %d tools", n)
	}
	if c, b, _ := e.h.do(e.h.alice, "GET", ws+"/inbox/stats", nil); c != 200 {
		t.Fatalf("the tool after upgrading: %d %v", c, b)
	}
}

func TestDisconnectingOrRefreshingAnAssistantEndsTheOldTokenAtOnce(t *testing.T) {
	e := newOAEnv(t)
	h := e.h
	withCache(t, h)
	client, tok := e.connect([]string{"requests"})
	access, refresh := tok["access_token"].(string), tok["refresh_token"].(string)
	if c, _, _ := h.do(access, "GET", "/v1/ext/requests", nil); c != 200 {
		t.Fatalf("the new token: %d", c)
	}
	// Renewing replaces the access token; the old one must stop working now, not when its memory runs out.
	st, fresh := e.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {client}})
	if st != 200 {
		t.Fatalf("refresh: %d %v", st, fresh)
	}
	if c, _, _ := h.do(access, "GET", "/v1/ext/requests", nil); c != 401 {
		t.Fatalf("the replaced token still works: %d", c)
	}
	newAccess := fresh["access_token"].(string)
	if c, _, _ := h.do(newAccess, "GET", "/v1/ext/requests", nil); c != 200 {
		t.Fatalf("the renewed token: %d", c)
	}
	_, gs, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/oauth/grants", nil)
	id := gs["grants"].([]any)[0].(map[string]any)["id"].(string)
	if c, _, _ := h.do(h.alice, "DELETE", "/v1/workspaces/"+e.ws+"/oauth/grants/"+id, nil); c != 204 {
		t.Fatalf("disconnect: %d", c)
	}
	if c, _, _ := h.do(newAccess, "GET", "/v1/ext/requests", nil); c != 401 {
		t.Fatalf("a disconnected assistant still works: %d", c)
	}
}

func TestRateLimitsCountInRedisAndTouchNoDatabaseRow(t *testing.T) {
	h := newHarness(t)
	withCache(t, h)
	h.srv.Limits.ReadPerMinute = 3
	ws := h.workspace(h.alice, "Limited Co")
	var before, n int
	// The test database is shared, so count what this test adds rather than what exists.
	h.db.Super.QueryRow(context.Background(), `SELECT coalesce(sum(hits),0) FROM rate_limit WHERE bucket LIKE 'read:%'`).Scan(&before)
	codes := []int{}
	for i := 0; i < 5; i++ {
		c, _, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/access", nil)
		codes = append(codes, c)
	}
	if codes[0] != 200 || codes[2] != 200 || codes[3] != 429 || codes[4] != 429 {
		t.Fatalf("limit not enforced as 3 per minute: %v", codes)
	}
	h.db.Super.QueryRow(context.Background(), `SELECT coalesce(sum(hits),0) FROM rate_limit WHERE bucket LIKE 'read:%'`).Scan(&n)
	if n != before {
		t.Fatalf("%d read hits were counted in Postgres (it held %d before)", n-before, before)
	}
	for _, line := range strings.Split(h.logs.String(), "\n") {
		if strings.Contains(line, "rate limiter unavailable") {
			t.Fatalf("the limiter fell back to Postgres: %s", line)
		}
	}
}
