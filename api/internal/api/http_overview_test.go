package api

import "testing"

func TestOverviewCountsWhatTheWorkspaceHas(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Home")
	base := "/v1/workspaces/" + ws

	if c, body, _ := h.do(h.alice, "GET", base+"/overview?days=7", nil); c != 200 {
		t.Fatalf("overview: %d %v", c, body)
	} else {
		if body["days"].(float64) != 7 || len(body["series"].([]any)) != 7 {
			t.Fatalf("series: %v", body["series"])
		}
	}
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	h.requestFrom(h.alice, ws, "dana@acme.com")

	c, body, _ := h.do(h.alice, "GET", base+"/overview", nil)
	if c != 200 {
		t.Fatalf("overview after data: %d %v", c, body)
	}
	counts := body["counts"].(map[string]any)
	if counts["openRequests"].(float64) != 1 || counts["quotes"].(float64) < 1 ||
		counts["people"].(float64) < 1 || counts["requestsLast7d"].(float64) != 1 {
		t.Fatalf("counts: %v", counts)
	}
	if counts["suggestionsWaiting"].(float64) != 0 || counts["messagesWaiting"].(float64) != 0 {
		t.Fatalf("waiting counts: %v", counts)
	}
	series := body["series"].([]any)
	var requests, quotes float64
	for _, point := range series {
		requests += point.(map[string]any)["requests"].(float64)
		quotes += point.(map[string]any)["quotes"].(float64)
	}
	if requests != 1 || quotes < 1 {
		t.Fatalf("series totals: requests=%v quotes=%v", requests, quotes)
	}
	activity := body["activity"].([]any)
	if len(activity) == 0 {
		t.Fatal("no activity returned")
	}
	kinds := map[string]bool{}
	for _, a := range activity {
		kinds[a.(map[string]any)["kind"].(string)] = true
	}
	if !kinds["request"] || !kinds["quote"] {
		t.Fatalf("activity kinds: %v", kinds)
	}

	c, page, _ := h.do(h.alice, "GET", base+"/activity?limit=1", nil)
	if c != 200 || len(page["items"].([]any)) != 1 || page["nextCursor"] == nil {
		t.Fatalf("activity page: %d %v", c, page)
	}
	firstIDs := map[string]bool{}
	for _, item := range page["items"].([]any) {
		firstIDs[item.(map[string]any)["id"].(string)] = true
	}
	c, more, _ := h.do(h.alice, "GET", base+"/activity?limit=1&cursor="+page["nextCursor"].(string), nil)
	if c != 200 || len(more["items"].([]any)) == 0 {
		t.Fatalf("second activity page: %d %v", c, more)
	}
	for _, item := range more["items"].([]any) {
		if firstIDs[item.(map[string]any)["id"].(string)] {
			t.Fatalf("activity page repeated an item: %v", item)
		}
	}
	_, requestsOnly, _ := h.do(h.alice, "GET", base+"/activity?kind=request&limit=50", nil)
	for _, item := range requestsOnly["items"].([]any) {
		if item.(map[string]any)["kind"] != "request" {
			t.Fatalf("kind filter: %v", item)
		}
	}
}
