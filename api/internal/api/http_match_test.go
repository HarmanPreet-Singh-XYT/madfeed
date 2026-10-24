package api

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/embed"
	"product/api/internal/match"
	"product/api/internal/store"
)

// sameAxis is an embedder where texts about "sign-in" and "login" point the same way.
type sameAxis struct{}

func (sameAxis) Name() string  { return "fake" }
func (sameAxis) Model() string { return "fake-1" }
func (sameAxis) Dim() int      { return match.VectorDim }
func (sameAxis) Embed(_ context.Context, texts []string) ([][]float32, embed.Usage, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		v := make([]float32, match.VectorDim)
		low := strings.ToLower(t)
		if strings.Contains(low, "single sign-on") || strings.Contains(low, "login") {
			v[0] = 1
		} else {
			v[1] = 1
		}
		out[i] = v
	}
	return out, embed.Usage{Tokens: 5}, nil
}

func TestSearchByMeaningOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Research Co")
	other := h.workspace(h.bob, "Other Co")
	h.seedQuote(ws, "Call", "We really need single sign-on today")
	h.seedQuote(other, "Call", "single sign-on for everyone")
	url := "/v1/workspaces/" + ws + "/quotes/search?q=login+with+company+account"

	// no embedding service: said so plainly, not an error
	c, b, _ := h.do(h.alice, "GET", url, nil)
	if c != 200 || b["ready"] != false {
		t.Fatalf("off: %d %v", c, b)
	}

	h.srv.Match = &match.Service{Pool: h.db.Backend, Embed: sameAxis{}}
	// the first search says how many quotes are not searchable yet; indexing happens in the background
	c, b, _ = h.do(h.alice, "GET", url, nil)
	if c != 200 || b["ready"] != true || b["pending"].(float64) != 1 {
		t.Fatalf("first: %d %v", c, b)
	}
	if _, err := h.srv.Match.IndexQuotes(context.Background(), tenantOf(h, ws), 100); err != nil {
		t.Fatal(err)
	}
	c, b, _ = h.do(h.alice, "GET", url, nil)
	hits := b["hits"].([]any)
	if c != 200 || b["pending"].(float64) != 0 || len(hits) != 1 || !strings.Contains(hits[0].(map[string]any)["text"].(string), "single sign-on") {
		t.Fatalf("after indexing: %d %v", c, b)
	}
	// never someone else's workspace
	if c, _, _ := h.do(h.bob, "GET", url, nil); c != 403 && c != 404 {
		t.Errorf("another workspace's search: %d", c)
	}
	if c, _, _ := h.do("", "GET", url, nil); c != 401 {
		t.Errorf("anonymous: %d", c)
	}
	if c, _, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/quotes/search", nil); c != 400 {
		t.Errorf("no query: %d", c)
	}
}

func tenantOf(h *harness, ws string) store.Tenant {
	return store.Tenant{WorkspaceID: uuid.MustParse(ws), UserID: h.aliceID, Role: store.RoleAdmin}
}

func TestProposalsShowTheSuggestedRequest(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Research Co")
	quote := "We really need single sign-on today"
	h.seedQuote(ws, "Call", quote)
	var src, chunk, req string
	c := context.Background()
	h.db.Super.QueryRow(c, `SELECT source_item_id::text, chunk_id::text FROM evidence WHERE workspace_id=$1`, ws).Scan(&src, &chunk)
	h.db.Super.QueryRow(c, `SELECT id::text FROM request WHERE workspace_id=$1`, ws).Scan(&req)
	h.exec(`INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence, matched_at, suggested_request_id, match_score, match_confidence, match_rationale)
		VALUES ($1,$2,$3,'new_request','need','SSO',$4,0,$5,0.9,now(),$6,0.81,0.93,'Both want company sign-in.')`, ws, src, chunk, quote, len(quote), req)
	c2, b, _ := h.do(h.alice, "GET", "/v1/workspaces/"+ws+"/proposals", nil)
	ps := b["proposals"].([]any)
	if c2 != 200 || len(ps) != 1 {
		t.Fatalf("%d %v", c2, b)
	}
	sg := ps[0].(map[string]any)["suggestion"].(map[string]any)
	if sg["requestId"] != req || sg["requestTitle"] != "A request" || sg["reason"] != "Both want company sign-in." {
		t.Fatalf("suggestion %v", sg)
	}
}
