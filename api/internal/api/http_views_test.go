package api

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// titles lists the request titles a list call returns, in order.
func (hn *harness) titles(token, path string) ([]string, string) {
	hn.t.Helper()
	code, body, _ := hn.do(token, "GET", path, nil)
	if code != 200 {
		hn.t.Fatalf("%s: %d %v", path, code, body)
	}
	var out []string
	for _, r := range body["requests"].([]any) {
		out = append(out, r.(map[string]any)["title"].(string))
	}
	next, _ := body["nextCursor"].(string)
	return out, next
}

func TestFiltersAndSavedViewsOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Views")
	base := "/v1/workspaces/" + ws
	wsID := uuid.MustParse(ws)

	// Twelve requests with awkward titles, some with a tag, some in another status.
	names := []string{"Single sign-on", "SSO for contractors", "100% uptime report", "Export_to_CSV", "Dark mode", "Slack alerts",
		"Slack digest", "Mobile layout", "Audit log", "API webhooks", "Read only role", "Bulk import"}
	ids := map[string]uuid.UUID{}
	for i, n := range names {
		var id uuid.UUID
		if err := h.db.Super.QueryRow(context.Background(), `INSERT INTO request (workspace_id, title, created_at) VALUES ($1,$2, now() - ($3 || ' minutes')::interval) RETURNING id`, wsID, n, fmt.Sprint(i)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids[n] = id
	}
	_, code0, _ := h.do(h.alice, "GET", base+"/statuses", nil)
	var planned, shipped string
	for _, s := range code0["statuses"].([]any) {
		m := s.(map[string]any)
		switch m["name"] {
		case "Planned":
			planned = m["id"].(string)
		case "Shipped":
			shipped = m["id"].(string)
		}
	}
	for _, n := range []string{"Slack alerts", "Slack digest", "Dark mode"} {
		if _, err := h.db.Super.Exec(context.Background(), `UPDATE request SET status_id=$2 WHERE id=$1`, ids[n], planned); err != nil {
			t.Fatal(err)
		}
	}
	_, tag, _ := h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "Security"})
	tagID := tag["id"].(string)
	for _, n := range []string{"Single sign-on", "SSO for contractors", "Audit log"} {
		if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO request_tag (workspace_id, request_id, tag_id) VALUES ($1,$2,$3)`, wsID, ids[n], tagID); err != nil {
			t.Fatal(err)
		}
	}

	// Each filter, and combinations.
	for name, c := range map[string]struct {
		query string
		want  []string
	}{
		"status":         {"?statusId=" + planned, []string{"Dark mode", "Slack alerts", "Slack digest"}},
		"tag":            {"?tagId=" + tagID, []string{"Single sign-on", "SSO for contractors", "Audit log"}},
		"text":           {"?q=slack", []string{"Slack alerts", "Slack digest"}},
		"text spaces":    {"?q=" + url.QueryEscape("  SLACK   alerts "), []string{"Slack alerts"}},
		"tag and text":   {"?tagId=" + tagID + "&q=sso", []string{"SSO for contractors"}},
		"status and tag": {"?statusId=" + planned + "&tagId=" + tagID, nil},
		"nothing":        {"?q=zebra", nil},
		"no shipped yet": {"?statusId=" + shipped, nil},
		// wildcard characters are plain text
		"percent sign":  {"?q=" + url.QueryEscape("100%"), []string{"100% uptime report"}},
		"percent alone": {"?q=" + url.QueryEscape("%"), []string{"100% uptime report"}},
		"underscore":    {"?q=" + url.QueryEscape("_"), []string{"Export_to_CSV"}},
		"backslash":     {"?q=" + url.QueryEscape(`\`), nil},
		"sql-ish":       {"?q=" + url.QueryEscape(`'; drop table request; --`), nil},
	} {
		got, _ := h.titles(h.alice, base+"/requests"+c.query)
		if strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Errorf("%s: got %v, want %v", name, got, c.want)
		}
	}
	if n, _ := h.titles(h.alice, base+"/requests"); len(n) != len(names) {
		t.Fatalf("unfiltered list lost requests: %d", len(n))
	}

	// Paging through a filtered list neither skips nor repeats, in both orders.
	for _, sort := range []string{"newest", "value"} {
		var all []string
		cursor := ""
		for page := 0; page < 20; page++ {
			q := "?limit=1&sort=" + sort + "&q=" + url.QueryEscape("s")
			if cursor != "" {
				q += "&cursor=" + url.QueryEscape(cursor)
			}
			got, next := h.titles(h.alice, base+"/requests"+q)
			all = append(all, got...)
			if next == "" {
				break
			}
			cursor = next
		}
		want := 0
		for _, n := range names {
			if strings.Contains(strings.ToLower(n), "s") {
				want++
			}
		}
		seen := map[string]bool{}
		for _, n := range all {
			if seen[n] {
				t.Errorf("%s: %q repeated", sort, n)
			}
			seen[n] = true
		}
		if len(all) != want {
			t.Errorf("%s: paged through %d, want %d", sort, len(all), want)
		}
	}

	// Bad filter values are refused by the contract before any query runs.
	for _, bad := range []string{"?statusId=nope", "?tagId=1", "?q=" + strings.Repeat("a", 101)} {
		if code, _, _ := h.do(h.alice, "GET", base+"/requests"+bad, nil); code != 400 {
			t.Errorf("%s: %d", bad, code)
		}
	}
	// A status or tag from another workspace matches nothing (and reveals nothing).
	other := h.workspace(h.bob, "Elsewhere")
	_, otherTag, _ := h.do(h.bob, "POST", "/v1/workspaces/"+other+"/tags", map[string]any{"name": "Theirs"})
	if got, _ := h.titles(h.alice, base+"/requests?tagId="+otherTag["id"].(string)); len(got) != 0 {
		t.Errorf("foreign tag matched: %v", got)
	}

	// --- saved views
	code, v, _ := h.do(h.alice, "POST", base+"/views", map[string]any{"name": "  Security asks ", "tagId": tagID, "sort": "value"})
	if code != 201 || v["name"] != "Security asks" || v["tagId"] != tagID || v["sort"] != "value" || v["mine"] != true {
		t.Fatalf("create: %d %v", code, v)
	}
	if code, e, _ := h.do(h.alice, "POST", base+"/views", map[string]any{"name": "security ASKS", "tagId": tagID}); code != 409 {
		t.Fatalf("duplicate name: %d %v", code, e)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/views", map[string]any{"name": "Plain list"}); code != 400 {
		t.Fatalf("a view with no filter and the default order: %d", code)
	}
	for name, body := range map[string]map[string]any{
		"foreign status": {"name": "x", "statusId": uuid.NewString()},
		"foreign tag":    {"name": "x", "tagId": otherTag["id"]},
		"bad sort":       {"name": "x", "q": "a", "sort": "oldest"},
		"empty name":     {"name": "", "q": "a"},
		"extra field":    {"name": "x", "q": "a", "ownerId": uuid.NewString()},
	} {
		if code, e, _ := h.do(h.alice, "POST", base+"/views", body); code != 400 {
			t.Errorf("%s: %d %v", name, code, e)
		}
	}
	_, list, _ := h.do(h.alice, "GET", base+"/views", nil)
	if len(list["views"].([]any)) != 1 {
		t.Fatalf("%v", list)
	}
	// Another workspace sees none of them.
	if _, theirs, _ := h.do(h.bob, "GET", "/v1/workspaces/"+other+"/views", nil); len(theirs["views"].([]any)) != 0 {
		t.Fatalf("leak: %v", theirs)
	}
	if code, _, _ := h.do(h.bob, "GET", base+"/views", nil); code != 404 {
		t.Fatalf("stranger: %d", code)
	}
	// A viewer can see and use them but not add or delete.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "GET", base+"/views", nil); code != 200 {
		t.Fatalf("viewer list: %d", code)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/views", map[string]any{"name": "mine", "q": "a"}); code != 403 {
		t.Fatalf("viewer create: %d", code)
	}
	if code, _, _ := h.do(h.bob, "DELETE", base+"/views/"+v["id"].(string), nil); code != 403 {
		t.Fatalf("viewer delete: %d", code)
	}
	// A different editor cannot delete someone else's view; the creator can; unknown ids are 404.
	editor := uuid.New()
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, editor); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do("t:"+editor.String(), "DELETE", base+"/views/"+v["id"].(string), nil); code != 403 {
		t.Fatalf("other editor delete: %d", code)
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/views/"+uuid.NewString(), nil); code != 404 {
		t.Fatalf("unknown view: %d", code)
	}
	if code, _, _ := h.do(h.alice, "DELETE", base+"/views/"+v["id"].(string), nil); code != 204 {
		t.Fatalf("creator delete: %d", code)
	}
	// The limit.
	for i := 0; i < 50; i++ {
		if code, e, _ := h.do(h.alice, "POST", base+"/views", map[string]any{"name": fmt.Sprintf("v%d", i), "q": "a"}); code != 201 {
			t.Fatalf("view %d: %d %v", i, code, e)
		}
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/views", map[string]any{"name": "one too many", "q": "a"}); code != 409 {
		t.Fatalf("the 51st view: %d", code)
	}
}

func TestOnlyAdminsSeeNotices(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Notices")
	base := "/v1/workspaces/" + ws
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO notice (workspace_id, kind, message) VALUES ($1,'ai_budget','Your workspace has used its AI allowance for today ($5.00).')`, ws); err != nil {
		t.Fatal(err)
	}
	_, got, _ := h.do(h.alice, "GET", base+"/notices", nil)
	list := got["notices"].([]any)
	if len(list) != 1 || !strings.Contains(list[0].(map[string]any)["message"].(string), "AI allowance") {
		t.Fatalf("admin: %v", got)
	}
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	_, got, _ = h.do(h.bob, "GET", base+"/notices", nil)
	if len(got["notices"].([]any)) != 0 {
		t.Fatalf("a member saw an admin notice: %v", got)
	}
	// Old notices fall away.
	if _, err := h.db.Super.Exec(context.Background(), `UPDATE notice SET created_at = now() - interval '2 days' WHERE workspace_id=$1`, ws); err != nil {
		t.Fatal(err)
	}
	if _, got, _ = h.do(h.alice, "GET", base+"/notices", nil); len(got["notices"].([]any)) != 0 {
		t.Fatalf("an old notice is still shown: %v", got)
	}
}
