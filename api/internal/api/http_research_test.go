package api

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestCodebookHighlightsAndQuestionsOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Research")
	base := "/v1/workspaces/" + ws
	text := "Dana: We really need SSO for our team, it is blocking us.\n\n" + uuid.NewString()
	src := h.pasteAs(h.alice, ws, "", text)
	quote := "We really need SSO for our team"
	start := strings.Index(text, quote)

	// --- codebook
	code, tag, _ := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "Security", "definition": "Access control", "color": "red"})
	if code != 201 {
		t.Fatalf("create tag: %d %v", code, tag)
	}
	tagID := tag["id"].(string)
	if code, e, _ := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "security"}); code != 409 {
		t.Fatalf("duplicate: %d %v", code, e)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "x", "color": "mauve"}); code != 400 {
		t.Fatalf("bad colour: %d", code) // the contract rejects it before our code runs
	}
	_, other, _ := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "SSO"})

	// --- highlight, byte offsets verified against the source
	code, hl, _ := h.do(h.alice, "POST", base+"/highlights", map[string]any{"sourceItemId": src, "spanStart": start, "spanEnd": start + len(quote), "quote": quote, "tagIds": []string{tagID}})
	if code != 201 || hl["quote"] != quote || len(hl["tags"].([]any)) != 1 {
		t.Fatalf("highlight: %d %v", code, hl)
	}
	hid := hl["id"].(string)
	if code, e, _ := h.do(h.alice, "POST", base+"/highlights", map[string]any{"sourceItemId": src, "spanStart": start, "spanEnd": start + len(quote), "quote": quote + "!"}); code != 400 {
		t.Fatalf("misquote: %d %v", code, e)
	}
	_, list, _ := h.do(h.alice, "GET", base+"/highlights?tagId="+tagID, nil)
	if len(list["highlights"].([]any)) != 1 {
		t.Fatalf("%v", list)
	}
	_, list, _ = h.do(h.alice, "GET", base+"/highlights?tagId="+other["id"].(string), nil)
	if len(list["highlights"].([]any)) != 0 {
		t.Fatalf("%v", list)
	}
	if code, _, _ := h.do(h.alice, "GET", base+"/highlights?cursor=%25%25", nil); code != 400 {
		t.Fatalf("bad cursor: %d", code)
	}

	// --- request tags show on the request
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	req := h.requestFrom(h.alice, ws, "dana@acme.com")
	_ = req
	_, rl, _ := h.do(h.alice, "GET", base+"/requests", nil)
	rid := rl["requests"].([]any)[0].(map[string]any)["id"].(string)
	if code, e, _ := h.do(h.alice, "PUT", base+"/requests/"+rid+"/tags", map[string]any{"tagIds": []string{tagID}}); code != 204 {
		t.Fatalf("request tags: %d %v", code, e)
	}
	_, detail, _ := h.do(h.alice, "GET", base+"/requests/"+rid, nil)
	if tg := detail["tags"].([]any); len(tg) != 1 || tg[0].(map[string]any)["name"] != "Security" {
		t.Fatalf("%v", detail["tags"])
	}
	// the list carries each request's tags too (in both orders), so a table can show and edit them in place
	for _, order := range []string{"", "?sort=value"} {
		_, listed, _ := h.do(h.alice, "GET", base+"/requests"+order, nil)
		row := listed["requests"].([]any)[0].(map[string]any)
		if tg, ok := row["tags"].([]any); !ok || len(tg) != 1 || tg[0].(map[string]any)["name"] != "Security" {
			t.Fatalf("list tags (%q): %v", order, row["tags"])
		}
	}
	// someone else's workspace never sees them
	if code, _, _ := h.do(h.bob, "GET", base+"/requests", nil); code != 404 {
		t.Fatalf("other workspace: %d", code)
	}

	// --- merge, then undo
	code, m, _ := h.do(h.alice, "POST", base+"/tags/"+tagID+"/merge", map[string]any{"intoTagId": other["id"]})
	if code != 200 || m["highlights"].(float64) != 1 || m["requests"].(float64) != 1 {
		t.Fatalf("merge: %d %v", code, m)
	}
	_, tl, _ := h.do(h.alice, "GET", base+"/tags?includeArchived=true", nil)
	var undo string
	for _, x := range tl["tags"].([]any) {
		if x.(map[string]any)["id"] == tagID && x.(map[string]any)["undoMergeId"] != nil {
			undo = x.(map[string]any)["undoMergeId"].(string)
		}
	}
	if undo == "" || undo != m["mergeId"] {
		t.Fatalf("no undo offered: %v", tl)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/tag-merges/"+undo+"/undo", nil); code != 204 {
		t.Fatalf("undo: %d", code)
	}
	_, list, _ = h.do(h.alice, "GET", base+"/highlights?tagId="+tagID, nil)
	if len(list["highlights"].([]any)) != 1 {
		t.Fatalf("not restored: %v", list)
	}

	// --- questions
	code, ans, _ := h.do(h.alice, "POST", base+"/qa", map[string]any{"question": "Why do customers want SSO?"})
	if code != 200 || ans["outcome"] != "answered" || len(ans["citations"].([]any)) != 1 {
		t.Fatalf("ask: %d %v", code, ans)
	}
	if c := ans["citations"].([]any)[0].(map[string]any); !strings.Contains(c["quote"].(string), "SSO") {
		t.Fatalf("%v", c)
	}
	code, none, _ := h.do(h.alice, "POST", base+"/qa", map[string]any{"question": "What about the zebra pricing?"})
	if code != 200 || none["outcome"] != "no_evidence" || none["text"] != "" || none["reason"] == "" {
		t.Fatalf("refusal: %d %v", code, none)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/qa", map[string]any{"question": ""}); code != 400 {
		t.Fatalf("empty question: %d", code)
	}
	aid := ans["id"].(string)
	if code, _, _ := h.do(h.alice, "PUT", base+"/qa/"+aid+"/rating", map[string]any{"rating": "good"}); code != 204 {
		t.Fatalf("rate: %d", code)
	}
	if _, got, _ := h.do(h.alice, "GET", base+"/qa/"+aid, nil); got["rating"] != "good" {
		t.Fatalf("%v", got)
	}
	if _, hist, _ := h.do(h.alice, "GET", base+"/qa", nil); len(hist["answers"].([]any)) != 2 {
		t.Fatalf("%v", hist)
	}

	// --- people without access
	if code, _, _ := h.do(h.bob, "GET", base+"/tags", nil); code != 404 {
		t.Fatalf("stranger tags: %d", code)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/qa", map[string]any{"question": "SSO"}); code != 404 {
		t.Fatalf("stranger question: %d", code)
	}
	if code, _, _ := h.do("", "GET", base+"/tags", nil); code != 401 {
		t.Fatalf("anonymous: %d", code)
	}
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "GET", base+"/tags", nil); code != 200 {
		t.Fatalf("viewer read: %d", code)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/qa", map[string]any{"question": "SSO"}); code != 200 {
		t.Fatalf("viewer asks: %d", code)
	}
	for name, call := range map[string]func() int{
		"create tag": func() int { c, _, _ := h.do(h.bob, "POST", base+"/tags", map[string]any{"name": "v"}); return c },
		"highlight": func() int {
			c, _, _ := h.do(h.bob, "POST", base+"/highlights", map[string]any{"sourceItemId": src, "spanStart": start, "spanEnd": start + len(quote), "quote": quote})
			return c
		},
		"delete": func() int { c, _, _ := h.do(h.bob, "DELETE", base+"/highlights/"+hid, nil); return c },
		"merge": func() int {
			c, _, _ := h.do(h.bob, "POST", base+"/tags/"+tagID+"/merge", map[string]any{"intoTagId": other["id"]})
			return c
		},
		"archive": func() int { c, _, _ := h.do(h.bob, "POST", base+"/tags/"+tagID+"/archive", nil); return c },
		"request tag": func() int {
			c, _, _ := h.do(h.bob, "PUT", base+"/requests/"+rid+"/tags", map[string]any{"tagIds": []string{}})
			return c
		},
	} {
		if code := call(); code != 403 {
			t.Errorf("viewer %s: %d, want 403", name, code)
		}
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/highlights/"+hid, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
}
