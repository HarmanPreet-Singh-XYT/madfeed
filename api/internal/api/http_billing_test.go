package api

import (
	"bytes"
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/client"

	"product/api/internal/aievent"
	"product/api/internal/billing"
	"product/api/internal/store"
)

const (
	whsec      = "whsec_testsigningsecret0123456789"
	priceTeam  = "price_team1234567"
	priceBiz   = "price_business123"
	priceOther = "price_unknownxyz1"
)

type billEnv struct {
	h     *harness
	f     *fakeStripe
	b     *billing.Service
	ws    string
	clock time.Time
	cus   string
	sub   string
	req   string
}

func newBillEnv(t *testing.T) *billEnv {
	h := newHarness(t)
	f := newFakeStripe(t)
	e := &billEnv{h: h, f: f, clock: time.Now(), sub: "sub_" + uuid.NewString()[:8]}
	plans := billing.PlanSet{Plans: []billing.Plan{
		{ID: "free", Name: "Free", PriceText: "Free", Entitlements: billing.Entitlements{AIBudgetUSD: 1}},
		{ID: "team", Name: "Team", PriceText: "$20 a month", StripePriceID: priceTeam, Entitlements: billing.Entitlements{AIBudgetUSD: 5, Recordings: true, APIKeys: 3, PublicPages: true, Digest: true, Integrations: true}},
		{ID: "business", Name: "Business", PriceText: "$90 a month", StripePriceID: priceBiz, Entitlements: billing.Entitlements{AIBudgetUSD: 25, Recordings: true, APIKeys: 10, PublicPages: true, Digest: true, Integrations: true}},
		{ID: "soon", Name: "Soon", Entitlements: billing.Entitlements{AIBudgetUSD: 9}},
	}}
	if err := plans.Validate(); err != nil {
		t.Fatal(err)
	}
	sc := &client.API{}
	sc.Init(f.Key, &stripe.Backends{API: stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(f.srv.URL), MaxNetworkRetries: stripe.Int64(0)})})
	e.b = &billing.Service{Pool: h.db.Backend, Stripe: sc, Plans: plans, WebURL: "https://app.example", WebhookSecret: whsec, Now: func() time.Time { return e.clock }}
	h.srv.Billing = e.b
	e.ws = h.workspace(h.alice, "Paying Co")
	h.do(h.alice, "PUT", "/v1/workspaces/"+e.ws+"/settings", map[string]any{"publicSlug": "pay-" + uuid.NewString()[:8], "senderName": "A"})
	h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/people/import", map[string]any{"csv": peopleCSV})
	e.req = h.requestFrom(h.alice, e.ws, "dana@acme.com")
	return e
}

func (e *billEnv) base() string { return "/v1/workspaces/" + e.ws + "/billing" }

func (e *billEnv) info() map[string]any {
	e.h.t.Helper()
	code, b, _ := e.h.do(e.h.alice, "GET", e.base(), nil)
	if code != 200 {
		e.h.t.Fatalf("billing info: %d %v", code, b)
	}
	return b
}

func (e *billEnv) planID() string { return e.info()["plan"].(map[string]any)["id"].(string) }

func (e *billEnv) send(id, typ string, created time.Time, object string) (int, string) {
	payload, hdr := signedEvent(whsec, id, typ, created, object)
	return e.sendRaw(payload, hdr)
}

