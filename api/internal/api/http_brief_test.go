package api

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/brief"
)

func (hn *harness) runBrief(ws, req string) {
	hn.t.Helper()
	if err := hn.briefW.Work(context.Background(), &river.Job[brief.GenerateArgs]{
		JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
		Args:   brief.GenerateArgs{WorkspaceID: uuid.MustParse(ws), RequestID: uuid.MustParse(req), UserID: hn.aliceID},
	}); err != nil {
		hn.t.Fatal(err)
	}
}

func TestDecisionBriefOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Briefs")
	base := "/v1/workspaces/" + ws
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	dana, raj := h.personID(h.alice, ws, "dana@acme.com"), h.personID(h.alice, ws, "raj@acme.com")

	// A request with two quotes from two people at one account.
	s1 := h.pasteAs(h.alice, ws, dana, "Dana: We really need SSO for our team.\n\n"+uuid.NewString())
	_, acc, _ := h.do(h.alice, "POST", base+"/proposals/"+h.proposalFor(h.alice, ws, s1)+"/accept", map[string]any{})
	reqID := acc["requestId"].(string)

	// Brief before asking for one: not found. Asking with one quote works and says so.
	if code, _, _ := h.do(h.alice, "GET", base+"/requests/"+reqID+"/brief", nil); code != 404 {
		t.Fatalf("get before request: %d", code)
	}
	code, v, _ := h.do(h.alice, "POST", base+"/requests/"+reqID+"/brief", nil)
	if code != 202 || v["state"] != "pending" {
		t.Fatalf("request brief: %d %v", code, v)
	}
	if code, v, _ := h.do(h.alice, "POST", base+"/requests/"+reqID+"/brief", nil); code != 200 || v["state"] != "pending" {
		t.Fatalf("asking while pending: %d %v", code, v)
	}
	h.runBrief(ws, reqID)

	code, v, _ = h.do(h.alice, "GET", base+"/requests/"+reqID+"/brief", nil)
	if code != 200 || v["state"] != "ready" || v["stale"] != false || v["lowEvidence"] != true {
		t.Fatalf("get: %d %v", code, v)
	}
	facts := v["facts"].(map[string]any)
	if facts["evidenceCount"].(float64) != 1 || facts["peopleCount"].(float64) != 1 || facts["totalValue"] != "100000.00" {
		t.Fatalf("facts: %v", facts)
	}
	quote := v["quotes"].([]any)[0].(map[string]any)
	// The cited quote is the stored source text at its span.
	_, src, _ := h.do(h.alice, "GET", base+"/sources/"+quote["sourceItemId"].(string), nil)
	text := src["text"].(string)
	if text[int(quote["spanStart"].(float64)):int(quote["spanEnd"].(float64))] != quote["quote"] {
		t.Fatal("brief quote is not the source text at its span")
	}

	// A second asker at the same account makes it stale; the old brief stays visible but flagged.
	s2 := h.pasteAs(h.alice, ws, raj, "Raj: We really need SSO for our team.\n\n"+uuid.NewString())
	if code, _, _ := h.do(h.alice, "POST", base+"/proposals/"+h.proposalFor(h.alice, ws, s2)+"/accept", map[string]any{"targetRequestId": reqID}); code != 200 {
		t.Fatal("merge")
	}
	if _, v, _ := h.do(h.alice, "GET", base+"/requests/"+reqID+"/brief", nil); v["stale"] != true || v["state"] != "ready" {
		t.Fatalf("expected stale: %v", v)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/requests/"+reqID+"/brief", nil); code != 202 {
		t.Fatalf("refresh: %d", code)
	}
	h.runBrief(ws, reqID)
	_, v, _ = h.do(h.alice, "GET", base+"/requests/"+reqID+"/brief", nil)
	f := v["facts"].(map[string]any)
	if v["stale"] != false || v["lowEvidence"] != false || f["evidenceCount"].(float64) != 2 || f["peopleCount"].(float64) != 2 || f["accountCount"].(float64) != 1 || f["totalValue"] != "100000.00" {
		t.Fatalf("after refresh: %v", v)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/requests/"+reqID+"/brief", nil); code != 200 {
		t.Fatalf("an up-to-date brief must not start again: %d", code)
	}
}

func TestBriefRefusalsAndAccess(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Brief access")
	base := "/v1/workspaces/" + ws
	// No evidence: a plain 409 explaining what to do.
	var empty string
	if err := h.db.Super.QueryRow(context.Background(), `INSERT INTO request (workspace_id, title) VALUES ($1,'bare') RETURNING id`, ws).Scan(&empty); err != nil {
		t.Fatal(err)
	}
	code, body, _ := h.do(h.alice, "POST", base+"/requests/"+empty+"/brief", nil)
	if code != 409 || !strings.Contains(body["error"].(map[string]any)["message"].(string), "customer quote") {
		t.Fatalf("%d %v", code, body)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/requests/"+uuid.NewString()+"/brief", nil); code != 404 {
		t.Fatalf("unknown request: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/requests/not-a-uuid/brief", nil); code != 400 {
		t.Fatalf("bad id: %d", code)
	}
	// Strangers see nothing; viewers read but cannot start one.
	if code, _, _ := h.do(h.bob, "GET", base+"/requests/"+empty+"/brief", nil); code != 404 {
		t.Fatalf("stranger: %d", code)
	}
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/requests/"+empty+"/brief", nil); code != 403 {
		t.Fatalf("viewer request: %d", code)
	}
}
