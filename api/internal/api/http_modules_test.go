package api

import (
	"testing"

	"product/api/internal/billing"
	"product/api/internal/modules"
)

func TestAPlanSwitchesToolsOnAndOffAndStrangersLearnNothing(t *testing.T) {
	e := newBillEnv(t)
	h := e.h
	// Free gets only the feedback tool; team gets everything (no list means all tools).
	e.b.Plans = billing.PlanSet{Plans: []billing.Plan{
		{ID: "free", Name: "Free", PriceText: "Free", Entitlements: billing.Entitlements{AIBudgetUSD: 1, Modules: []string{"feedback"}}},
		{ID: "team", Name: "Team", PriceText: "$20 a month", StripePriceID: priceTeam, Entitlements: billing.Entitlements{AIBudgetUSD: 5, Surveys: true}},
	}}
	ws := "/v1/workspaces/" + e.ws

	code, body, _ := h.do(h.alice, "GET", ws+"/access", nil)
	if code != 200 {
		t.Fatalf("access: %d %v", code, body)
	}
	if got := body["modules"].([]any); len(got) != 1 || got[0] != "feedback" || body["role"] != "admin" || len(body["permissions"].([]any)) != 3 {
		t.Errorf("free plan access = %v", body)
	}

	// A tool the plan leaves out is refused with the plan message, not "not found"; the core keeps working.
	for _, path := range []string{"/inbox/stats", "/surveys", "/findings", "/media/00000000-0000-0000-0000-000000000001", "/qa/00000000-0000-0000-0000-000000000001"} {
		if code, b, _ := h.do(h.alice, "GET", ws+path, nil); code != 402 {
			t.Errorf("free GET %s = %d %v, want 402", path, code, b)
		}
	}
	for _, path := range []string{"/requests", "/people", "/billing", "/members", "/access"} {
		if code, _, _ := h.do(h.alice, "GET", ws+path, nil); code != 200 {
			t.Errorf("free GET %s = %d, want 200 (core and feedback stay on)", path, code)
		}
	}

	// A stranger gets "not found" for a switched-off tool, exactly as for a switched-on one.
	if code, _, _ := h.do(h.bob, "GET", ws+"/inbox/stats", nil); code != 404 {
		t.Errorf("stranger on a switched-off tool = %d, want 404", code)
	}
	if code, _, _ := h.do(h.bob, "GET", ws+"/access", nil); code != 404 {
		t.Errorf("stranger access = %d, want 404", code)
	}

	// Paying turns everything on.
	e.subscribe(priceTeam)
	if code, b, _ := h.do(h.alice, "GET", ws+"/access", nil); code != 200 || len(b["modules"].([]any)) != len(modules.All()) {
		t.Errorf("team plan modules = %v", b)
	}
	if code, b, _ := h.do(h.alice, "GET", ws+"/inbox/stats", nil); code != 200 {
		t.Errorf("team GET inbox/stats = %d %v", code, b)
	}
}

func TestPlanFilesRejectAnUnknownTool(t *testing.T) {
	ps := billing.PlanSet{Plans: []billing.Plan{{ID: "free", Name: "Free", Entitlements: billing.Entitlements{AIBudgetUSD: 1, Modules: []string{"feedbak"}}}}}
	if err := ps.Validate(); err == nil {
		t.Error("a misspelled tool name was accepted")
	}
	ps.Plans[0].Entitlements.Modules = []string{"feedback", "support"}
	if err := ps.Validate(); err != nil {
		t.Errorf("valid tools refused: %v", err)
	}
}