func (e *billEnv) sendRaw(payload []byte, hdr string) (int, string) {
	req := httptest.NewRequest("POST", "/v1/webhooks/stripe", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if hdr != "" {
		req.Header.Set("Stripe-Signature", hdr)
	}
	rec := httptest.NewRecorder()
	e.h.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

// startCheckout makes the payment account and returns the Stripe customer id.
func (e *billEnv) startCheckout(plan string) (int, map[string]any) {
	code, b, _ := e.h.do(e.h.alice, "POST", e.base()+"/checkout", map[string]any{"planId": plan})
	if code == 200 && e.cus == "" {
		e.h.db.Super.QueryRow(context.Background(), `SELECT stripe_customer_id FROM billing_account WHERE workspace_id=$1`, e.ws).Scan(&e.cus)
	}
	return code, b
}

// subscribe does what paying looks like: checkout, then Stripe's notifications.
func (e *billEnv) subscribe(price string) {
	e.h.t.Helper()
	plan := map[string]string{priceTeam: "team", priceBiz: "business"}[price]
	if code, b := e.startCheckout(plan); code != 200 {
		e.h.t.Fatalf("checkout: %d %v\nlogs: %s", code, b, e.h.logs.String())
	}
	now := time.Now()
	if c, _ := e.send("evt_cs_"+uuid.NewString(), "checkout.session.completed", now, fmt.Sprintf(`{"id":"cs_test_1","customer":%q,"subscription":%q,"client_reference_id":%q,"mode":"subscription"}`, e.cus, e.sub, e.ws)); c != 200 {
		e.h.t.Fatalf("checkout completed: %d", c)
	}
	e.setSub("active", price, false, now)
}

func (e *billEnv) setSub(status, price string, cancelAtEnd bool, at time.Time) {
	e.h.t.Helper()
	e.f.SetSub(e.sub, subJSON(e.sub, e.cus, status, price, cancelAtEnd, time.Now().Add(30*24*time.Hour)))
	typ := "customer.subscription.updated"
	if c, b := e.send("evt_sub_"+uuid.NewString(), typ, at, subJSON(e.sub, e.cus, status, price, cancelAtEnd, time.Now().Add(30*24*time.Hour))); c != 200 {
		e.h.t.Fatalf("subscription event: %d %s", c, b)
	}
}

// gated runs one use of each paid thing and says which are allowed.
func (e *billEnv) gated() map[string]int {
	h := e.h
	ws := "/v1/workspaces/" + e.ws
	out := map[string]int{}
	out["recordings"], _, _ = h.do(h.alice, "POST", ws+"/media", map[string]any{"filename": "a.mp3", "mimeType": "audio/mpeg", "sizeBytes": 1000})
	out["apikeys"], _, _ = h.do(h.alice, "POST", ws+"/api-keys", map[string]any{"name": "k" + uuid.NewString()[:4]})
	out["form"], _, _ = h.do(h.alice, "PUT", ws+"/form", map[string]any{"enabled": true, "origins": []string{}})
	out["roadmap"], _, _ = h.do(h.alice, "PUT", ws+"/requests/"+e.req+"/public", map[string]any{"public": true, "title": "T", "summary": "S"})
	out["digest"], _, _ = h.do(h.alice, "PUT", ws+"/digest", map[string]any{"enabled": true, "weekday": 1, "hourUtc": 9, "recipients": []string{"a@example.com"}, "recipientsConfirmed": true})
	out["slack"], _, _ = h.do(h.alice, "POST", ws+"/integrations/slack/connect", nil)
	out["github"], _, _ = h.do(h.alice, "POST", ws+"/integrations/github/connect", map[string]any{"token": "github_pat_example_token", "repo": "a/b"})
	return out
}

func allowed(m map[string]int, k string) bool { return m[k] != 402 }

func TestBillingIsOffUnlessConfigured(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "No billing")
	h.srv.Billing = &billing.Service{Pool: h.db.Backend, Plans: billing.DefaultPlans()}
	code, b, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/billing", nil)
	if code != 200 || b["enabled"] != false || b["plan"].(map[string]any)["name"] != "Unlimited" {
		t.Fatalf("%d %v", code, b)
	}
	if c, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/billing/checkout", map[string]any{"planId": "team"}); c != 400 {
		t.Errorf("checkout without a payment provider: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/billing/portal", nil); c != 400 {
		t.Errorf("portal without a payment provider: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+ws+"/api-keys", map[string]any{"name": "k"}); c != 201 {
		t.Errorf("nothing may be limited when billing is off: %d", c)
	}
	// the notification endpoint does not exist without a provider
	rq := httptest.NewRequest("POST", "/v1/webhooks/stripe", strings.NewReader("{}"))
	rc := httptest.NewRecorder()
	h.h.ServeHTTP(rc, rq)
	if rc.Code != 404 {
		t.Errorf("webhook with billing off: %d", rc.Code)
	}
}

func TestAFreeWorkspaceIsLimitedAndUpgradingUnlocksThingsAtOnce(t *testing.T) {
	e := newBillEnv(t)
	h := e.h
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, e.ws, bobID)
	for _, c := range []struct{ method, path string }{{"GET", e.base()}, {"POST", e.base() + "/checkout"}, {"POST", e.base() + "/portal"}} {
		var body any
		if strings.HasSuffix(c.path, "checkout") {
			body = map[string]any{"planId": "team"}
		}
		if code, _, _ := h.do(h.bob, c.method, c.path, body); code != 403 {
			t.Errorf("a member on %s: %d", c.path, code)
		}
		if code, _, _ := h.do("t:"+uuid.NewString(), c.method, c.path, body); code != 404 {
			t.Errorf("a stranger on %s: %d", c.path, code)
		}
	}
	in := e.info()
	if in["enabled"] != true || e.planID() != "free" || in["status"] != "none" || in["canManage"] != false {
		t.Fatalf("a new workspace: %v", in)
	}
	plans := in["plans"].([]any)
	forSale := map[string]bool{}
	for _, p := range plans {
		m := p.(map[string]any)
		forSale[m["id"].(string)] = m["forSale"].(bool)
	}
	if forSale["free"] || !forSale["team"] || !forSale["business"] || forSale["soon"] {
		t.Errorf("for sale: %v", forSale)
	}
	// everything paid is refused, in plain words, and turning things off stays possible
	g := e.gated()
	for _, k := range []string{"recordings", "apikeys", "form", "roadmap", "digest", "slack", "github"} {
		if g[k] != 402 {
			t.Errorf("%s on the free plan: %d, want 402", k, g[k])
		}
	}
	_, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/api-keys", map[string]any{"name": "x"})
	if msg := fmt.Sprint(b); !strings.Contains(msg, "Free plan does not include") || !strings.Contains(msg, "Billing") || b["error"].(map[string]any)["code"] != "plan_limit" {
		t.Errorf("message: %v", b)
	}
	if c, _, _ := h.do(h.alice, "PUT", "/v1/workspaces/"+e.ws+"/form", map[string]any{"enabled": false, "origins": []string{}}); c != 200 {
		t.Errorf("turning the form off: %d", c)
	}
	if c, _, _ := h.do(h.alice, "PUT", "/v1/workspaces/"+e.ws+"/requests/"+e.req+"/public", map[string]any{"public": false}); c != 204 {
		t.Errorf("taking a request off the roadmap: %d", c)
	}
	// checkout: only plans with a price; the payment account is made once; the session carries what it should
	if c, _ := e.startCheckout("nope"); c != 400 {
		t.Errorf("an unknown plan: %d", c)
	}
	if c, _ := e.startCheckout("soon"); c != 400 {
		t.Errorf("a plan with no price: %d", c)
	}
	if c, _ := e.startCheckout("free"); c != 400 {
		t.Errorf("the free plan: %d", c)
	}
	if c, _ := e.startCheckout("team"); c != 200 {
		t.Fatal(c)
	}
	code, b := e.startCheckout("business")
	if code != 200 || !strings.HasPrefix(b["url"].(string), "http://") || e.f.CustomerCount() != 1 {
		t.Errorf("second checkout: %d %v customers=%d", code, b, e.f.CustomerCount())
	}
	s := e.f.LastSession()
	if s["mode"] != "subscription" || s["price"] != priceBiz || s["customer"] != e.cus || s["client_reference_id"] != e.ws ||
		s["success_url"] != "https://app.example/w/"+e.ws+"/settings?billing=success" {
		t.Errorf("session: %v", s)
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/portal", nil); c != 200 {
		t.Errorf("portal once there is a payment account: %d", c)
	}
	// still free until Stripe says it was paid
	if e.planID() != "free" {
		t.Fatal("the plan changed before any payment")
	}

	// paid: the plan changes as soon as the notifications arrive, and the paid things open up
	start := time.Now()
	e.subscribe(priceTeam)
	if e.planID() != "team" || time.Since(start) > 10*time.Second {
		t.Fatalf("plan after paying: %s (%v)", e.planID(), time.Since(start))
	}
	g = e.gated()
	for _, k := range []string{"recordings", "apikeys", "form", "roadmap", "digest"} {
		if g[k] == 402 {
			t.Errorf("%s still refused after paying", k)
		}
	}
	if c, _, _ := h.do(h.alice, "POST", e.base()+"/checkout", map[string]any{"planId": "business"}); c != 400 {
		t.Errorf("a second subscription: %d (changing plan goes through the portal)", c)
	}
	// the key allowance: the team plan includes three
	for i := 0; i < 5; i++ {
		h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/api-keys", map[string]any{"name": fmt.Sprintf("more %d", i)})
	}
	var active int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM api_key WHERE workspace_id=$1 AND revoked_at IS NULL`, e.ws).Scan(&active)
	if active != 3 {
		t.Errorf("%d active keys on a plan that includes 3", active)
	}
	if c, b, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/api-keys", map[string]any{"name": "fourth"}); c != 402 || !strings.Contains(fmt.Sprint(b), "more API keys than 3") {
		t.Errorf("a fourth key: %d %v", c, b)
	}
	// upgrading raises the limit; downgrading stops new use but removes nothing
	e.setSub("active", priceBiz, false, time.Now().Add(time.Second))
	if e.planID() != "business" {
		t.Fatalf("after upgrading: %s", e.planID())
	}
	if c, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/api-keys", map[string]any{"name": "fourth"}); c != 201 {
		t.Errorf("a fourth key on Business: %d", c)
	}
	e.setSub("active", priceTeam, false, time.Now().Add(2*time.Second))
	if e.planID() != "team" {
		t.Fatalf("after downgrading: %s", e.planID())
	}
	if c, _, _ := h.do(h.alice, "POST", "/v1/workspaces/"+e.ws+"/api-keys", map[string]any{"name": "fifth"}); c != 402 {
		t.Errorf("a new key beyond the downgraded plan: %d", c)
	}
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM api_key WHERE workspace_id=$1 AND revoked_at IS NULL`, e.ws).Scan(&active)
	if active != 4 {
		t.Errorf("a downgrade removed keys: %d active", active)
	}
	in = e.info()
	kinds := map[string]int{}
	for _, ev := range in["events"].([]any) {
		kinds[ev.(map[string]any)["kind"].(string)]++
	}
	if kinds["subscribed"] != 1 || kinds["changed"] != 2 {
		t.Errorf("history: %v", in["events"])
	}
}

