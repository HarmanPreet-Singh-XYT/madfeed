package api

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/intake"
)

const peopleCSV = "Name,Email,Company,ARR\nDana Lee,dana@acme.com,Acme Inc,\"$100,000\"\nRaj Patel,raj@acme.com,Acme Inc,100000\nSam Cho,sam@globex.io,Globex,5000\nSolo,,,\n"

// pasteAs ingests a conversation attributed to a person and runs extraction.
func (hn *harness) pasteAs(token, ws, personID, text string) string {
	hn.t.Helper()
	body := map[string]any{"text": text}
	if personID != "" {
		body["personId"] = personID
	}
	code, resp, _ := hn.do(token, "POST", "/v1/workspaces/"+ws+"/sources/paste", body)
	if code != 202 {
		hn.t.Fatalf("paste: %d %v", code, resp)
	}
	sid := uuid.MustParse(resp["sourceItemId"].(string))
	if err := hn.worker.Work(context.Background(), &river.Job[intake.ExtractArgs]{
		JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
		Args:   intake.ExtractArgs{WorkspaceID: uuid.MustParse(ws), SourceItemID: sid, UserID: hn.aliceID},
	}); err != nil {
		hn.t.Fatal(err)
	}
	return sid.String()
}

func (hn *harness) personID(token, ws, email string) string {
	hn.t.Helper()
	_, body, _ := hn.do(token, "GET", "/v1/workspaces/"+ws+"/people?limit=200", nil)
	for _, p := range body["people"].([]any) {
		m := p.(map[string]any)
		if m["email"] == email {
			return m["id"].(string)
		}
	}
	hn.t.Fatalf("no person %s", email)
	return ""
}

// firstProposal returns the id of the first suggestion produced by a source.
func (hn *harness) proposalFor(token, ws, sourceID string) string {
	hn.t.Helper()
	_, body, _ := hn.do(token, "GET", "/v1/workspaces/"+ws+"/proposals?limit=200", nil)
	for _, p := range body["proposals"].([]any) {
		m := p.(map[string]any)
		if m["sourceItemId"] == sourceID {
			return m["id"].(string)
		}
	}
	hn.t.Fatalf("no proposal for source %s", sourceID)
	return ""
}

func TestImportPreviewThenConfirmThroughTheAPI(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Directory")
	base := "/v1/workspaces/" + ws

	code, prev, _ := h.do(h.alice, "POST", base+"/people/import/preview", map[string]any{"csv": peopleCSV})
	if code != 200 || prev["validRows"].(float64) != 4 || prev["errorCount"].(float64) != 0 || prev["delimiter"] != "," {
		t.Fatalf("preview: %d %v", code, prev)
	}
	if m := prev["mapping"].(map[string]any); m["email"] != "Email" || m["account"] != "Company" || m["revenue"] != "ARR" {
		t.Fatalf("mapping %v", m)
	}
	// Preview wrote nothing.
	if _, body, _ := h.do(h.alice, "GET", base+"/people", nil); len(body["people"].([]any)) != 0 {
		t.Fatal("preview wrote people")
	}

	code, res, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	if code != 200 || res["peopleCreated"].(float64) != 4 || res["accountsCreated"].(float64) != 2 {
		t.Fatalf("import: %d %v", code, res)
	}
	_, acc, _ := h.do(h.alice, "GET", base+"/accounts", nil)
	accounts := acc["accounts"].([]any)
	if len(accounts) != 2 || accounts[0].(map[string]any)["name"] != "Acme Inc" || accounts[0].(map[string]any)["revenue"] != "100000.00" || accounts[0].(map[string]any)["peopleCount"].(float64) != 2 {
		t.Fatalf("accounts %v", accounts)
	}

	// A file with problems is refused with row numbers, and nothing is written, unless skipping is chosen.
	bad := "Name,Email,Company,ARR\nOk,ok@x.io,Initech,10\nBad,nope,Initech,10\n"
	code, e, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": bad})
	if code != 400 || !strings.Contains(e["error"].(map[string]any)["message"].(string), "row 3") {
		t.Fatalf("bad import: %d %v", code, e)
	}
	if code, res, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": bad, "skipInvalidRows": true}); code != 200 || res["skipped"].(float64) != 1 || res["peopleCreated"].(float64) != 1 {
		t.Fatalf("skip: %d %v", code, res)
	}
	// Preview reports problems instead of failing.
	if code, p, _ := h.do(h.alice, "POST", base+"/people/import/preview", map[string]any{"csv": bad}); code != 200 || p["errorCount"].(float64) != 1 || p["validRows"].(float64) != 1 {
		t.Fatalf("preview with problems: %d %v", code, p)
	}
	// File-level problems are plain 400s.
	for name, csv := range map[string]string{"no person column": "Company,ARR\nAcme,1\n", "header only": "Name,Email\n"} {
		if code, _, _ := h.do(h.alice, "POST", base+"/people/import/preview", map[string]any{"csv": csv}); code != 400 {
			t.Errorf("%s: %d", name, code)
		}
	}

	// Viewers cannot import or preview; non-members get 404.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if code, _, _ := h.do(h.bob, "POST", base+"/people/import", map[string]any{"csv": peopleCSV}); code != 404 {
		t.Errorf("non-member import: %d", code)
	}
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"/people/import", "/people/import/preview"} {
		if code, _, _ := h.do(h.bob, "POST", base+p, map[string]any{"csv": peopleCSV}); code != 403 {
			t.Errorf("viewer %s: %d", p, code)
		}
	}
	if code, _, _ := h.do(h.bob, "GET", base+"/people", nil); code != 200 {
		t.Errorf("viewer list: %d", code)
	}
}

