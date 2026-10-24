package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// seedQuote adds one evidence row (with its source, chunk and request) to a workspace.
func (hn *harness) seedQuote(ws, title, quote string) (evidence uuid.UUID) {
	hn.t.Helper()
	var src, chunk, req uuid.UUID
	c := context.Background()
	if err := hn.db.Super.QueryRow(c, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4,$5) RETURNING id`, ws, title, quote, uuid.NewString(), hn.aliceID).Scan(&src); err != nil {
		hn.t.Fatal(err)
	}
	hn.db.Super.QueryRow(c, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(quote), quote).Scan(&chunk)
	hn.db.Super.QueryRow(c, `INSERT INTO request (workspace_id, title) VALUES ($1,'A request') RETURNING id`, ws).Scan(&req)
	if err := hn.db.Super.QueryRow(c, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,0,$6,$7) RETURNING id`, ws, req, src, chunk, quote, len(quote), hn.aliceID).Scan(&evidence); err != nil {
		hn.t.Fatal(err)
	}
	return
}

func TestFindingsAndQuotesOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Research Co")
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	h.exec(`INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID)
	ev := h.seedQuote(ws, "Interview with Dana", "We really need single sign-on today")
	base := "/v1/workspaces/" + ws

	// a document with a paragraph and a card
	c, body, _ := h.do(h.bob, "POST", base+"/findings", map[string]any{"title": "Sign-in findings"})
	if c != 201 {
		t.Fatalf("create: %d %v", c, body)
	}
	doc := base + "/findings/" + body["id"].(string)
	blocks := map[string]any{"blocks": []map[string]any{
		{"kind": "text", "body": "People keep asking for single sign-on."},
		{"kind": "quote", "quoteKind": "evidence", "quoteId": ev.String(), "body": "Said unprompted."},
	}}
	if c, b, _ := h.do(h.bob, "PUT", doc+"/blocks", blocks); c != 204 {
		t.Fatalf("blocks: %d %v", c, b)
	}
	if c, _, _ := h.do(h.bob, "PUT", doc+"/blocks", map[string]any{"blocks": []map[string]any{{"kind": "quote", "quoteKind": "evidence", "quoteId": uuid.NewString()}}}); c != 400 {
		t.Errorf("a card for a quote that does not exist: %d", c)
	}
	_, got, _ := h.do(h.bob, "GET", doc, nil)
	cards := got["blocks"].([]any)
	if len(cards) != 2 || cards[1].(map[string]any)["quote"] != "We really need single sign-on today" || cards[1].(map[string]any)["removed"] != false {
		t.Fatalf("document %v", got)
	}
	if c, _, _ := h.do(h.bob, "POST", doc+"/publish", map[string]any{"confirmed": true}); c != 403 {
		t.Errorf("a member published: %d", c)
	}
	if c, b, _ := h.do(h.alice, "POST", doc+"/publish", map[string]any{"confirmed": false}); c != 400 {
		t.Errorf("published without confirming: %d %v", c, b)
	}
	c, pub, _ := h.do(h.alice, "POST", doc+"/publish", map[string]any{"confirmed": true})
	if c != 200 {
		t.Fatalf("publish: %d %v", c, pub)
	}
	token := strings.TrimPrefix(pub["link"].(string), "https://app.example/f/")
	if c, b, _ := h.do(h.bob, "PUT", doc+"/blocks", blocks); c != 409 {
		t.Errorf("edited while published: %d %v", c, b)
	}
	// the public page: no sign-in, words only
	c, page, _ := h.do("", "GET", "/v1/public/findings/"+token, nil)
	if c != 200 || page["title"] != "Sign-in findings" || len(page["blocks"].([]any)) != 2 {
		t.Fatalf("public: %d %v", c, page)
	}
	for _, leak := range []string{"Interview", "Dana", "Research Co", ws, ev.String()} {
		if strings.Contains(strings.ToLower(toJSON(page)), strings.ToLower(leak)) {
			t.Errorf("the public page leaks %q", leak)
		}
	}
	if c, _, _ := h.do("", "GET", "/v1/public/findings/f.not-a-real-link-at-all-12345", nil); c != 404 {
		t.Errorf("a made-up link: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", doc+"/unpublish", nil); c != 204 {
		t.Fatalf("unpublish: %d", c)
	}
	if c, _, _ := h.do("", "GET", "/v1/public/findings/"+token, nil); c != 404 {
		t.Errorf("the link works after take-down: %d", c)
	}
	if c, _, _ := h.do(h.bob, "GET", "/v1/workspaces/"+ws+"/findings", nil); c != 200 {
		t.Errorf("list: %d", c)
	}
	if c, _, _ := h.do("t:"+uuid.NewString(), "GET", doc, nil); c != 404 {
		t.Errorf("a stranger read a document: %d", c)
	}

	// quotes: the table, a person's label, and the model run
	_, qs, _ := h.do(h.bob, "GET", base+"/quotes?q=single", nil)
	rows := qs["quotes"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["sourceTitle"] != "Interview with Dana" {
		t.Fatalf("quotes %v", qs)
	}
	if c, _, _ := h.do(h.bob, "PUT", base+"/quotes/evidence/"+ev.String()+"/sentiment", map[string]any{"label": "positive"}); c != 204 {
		t.Fatalf("label: %d", c)
	}
	_, qs, _ = h.do(h.bob, "GET", base+"/quotes?sentiment=positive", nil)
	if r := qs["quotes"].([]any); len(r) != 1 || r[0].(map[string]any)["sentimentSource"] != "human" {
		t.Errorf("filter by feeling %v", qs)
	}
	if c, _, _ := h.do(h.bob, "GET", base+"/quotes?sentiment=angry", nil); c != 400 {
		t.Errorf("an unknown feeling: %d", c)
	}
	if c, _, _ := h.do(h.bob, "PUT", base+"/quotes/evidence/"+uuid.NewString()+"/sentiment", map[string]any{"label": "positive"}); c != 404 {
		t.Errorf("labelling a quote that is not there: %d", c)
	}
	_, st, _ := h.do(h.bob, "GET", base+"/sentiment", nil)
	if st["humanLabelled"].(float64) != 1 || st["enough"] != false || st["target"].(float64) != 0.8 {
		t.Errorf("status %v", st)
	}
	h.seedQuote(ws, "Another", "Exports keep dropping rows")
	if c, b, _ := h.do(h.bob, "POST", base+"/sentiment/classify", nil); c != 202 || b["pending"].(float64) != 2 { // both quotes wait for the model, including the one a person labelled
		t.Errorf("classify: %d %v", c, b)
	}
	_, sm, _ := h.do(h.bob, "GET", base+"/sentiment/sample?seed=a&limit=5", nil)
	if len(sm["quotes"].([]any)) != 1 || sm["labelled"].(float64) != 1 {
		t.Errorf("sample %v", sm)
	}
	if c, _, _ := h.do(h.bob, "GET", base+"/trends?weeks=8", nil); c != 200 {
		t.Errorf("trends: %d", c)
	}
	if c, _, _ := h.do(h.bob, "GET", base+"/trends?weeks=999", nil); c != 400 {
		t.Errorf("weeks out of range: %d", c)
	}
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