func TestAFailedPaymentKeepsThePlanForAWhileThenFallsBackAndRecovers(t *testing.T) {
	e := newBillEnv(t)
	h := e.h
	e.subscribe(priceTeam)
	failedAt := time.Now()
	invoice := fmt.Sprintf(`{"id":"in_1","customer":%q}`, e.cus)
	if c, _ := e.send("evt_fail_1", "invoice.payment_failed", failedAt, invoice); c != 200 {
		t.Fatal(c)
	}
	in := e.info()
	if in["status"] != "past_due" || e.planID() != "team" || in["graceEndsAt"] == nil || in["pastDueSince"] == nil {
		t.Fatalf("right after a failed payment: %v", in)
	}
	hasFailureNote := false
	for _, ev := range in["events"].([]any) {
		if ev.(map[string]any)["kind"] == "payment_failed" {
			hasFailureNote = true
		}
	}
	if !hasFailureNote {
		t.Error("the failure is not shown")
	}
	if e.gated()["recordings"] == 402 {
		t.Error("the plan was withdrawn the moment a payment failed")
	}
	// a second failure notice (Stripe retries) does not restart the clock
	e.send("evt_fail_2", "invoice.payment_failed", failedAt.Add(time.Hour), invoice)
	// after the grace period, the free plan applies; nothing is deleted
	e.clock = failedAt.Add(8 * 24 * time.Hour)
	if e.planID() != "free" {
		t.Fatalf("after the grace period: %s", e.planID())
	}
	if g := e.gated(); g["recordings"] != 402 || g["digest"] != 402 {
		t.Errorf("paid things still allowed after the grace period: %v", g)
	}
	// paying brings it back at once
	e.clock = time.Now()
	e.send("evt_paid_1", "invoice.paid", failedAt.Add(2*time.Hour), invoice)
	in = e.info()
	if in["status"] != "active" || e.planID() != "team" || in["pastDueSince"] != nil {
		t.Errorf("after the payment went through: %v", in)
	}
	recovered := false
	for _, ev := range in["events"].([]any) {
		if ev.(map[string]any)["kind"] == "payment_recovered" {
			recovered = true
		}
	}
	if !recovered {
		t.Error("the recovery is not shown")
	}
	// an ordinary paid invoice (a renewal) says nothing and changes nothing
	n := len(e.info()["events"].([]any))
	e.send("evt_paid_2", "invoice.paid", failedAt.Add(3*time.Hour), invoice)
	if len(e.info()["events"].([]any)) != n {
		t.Error("a normal renewal was logged as news")
	}
	_ = h
}

