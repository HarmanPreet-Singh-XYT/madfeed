package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/portability"
)

func TestQualityPanelOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Quality")
	base := "/v1/workspaces/" + ws

	code, q, _ := h.do(h.alice, "GET", base+"/quality", nil)
	if code != 200 || q["enoughData"] != false || q["days"].(float64) != 30 || q["minDecided"].(float64) != 20 {
		t.Fatalf("empty: %d %v", code, q)
	}
	if rates := q["total"].(map[string]any)["rates"].(map[string]any); len(rates) != 0 {
		t.Fatalf("no decisions means no rates: %v", rates)
	}

	// Two suggestions: accept one unchanged, dismiss one.
	sid := h.processed(h.alice, ws, convo+"\n\n"+uuid.NewString())
	_, props, _ := h.do(h.alice, "GET", base+"/proposals", nil)
	ps := props["proposals"].([]any)
	if len(ps) != 2 || ps[0].(map[string]any)["sourceItemId"] != sid {
		t.Fatalf("setup: %v", ps)
	}
	h.do(h.alice, "POST", base+"/proposals/"+ps[0].(map[string]any)["id"].(string)+"/accept", map[string]any{})
	h.do(h.alice, "POST", base+"/proposals/"+ps[1].(map[string]any)["id"].(string)+"/dismiss", nil)

	code, q, _ = h.do(h.alice, "GET", base+"/quality?days=7", nil)
	total := q["total"].(map[string]any)
	counts, rates := total["counts"].(map[string]any), total["rates"].(map[string]any)
	if code != 200 || counts["accepted"].(float64) != 1 || counts["dismissed"].(float64) != 1 || counts["stillOpen"].(float64) != 0 ||
		rates["accepted"].(float64) != 0.5 || rates["acceptedAsIs"].(float64) != 0.5 || rates["editedOfAccepted"].(float64) != 0 {
		t.Fatalf("%d %v", code, q)
	}
	if q["enoughData"] != false {
		t.Fatal("two decisions are not enough to trust the rates")
	}
	if src := q["bySource"].([]any); len(src) != 1 || src[0].(map[string]any)["kind"] != "paste" {
		t.Fatalf("%v", src)
	}
	if code, _, _ := h.do(h.alice, "GET", base+"/quality?days=0", nil); code != 400 {
		t.Errorf("days=0: %d", code)
	}
	if code, _, _ := h.do(h.bob, "GET", base+"/quality", nil); code != 404 {
		t.Errorf("stranger: %d", code)
	}
}

func TestExportOverHTTPIsAdminOnlyAndVerifiable(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Export")
	base := "/v1/workspaces/" + ws
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	dana := h.personID(h.alice, ws, "dana@acme.com")
	sid := h.pasteAs(h.alice, ws, dana, "Dana: We really need SSO for our team.\n\n"+uuid.NewString())
	h.do(h.alice, "POST", base+"/proposals/"+h.proposalFor(h.alice, ws, sid)+"/accept", map[string]any{})

	req := httptest.NewRequest("GET", base+"/export", nil)
	req.Header.Set("Authorization", "Bearer "+h.alice)
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Disposition"), "attachment") || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	var doc portability.Document
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if err := portability.Verify(&doc); err != nil {
		t.Fatalf("the downloaded export does not verify: %v", err)
	}
	if len(doc.People) != 4 || len(doc.Evidence) != 1 || len(doc.Requests) != 1 {
		t.Fatalf("%d people %d evidence %d requests", len(doc.People), len(doc.Evidence), len(doc.Requests))
	}

	// A member who is not an admin gets a clear refusal, not a file.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, body, _ := h.do(h.bob, "GET", base+"/export", nil); code != 403 || body["error"] == nil {
		t.Fatalf("member export: %d %v", code, body)
	}
	if code, _, _ := h.do("", "GET", base+"/export", nil); code != 401 {
		t.Fatalf("no token: %d", code)
	}
}