func TestRequestsAreWeightedByDistinctAccountValueAndSortable(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Impact")
	base := "/v1/workspaces/" + ws
	if code, _, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV}); code != 200 {
		t.Fatal("import")
	}
	dana, raj, sam := h.personID(h.alice, ws, "dana@acme.com"), h.personID(h.alice, ws, "raj@acme.com"), h.personID(h.alice, ws, "sam@globex.io")

	accept := func(sourceID string, target string) map[string]any {
		pid := h.proposalFor(h.alice, ws, sourceID)
		body := map[string]any{}
		if target != "" {
			body["targetRequestId"] = target
		}
		code, res, _ := h.do(h.alice, "POST", base+"/proposals/"+pid+"/accept", body)
		if code != 200 {
			t.Fatalf("accept: %d %v", code, res)
		}
		return res
	}
	impact := func(reqID string) map[string]any {
		_, r, _ := h.do(h.alice, "GET", base+"/requests/"+reqID, nil)
		return r["impact"].(map[string]any)
	}

	// Dana (Acme) asks for SSO.
	danaSrc := h.pasteAs(h.alice, ws, dana, "Dana: We really need SSO for our team.\n\n"+uuid.NewString())
	first := accept(danaSrc, "")
	reqSSO := first["requestId"].(string)
	im := impact(reqSSO)
	if im["peopleCount"].(float64) != 1 || im["accountCount"].(float64) != 1 || im["totalValue"] != "100000.00" {
		t.Fatalf("after one asker: %v", im)
	}

	// Raj, at the SAME account, asks too: two people, still one account, still 100,000 (not 200,000).
	rajSrc := h.pasteAs(h.alice, ws, raj, "Raj: We really need SSO for our team.\n\n"+uuid.NewString())
	accept(rajSrc, reqSSO)
	im = impact(reqSSO)
	if im["peopleCount"].(float64) != 2 || im["accountCount"].(float64) != 1 || im["totalValue"] != "100000.00" || im["evidenceCount"].(float64) != 2 {
		t.Fatalf("after second asker at the same account: %v", im)
	}

	// Sam (Globex) asks for something else: a second, smaller request.
	samSrc := h.pasteAs(h.alice, ws, sam, "Sam: our exports keep dropping rows today.\n\n"+uuid.NewString())
	reqExport := accept(samSrc, "")["requestId"].(string)
	if im := impact(reqExport); im["totalValue"] != "5000.00" || im["peopleCount"].(float64) != 1 {
		t.Fatalf("%v", im)
	}

	// Sorted by value: the Acme request first; the cursor continues to the next one with no repeats.
	code, page1, _ := h.do(h.alice, "GET", base+"/requests?sort=value&limit=1", nil)
	r1 := page1["requests"].([]any)
	if code != 200 || len(r1) != 1 || r1[0].(map[string]any)["id"] != reqSSO || page1["nextCursor"] == nil {
		t.Fatalf("page 1: %d %v", code, page1)
	}
	_, page2, _ := h.do(h.alice, "GET", base+"/requests?sort=value&limit=1&cursor="+page1["nextCursor"].(string), nil)
	r2 := page2["requests"].([]any)
	if len(r2) != 1 || r2[0].(map[string]any)["id"] != reqExport || page2["nextCursor"] != nil {
		t.Fatalf("page 2: %v", page2)
	}
	if code, _, _ := h.do(h.alice, "GET", base+"/requests?sort=value&cursor=not-a-cursor", nil); code != 400 {
		t.Errorf("bad value cursor: %d", code)
	}

	// Changing an account's value flows through to every request it is behind.
	_, acc, _ := h.do(h.alice, "GET", base+"/accounts", nil)
	acme := acc["accounts"].([]any)[0].(map[string]any)
	if code, e, _ := h.do(h.alice, "PUT", base+"/accounts/"+acme["id"].(string), map[string]any{"name": "Acme Inc", "revenue": "250000", "plan": "Enterprise"}); code != 204 {
		t.Fatalf("update account: %d %v", code, e)
	}
	if im := impact(reqSSO); im["totalValue"] != "250000.00" {
		t.Fatalf("value did not follow the account: %v", im)
	}
	// Moving Raj to Globex changes both accounts' share of the request.
	if code, e, _ := h.do(h.alice, "PUT", base+"/people/"+raj, map[string]any{"name": "Raj Patel", "email": "raj@acme.com", "accountId": acc["accounts"].([]any)[1].(map[string]any)["id"]}); code != 204 {
		t.Fatalf("move person: %d %v", code, e)
	}
	if im := impact(reqSSO); im["accountCount"].(float64) != 2 || im["totalValue"] != "255000.00" {
		t.Fatalf("after moving a person: %v", im)
	}
}