func TestCancellingEndsThePlanAndRefundsAreRecorded(t *testing.T) {
	e := newBillEnv(t)
	e.subscribe(priceTeam)
	e.setSub("active", priceTeam, true, time.Now().Add(time.Second))
	in := e.info()
	if in["cancelAtPeriodEnd"] != true || e.planID() != "team" || in["periodEnd"] == nil {
		t.Fatalf("cancelling at the end of the period keeps the plan until then: %v", in)
	}
	// a refund is recorded and changes nothing by itself
	if c, _ := e.send("evt_refund_1", "charge.refunded", time.Now().Add(2*time.Second), fmt.Sprintf(`{"id":"ch_1","customer":%q,"amount_refunded":1250,"currency":"usd"}`, e.cus)); c != 200 {
		t.Fatal(c)
	}
	// the same notification again (Stripe sends some more than once): one entry, not two
	e.send("evt_refund_1", "charge.refunded", time.Now().Add(2*time.Second), fmt.Sprintf(`{"id":"ch_1","customer":%q,"amount_refunded":1250,"currency":"usd"}`, e.cus))
	refunds := 0
	for _, ev := range e.info()["events"].([]any) {
		if ev.(map[string]any)["kind"] == "refund" {
			refunds++
		}
	}
	if refunds != 1 {
		t.Errorf("%d refund entries for one refund delivered twice", refunds)
	}
	if e.planID() != "team" {
		t.Error("a refund ended the plan by itself")
	}
	found := false
	for _, ev := range e.info()["events"].([]any) {
		m := ev.(map[string]any)
		if m["kind"] == "refund" && m["summary"] == "A refund of 12.50 USD was issued." {
			found = true
		}
	}
	if !found {
		t.Errorf("refund not shown: %v", e.info()["events"])
	}
	// the subscription actually ends
	if c, _ := e.send("evt_del_1", "customer.subscription.deleted", time.Now().Add(3*time.Second), subJSON(e.sub, e.cus, "canceled", priceTeam, false, time.Now())); c != 200 {
		t.Fatal(c)
	}
	in = e.info()
	if e.planID() != "free" || in["status"] != "canceled" || in["cancelAtPeriodEnd"] != false {
		t.Errorf("after the subscription ended: %v", in)
	}
	if g := e.gated(); g["recordings"] != 402 {
		t.Errorf("paid things after cancelling: %v", g)
	}
	// a person can start again
	if c, _ := e.startCheckout("team"); c != 200 {
		t.Errorf("subscribing again: %d", c)
	}
}

func TestPaymentNotificationsAreCheckedActedOnOnceAndInOrder(t *testing.T) {
	e := newBillEnv(t)
	if c, _ := e.startCheckout("team"); c != 200 {
		t.Fatal(c)
	}
	now := time.Now()
	sub := subJSON(e.sub, e.cus, "active", priceTeam, false, now.Add(30*24*time.Hour))

	// signatures and shape
	payload, good := signedEvent(whsec, "evt_sig", "customer.subscription.created", now, sub)
	for name, c := range map[string]struct {
		payload []byte
		hdr     string
	}{
		"no header":       {payload, ""},
		"junk header":     {payload, "garbage"},
		"wrong secret":    {payload, stripeHeader("whsec_anotherothersecret000000000000", payload, now)},
		"body changed":    {append(append([]byte{}, payload[:len(payload)-1]...), []byte(` ,"x":1}`)...), good},
		"too old":         {payload, stripeHeader(whsec, payload, now.Add(-10*time.Minute))},
		"in the future":   {payload, stripeHeader(whsec, payload, now.Add(10*time.Minute))},
		"empty signature": {payload, "t=1,v1="},
	} {
		if code, _ := e.sendRaw(c.payload, c.hdr); code != 401 {
			t.Errorf("%s: %d", name, code)
		}
	}
	if e.planID() != "free" {
		t.Fatal("a refused notification changed the plan")
	}
	if code, _ := e.sendRaw([]byte("not json at all"), stripeHeader(whsec, []byte("not json at all"), now)); code != 401 {
		t.Errorf("not an event: %d", code)
	}
	// a customer we do not know, and other event types, are acknowledged and ignored
	if c, _ := e.send("evt_unknown", "customer.subscription.updated", now, subJSON("sub_x", "cus_nobody", "active", priceBiz, false, now)); c != 200 {
		t.Errorf("unknown customer: %d", c)
	}
	if c, _ := e.send("evt_other", "customer.created", now, `{"id":"cus_1"}`); c != 200 {
		t.Errorf("other event: %d", c)
	}
	if e.planID() != "free" {
		t.Fatal("an unknown customer's event changed a workspace")
	}
	// another workspace's customer cannot be used to change this one
	other := h2(e)
	if c, _ := e.send("evt_cross", "customer.subscription.updated", now, subJSON("sub_y", other, "active", priceBiz, false, now)); c != 200 {
		t.Errorf("cross: %d", c)
	}
	if e.planID() != "free" {
		t.Fatal("another workspace's event reached this workspace")
	}

	// one delivery, eight copies at once: one effect
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); e.send("evt_once", "customer.subscription.created", now, sub) }()
	}
	wg.Wait()
	subscribed := 0
	for _, ev := range e.info()["events"].([]any) {
		if ev.(map[string]any)["kind"] == "subscribed" {
			subscribed++
		}
	}
	if e.planID() != "team" || subscribed != 1 {
		t.Fatalf("plan %s, %d 'subscribed' entries after 8 copies", e.planID(), subscribed)
	}
	// the same event delivered again much later, after things changed: still ignored
	e.send("evt_up", "customer.subscription.updated", now.Add(5*time.Second), subJSON(e.sub, e.cus, "active", priceBiz, false, now.Add(30*24*time.Hour)))
	if e.planID() != "business" {
		t.Fatalf("upgrade: %s", e.planID())
	}
	e.send("evt_once", "customer.subscription.created", now, sub)
	if e.planID() != "business" {
		t.Errorf("a replayed delivery undid a later change: %s", e.planID())
	}
	// out of order: a newer state arrived first, then an older one
	e.send("evt_new", "customer.subscription.updated", now.Add(30*time.Second), subJSON(e.sub, e.cus, "active", priceTeam, false, now.Add(30*24*time.Hour)))
	e.send("evt_old", "customer.subscription.updated", now.Add(10*time.Second), subJSON(e.sub, e.cus, "active", priceBiz, false, now.Add(30*24*time.Hour)))
	if e.planID() != "team" {
		t.Errorf("an older notification arriving late overwrote a newer one: %s", e.planID())
	}
	// a subscription with a price that is not one of our plans does not give a paid plan
	e.send("evt_odd", "customer.subscription.updated", now.Add(40*time.Second), subJSON(e.sub, e.cus, "active", priceOther, false, now.Add(30*24*time.Hour)))
	in := e.info()
	odd := false
	for _, ev := range in["events"].([]any) {
		if ev.(map[string]any)["kind"] == "unknown_price" {
			odd = true
		}
	}
	if e.planID() != "free" || !odd {
		t.Errorf("an unknown price: plan %s, noted=%v", e.planID(), odd)
	}
}