func TestAttributingFeedbackToAPersonFromAnotherWorkspaceIsRefused(t *testing.T) {
	h := newHarness(t)
	mine, theirs := h.workspace(h.alice, "Mine"), h.workspace(h.bob, "Theirs")
	h.do(h.bob, "POST", "/v1/workspaces/"+theirs+"/people", map[string]any{"name": "Their Person", "email": "tp@x.io"})
	foreign := h.personID(h.bob, theirs, "tp@x.io")
	code, body, _ := h.do(h.alice, "POST", "/v1/workspaces/"+mine+"/sources/paste", map[string]any{"text": "hello " + uuid.NewString(), "personId": foreign})
	if code != 400 || !strings.Contains(body["error"].(map[string]any)["message"].(string), "person") {
		t.Fatalf("%d %v", code, body)
	}
	// Alice cannot read Bob's people either.
	if code, _, _ := h.do(h.alice, "GET", "/v1/workspaces/"+theirs+"/people", nil); code != 404 {
		t.Fatalf("%d", code)
	}
}

func TestPeopleAndAccountsListPaginateAtoZWithoutRepeats(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Paging")
	base := "/v1/workspaces/" + ws
	var csv strings.Builder
	csv.WriteString("Name,Email,Company\n")
	for _, n := range []string{"delta", "Alpha", "charlie", "Bravo", "echo", "Foxtrot", "golf"} {
		csv.WriteString(n + "," + n + "@x.io," + strings.ToUpper(n) + " Co\n")
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": csv.String()}); code != 200 {
		t.Fatal("import")
	}
	for _, kind := range []string{"people", "accounts"} {
		var names []string
		cursor := ""
		for i := 0; i < 10; i++ {
			path := base + "/" + kind + "?limit=3"
			if cursor != "" {
				path += "&cursor=" + cursor
			}
			code, body, _ := h.do(h.alice, "GET", path, nil)
			if code != 200 {
				t.Fatalf("%s: %d %v", kind, code, body)
			}
			for _, it := range body[kind].([]any) {
				names = append(names, strings.ToLower(it.(map[string]any)["name"].(string)))
			}
			next, ok := body["nextCursor"].(string)
			if !ok {
				break
			}
			cursor = next
		}
		if len(names) != 7 {
			t.Fatalf("%s: got %d names %v", kind, len(names), names)
		}
		for i := 1; i < len(names); i++ {
			if names[i-1] >= names[i] {
				t.Fatalf("%s not in order or repeated: %v", kind, names)
			}
		}
	}

	for q, want := range map[string]int{"charlie": 1, "CHARLIE@X.IO": 1, "x.io": 7, "nobody": 0} {
		code, body, _ := h.do(h.alice, "GET", base+"/people?q="+url.QueryEscape(q), nil)
		if code != 200 || len(body["people"].([]any)) != want {
			t.Fatalf("people q=%q: %d %v", q, code, body)
		}
	}
}

func TestMergingTwoCompaniesOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Company merge")
	base := "/v1/workspaces/" + ws
	csv := "Name,Email,Company,ARR\nAda,ada@x.test,Acme Inc,\"$100,000\"\nGrace,grace@x.test,Acme,\n"
	if code, _, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": csv}); code != 200 {
		t.Fatal("import")
	}
	_, list, _ := h.do(h.alice, "GET", base+"/accounts", nil)
	if list["total"] != float64(2) {
		t.Fatalf("total = %v, want 2", list["total"])
	}
	ids := map[string]string{}
	for _, it := range list["accounts"].([]any) {
		a := it.(map[string]any)
		ids[a["name"].(string)] = a["id"].(string)
	}
	inc, acme := ids["Acme Inc"], ids["Acme"]

	bobID := uuid.MustParse(h.bob[2:])
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/accounts/merge", map[string]any{"sourceId": inc, "targetId": acme}); code != 403 {
		t.Errorf("viewer merge: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/accounts/merge", map[string]any{"sourceId": inc, "targetId": acme}); code != 204 {
		t.Fatalf("merge: %d", code)
	}
	_, after, _ := h.do(h.alice, "GET", base+"/accounts", nil)
	if after["total"] != float64(1) {
		t.Fatalf("after total = %v, want 1", after["total"])
	}
	one := after["accounts"].([]any)[0].(map[string]any)
	if one["name"] != "Acme" || one["revenue"] != "100000.00" || one["peopleCount"] != float64(2) {
		t.Fatalf("survivor = %v; want Acme with the revenue and both people", one)
	}
	if code, people, _ := h.do(h.alice, "GET", base+"/people?accountId="+acme, nil); code != 200 || people["total"] != float64(2) {
		t.Fatalf("people at survivor: %d %v", code, people)
	}
}

func TestMergingTwoPeopleOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Merge")
	base := "/v1/workspaces/" + ws
	csv := "Name,Email,Company\nAda Lovelace,ada@engines.test,Engines\nGrace Hopper,,\n"
	if code, _, _ := h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": csv}); code != 200 {
		t.Fatal("import")
	}
	_, list, _ := h.do(h.alice, "GET", base+"/people", nil)
	if list["total"] != float64(2) {
		t.Fatalf("total = %v, want 2", list["total"])
	}
	stats, _ := list["stats"].(map[string]any)
	if stats["total"] != float64(2) || stats["withEmail"] != float64(1) || stats["withoutEmail"] != float64(1) {
		t.Fatalf("stats = %v", stats)
	}
	ids := map[string]string{}
	for _, it := range list["people"].([]any) {
		p := it.(map[string]any)
		ids[p["name"].(string)] = p["id"].(string)
	}
	ada, grace := ids["Ada Lovelace"], ids["Grace Hopper"]

	bobID := uuid.MustParse(h.bob[2:])
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/people/merge", map[string]any{"sourceId": ada, "targetId": grace}); code != 403 {
		t.Errorf("viewer merge: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/people/merge", map[string]any{"sourceId": ada, "targetId": ada}); code != 400 {
		t.Errorf("self merge: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/people/merge", map[string]any{"sourceId": ada, "targetId": uuid.NewString()}); code != 404 {
		t.Errorf("missing target: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/people/merge", map[string]any{"sourceId": ada, "targetId": grace}); code != 204 {
		t.Fatalf("merge: %d", code)
	}
	_, after, _ := h.do(h.alice, "GET", base+"/people", nil)
	if after["total"] != float64(1) {
		t.Fatalf("after total = %v, want 1", after["total"])
	}
	person := after["people"].([]any)[0].(map[string]any)
	if person["name"] != "Grace Hopper" || person["email"] != "ada@engines.test" || person["accountName"] != "Engines" {
		t.Fatalf("survivor = %v; want Grace with Ada's email and company", person)
	}
	// Filtering still works after the merge.
	if code, body, _ := h.do(h.alice, "GET", base+"/people?email=without", nil); code != 200 || body["total"] != float64(0) {
		t.Fatalf("without email after merge: %d %v", code, body)
	}
}