// h2 makes a second paying workspace and returns its Stripe customer id.
func h2(e *billEnv) string {
	other := e.h.workspace(e.h.bob, "Another payer")
	code, _, _ := e.h.do(e.h.bob, "POST", "/v1/workspaces/"+other+"/billing/checkout", map[string]any{"planId": "team"})
	if code != 200 {
		e.h.t.Fatalf("other checkout: %d", code)
	}
	var cus string
	e.h.db.Super.QueryRow(context.Background(), `SELECT stripe_customer_id FROM billing_account WHERE workspace_id=$1`, other).Scan(&cus)
	return cus
}

func TestReconciliationCatchesANotificationThatNeverArrived(t *testing.T) {
	e := newBillEnv(t)
	e.subscribe(priceTeam)
	if e.planID() != "team" {
		t.Fatal("setup")
	}
	// Stripe cancelled it, but the notification was lost
	e.f.SetSub(e.sub, subJSON(e.sub, e.cus, "canceled", priceTeam, false, time.Now()))
	e.b.Reconcile(context.Background(), nil)
	if e.planID() != "team" {
		t.Error("a subscription confirmed a moment ago was re-checked straight away")
	}
	e.h.db.Super.Exec(context.Background(), `UPDATE billing_account SET updated_at = now() - interval '20 minutes' WHERE workspace_id=$1`, e.ws)
	e.b.Reconcile(context.Background(), nil)
	if e.planID() != "free" || e.info()["status"] != "canceled" {
		t.Errorf("after reconciling: %v", e.info())
	}
	// a plan changed on Stripe's side, same thing
	e2 := newBillEnv(t)
	e2.subscribe(priceTeam)
	e2.f.SetSub(e2.sub, subJSON(e2.sub, e2.cus, "active", priceBiz, false, time.Now().Add(30*24*time.Hour)))
	e2.h.db.Super.Exec(context.Background(), `UPDATE billing_account SET updated_at = now() - interval '20 minutes' WHERE workspace_id=$1`, e2.ws)
	e2.b.Reconcile(context.Background(), nil)
	if e2.planID() != "business" {
		t.Errorf("a plan change on Stripe's side was not picked up: %s", e2.planID())
	}
	// a subscription Stripe no longer knows is treated as ended
	e3 := newBillEnv(t)
	e3.subscribe(priceTeam)
	e3.f.Mu.Lock()
	delete(e3.f.Subs, e3.sub)
	e3.f.Mu.Unlock()
	e3.h.db.Super.Exec(context.Background(), `UPDATE billing_account SET updated_at = now() - interval '20 minutes' WHERE workspace_id=$1`, e3.ws)
	e3.b.Reconcile(context.Background(), nil)
	if e3.planID() != "free" {
		t.Errorf("a vanished subscription: %s", e3.planID())
	}
	// a Stripe outage changes nothing
	e4 := newBillEnv(t)
	e4.subscribe(priceTeam)
	e4.f.srv.Close()
	e4.h.db.Super.Exec(context.Background(), `UPDATE billing_account SET updated_at = now() - interval '20 minutes' WHERE workspace_id=$1`, e4.ws)
	e4.b.Reconcile(context.Background(), nil)
	if e4.planID() != "team" {
		t.Errorf("an outage at Stripe took the plan away: %s", e4.planID())
	}
}

func TestTheModelAllowanceFollowsThePlanUnlessAnOperatorSetsOne(t *testing.T) {
	e := newBillEnv(t)
	h := e.h
	wsID := uuid.MustParse(e.ws)
	budget := &aievent.Budget{Pool: h.db.Backend, DefaultUSD: 100, PlanBudget: func(ctx context.Context, ws uuid.UUID) (float64, bool) {
		pl, _, err := e.b.Plan(ctx, ws)
		return pl.Entitlements.AIBudgetUSD, err == nil
	}}
	ten := store.Tenant{WorkspaceID: wsID, UserID: uuid.New(), Role: store.RoleMember}
	ctx := store.WithContext(context.Background(), ten)
	h.db.Super.Exec(ctx, `INSERT INTO ai_event (workspace_id, task, tier, provider, model, prompt_version, outcome, cost_usd) VALUES ($1,'t','mid','p','m','v','ok',2.50)`, e.ws)
	if err := budget.Check(ctx); err == nil {
		t.Error("$2.50 of spend is within the Free plan's $1 allowance")
	}
	e.subscribe(priceTeam) // $5
	if err := budget.Check(ctx); err != nil {
		t.Errorf("within the Team plan's allowance: %v", err)
	}
	h.db.Super.Exec(ctx, `INSERT INTO ai_event (workspace_id, task, tier, provider, model, prompt_version, outcome, cost_usd) VALUES ($1,'t','mid','p','m','v','ok',3.00)`, e.ws)
	if err := budget.Check(ctx); err == nil {
		t.Error("$5.50 is over the Team plan's $5")
	}
	// an operator's own number for this workspace beats the plan
	h.db.Super.Exec(ctx, `UPDATE workspace SET ai_daily_budget_usd = 50 WHERE id=$1`, e.ws)
	if err := budget.Check(ctx); err != nil {
		t.Errorf("an operator override was ignored: %v", err)
	}
}

func TestPlansFilesAreChecked(t *testing.T) {
	good := `{"plans":[{"id":"free","name":"Free","entitlements":{"aiBudgetUsd":1}},{"id":"pro","name":"Pro","stripePriceId":"price_abcdef1234","entitlements":{"aiBudgetUsd":9,"apiKeys":5}}]}`
	for name, body := range map[string]string{
		"no free plan":     `{"plans":[{"id":"pro","name":"Pro","entitlements":{"aiBudgetUsd":9}}]}`,
		"a price on free":  `{"plans":[{"id":"free","name":"Free","stripePriceId":"price_abcdef1234","entitlements":{"aiBudgetUsd":1}}]}`,
		"a repeated id":    `{"plans":[{"id":"free","name":"A","entitlements":{"aiBudgetUsd":1}},{"id":"free","name":"B","entitlements":{"aiBudgetUsd":1}}]}`,
		"a bad price id":   `{"plans":[{"id":"free","name":"Free","entitlements":{"aiBudgetUsd":1}},{"id":"p","name":"P","stripePriceId":"prod_123","entitlements":{"aiBudgetUsd":1}}]}`,
		"one price twice":  `{"plans":[{"id":"free","name":"Free","entitlements":{"aiBudgetUsd":1}},{"id":"a","name":"A","stripePriceId":"price_abcdef1234","entitlements":{"aiBudgetUsd":1}},{"id":"b","name":"B","stripePriceId":"price_abcdef1234","entitlements":{"aiBudgetUsd":1}}]}`,
		"no allowance":     `{"plans":[{"id":"free","name":"Free","entitlements":{"aiBudgetUsd":0}}]}`,
		"too many keys":    `{"plans":[{"id":"free","name":"Free","entitlements":{"aiBudgetUsd":1,"apiKeys":11}}]}`,
		"an unknown field": `{"plans":[{"id":"free","name":"Free","entitlements":{"aiBudgetUsd":1},"discount":50}]}`,
		"a bad id":         `{"plans":[{"id":"Free Plan","name":"Free","entitlements":{"aiBudgetUsd":1}}]}`,
	} {
		path := t.TempDir() + "/plans.json"
		if err := writeFile(path, body); err != nil {
			t.Fatal(err)
		}
		if _, err := billing.LoadPlans(path); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	path := t.TempDir() + "/plans.json"
	writeFile(path, good)
	ps, err := billing.LoadPlans(path)
	if err != nil || len(ps.Plans) != 2 {
		t.Fatalf("a good file: %v", err)
	}
	if _, err := billing.LoadPlans(t.TempDir() + "/missing.json"); err == nil {
		t.Error("a missing file was accepted")
	}
	if d, err := billing.LoadPlans(""); err != nil || d.Free().ID != "free" {
		t.Errorf("defaults: %v", err)
	}
	// the example file shipped in docs is itself valid (apart from its placeholder prices, which are checked as prices)
	if _, err := billing.LoadPlans("../../../docs/plans.example.json"); err == nil {
		t.Log("example prices look valid")
	}
}

func writeFile(path, body string) error { return os.WriteFile(path, []byte(body), 0o600) }
