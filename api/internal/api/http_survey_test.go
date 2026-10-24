package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/survey"
)

var surveyLinkRe = regexp.MustCompile(`https://app\.example/s/(\S+)`)

func (hn *harness) surveyBase(ws string) string { return "/v1/workspaces/" + ws + "/surveys" }

func (hn *harness) exec(sql string, args ...any) {
	hn.t.Helper()
	if _, err := hn.db.Super.Exec(context.Background(), sql, args...); err != nil {
		hn.t.Fatal(err)
	}
}

// A survey goes from an empty draft to analysed answers using only the public API.
func TestASurveyGoesFromDraftToResultsOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Surveys Co")
	h.exec(`INSERT INTO person (workspace_id, name, email) VALUES ($1,'Dana','dana@acme.com'), ($1,'Lee','lee@acme.com'), ($1,'Pat','pat@other.io')`, ws)
	viewer := uuid.New()
	h.exec(`INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, viewer)
	vt := "t:" + viewer.String()
	base := h.surveyBase(ws)

	code, body, _ := h.do(h.alice, "POST", base, map[string]any{"title": "Check-in", "intro": "Quick one.", "thankYou": "Thanks!"})
	if code != 201 {
		t.Fatalf("create: %d %v", code, body)
	}
	id := body["id"].(string)
	sv := base + "/" + id

	// who may do what
	if c, _, _ := h.do(vt, "POST", base, map[string]any{"title": "x"}); c != 403 {
		t.Errorf("a viewer created a survey: %d", c)
	}
	if c, _, _ := h.do(h.bob, "GET", sv, nil); c != 404 {
		t.Errorf("a stranger read a survey: %d", c)
	}
	if c, _, _ := h.do(vt, "GET", sv, nil); c != 200 {
		t.Errorf("a viewer could not read: %d", c)
	}

	// questions
	qs := []map[string]any{
		{"kind": "nps", "prompt": "Would you recommend us?", "required": true},
		{"kind": "choice", "prompt": "What matters most?", "options": []string{"Speed", "Price"}},
		{"kind": "text", "prompt": "What is missing?"},
	}
	if c, b, _ := h.do(h.alice, "PUT", sv+"/questions", map[string]any{"questions": qs}); c != 204 {
		t.Fatalf("questions: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "PUT", sv+"/questions", map[string]any{"questions": []map[string]any{{"kind": "choice", "prompt": "x", "options": []string{"only"}}}}); c != 400 {
		t.Errorf("one choice: %d", c)
	}

	// the audience: refused shapes, then a good one
	for name, aud := range map[string]any{
		"unknown field":    map[string]any{"field": "salary", "op": "eq", "value": "x"},
		"wrong comparison": map[string]any{"field": "has_account", "op": "gte", "value": 1},
		"nothing":          map[string]any{},
		"two kinds":        map[string]any{"all": []any{}, "not": map[string]any{"all": []any{}}},
	} {
		if c, _, _ := h.do(h.alice, "PUT", sv+"/audience", map[string]any{"audience": aud}); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	if c, _, _ := h.do(h.alice, "POST", sv+"/invites", nil); c != 400 {
		t.Errorf("invites before an audience: %d", c)
	}
	acme := map[string]any{"field": "email_domain", "op": "eq", "value": "acme.com"}
	c, pre, _ := h.do(h.alice, "POST", sv+"/audience/preview", map[string]any{"audience": acme})
	if c != 200 || pre["total"].(float64) != 2 || len(pre["sample"].([]any)) != 2 {
		t.Fatalf("preview: %d %v", c, pre)
	}
	if c, _, _ := h.do(h.alice, "PUT", sv+"/audience", map[string]any{"audience": acme}); c != 204 {
		t.Fatalf("audience: %d", c)
	}
	_, got, _ := h.do(h.alice, "GET", sv, nil)
	if aud, _ := got["audience"].(map[string]any); aud["field"] != "email_domain" || aud["value"] != "acme.com" {
		t.Errorf("the saved audience reads back as %v", got["audience"])
	}

	// invitations are written down, not sent
	c, inv, _ := h.do(h.alice, "POST", sv+"/invites", nil)
	if c != 200 || inv["added"].(float64) != 2 {
		t.Fatalf("invites: %d %v", c, inv)
	}
	if c, _, _ := h.do(h.alice, "POST", sv+"/invites/approve", nil); c != 400 {
		t.Errorf("approving before opening: %d", c)
	}
	_, pv, _ := h.do(h.alice, "GET", sv+"/invites/preview", nil)
	if !strings.Contains(fmt.Sprint(pv["subject"]), "Surveys Co would like your feedback: Check-in") || !strings.Contains(fmt.Sprint(pv["text"]), "Quick one.") {
		t.Errorf("preview wording %v", pv)
	}
	if len(h.mail.all()) != 0 {
		t.Fatal("mail was sent before anything was approved")
	}
	if c, _, _ := h.do(h.alice, "POST", sv+"/open", nil); c != 204 {
		t.Fatalf("open: %d", c)
	}
	if c, _, _ := h.do(vt, "POST", sv+"/invites/approve", nil); c != 403 {
		t.Errorf("a viewer approved: %d", c)
	}
	c, ap, _ := h.do(h.alice, "POST", sv+"/invites/approve", nil)
	if c != 200 || ap["queued"].(float64) != 2 {
		t.Fatalf("approve: %d %v", c, ap)
	}
	if c, _, _ := h.do(h.alice, "POST", sv+"/invites/approve", nil); c != 409 {
		t.Errorf("approving twice: %d", c)
	}
	_, list, _ := h.do(h.alice, "GET", sv+"/invites", nil)
	for _, i := range list["invites"].([]any) {
		m := i.(map[string]any)
		if err := h.svSend.Work(context.Background(), &river.Job[survey.SendArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: survey.SendArgs{WorkspaceID: uuid.MustParse(ws), InviteID: uuid.MustParse(m["id"].(string)), UserID: h.aliceID}}); err != nil {
			t.Fatal(err)
		}
	}
	mails := h.mail.all()
	if len(mails) != 2 {
		t.Fatalf("%d emails, want 2", len(mails))
	}
	var danaLink string
	for _, m := range mails {
		if m.To[0] == "dana@acme.com" {
			danaLink = surveyLinkRe.FindStringSubmatch(m.Text)[1]
		}
		if m.To[0] == "pat@other.io" {
			t.Error("someone outside the audience was written to")
		}
	}

	// the person opens the link: no sign-in
	pub := "/v1/public/surveys/" + danaLink
	c, page, _ := h.do("", "GET", pub, nil)
	if c != 200 || page["title"] != "Check-in" || len(page["questions"].([]any)) != 3 || page["workspaceName"] != "Surveys Co" {
		t.Fatalf("public page: %d %v", c, page)
	}
	if c, _, _ := h.do("", "GET", "/v1/public/surveys/i.not-a-real-link-at-all", nil); c != 404 {
		t.Errorf("a made-up link: %d", c)
	}
	qids := map[string]string{}
	for _, q := range page["questions"].([]any) {
		m := q.(map[string]any)
		qids[m["kind"].(string)] = m["id"].(string)
	}
	answer := func(complete bool, extra ...map[string]any) (int, map[string]any) {
		ans := []map[string]any{{"questionId": qids["nps"], "number": 9}}
		ans = append(ans, extra...)
		c, b, _ := h.do("", "POST", pub+"/answers", map[string]any{"answers": ans, "complete": complete})
		return c, b
	}
	if c, b := answer(false, map[string]any{"questionId": qids["choice"], "choice": "Free lunch"}); c != 400 {
		t.Errorf("a choice that was not offered: %d %v", c, b)
	}
	if c, b := answer(false, map[string]any{"questionId": qids["choice"], "choice": "Price"}); c != 200 || b["complete"] != false {
		t.Errorf("partial: %d %v", c, b)
	}
	c, b := answer(true, map[string]any{"questionId": qids["text"], "text": "We really need SSO."})
	if c != 200 || b["complete"] != true || b["thankYou"] != "Thanks!" {
		t.Fatalf("finish: %d %v", c, b)
	}
	if c, b := answer(true); c != 200 || b["alreadyAnswered"] != true {
		t.Errorf("repeat: %d %v", c, b)
	}
	// unknown fields are refused by the contract, like everywhere
	if c, _, _ := h.do("", "POST", pub+"/answers", `{"answers":[],"complete":true,"admin":true}`); c != 400 {
		t.Errorf("an unknown field: %d", c)
	}

	// the free text reaches the review queue as a source for this person
	var respID uuid.UUID
	h.db.Super.QueryRow(context.Background(), `SELECT id FROM survey_response WHERE workspace_id=$1 AND state='complete'`, ws).Scan(&respID)
	if err := h.svEvid.Work(context.Background(), &river.Job[survey.EvidenceArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: survey.EvidenceArgs{WorkspaceID: uuid.MustParse(ws), ResponseID: respID}}); err != nil {
		t.Fatal(err)
	}
	var n int
	h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM source_item s JOIN person p ON p.id=s.person_id WHERE s.workspace_id=$1 AND s.kind='survey' AND p.email='dana@acme.com' AND s.raw_text LIKE '%We really need SSO.%'`, ws).Scan(&n)
	if n != 1 {
		t.Errorf("%d survey sources for Dana", n)
	}

	// results
	_, res, _ := h.do(h.alice, "GET", sv+"/results", nil)
	if res["complete"].(float64) != 1 || len(res["text"].([]any)) != 1 || res["text"].([]any)[0].(map[string]any)["person"] != "Dana" {
		t.Errorf("results %v", res)
	}
	if c, _, _ := h.do(h.bob, "GET", sv+"/results", nil); c != 404 {
		t.Errorf("a stranger saw results: %d", c)
	}
	_, one, _ := h.do(h.alice, "GET", sv, nil)
	if one["responses"].(float64) != 1 || one["invitesByState"].(map[string]any)["sent"].(float64) != 2 {
		t.Errorf("counts %v", one)
	}

	// closing: the link says so and takes nothing more
	if c, _, _ := h.do(h.alice, "POST", sv+"/close", nil); c != 204 {
		t.Fatalf("close: %d", c)
	}
	_, page, _ = h.do("", "GET", pub, nil)
	if page["closed"] != true {
		t.Errorf("closed page %v", page)
	}
	other := "/v1/public/surveys/" + surveyLinkRe.FindStringSubmatch(func() string {
		for _, m := range mails {
			if m.To[0] == "lee@acme.com" {
				return m.Text
			}
		}
		return ""
	}())[1] + "/answers"
	if c, b, _ := h.do("", "POST", other, map[string]any{"answers": []map[string]any{{"questionId": qids["nps"], "number": 5}}, "complete": true}); c != 409 || fmt.Sprint(b["error"]) == "" {
		t.Errorf("answering a closed survey: %d %v", c, b)
	}
	if c, _, _ := h.do(vt, "DELETE", sv, nil); c != 403 {
		t.Errorf("a viewer deleted: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", sv, nil); c != 204 {
		t.Errorf("delete: %d", c)
	}
	if c, _, _ := h.do("", "GET", pub, nil); c != 404 {
		t.Errorf("a deleted survey's link: %d", c)
	}
}

func TestAPublicLinkWorksFromTheWebAndIsLimited(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Open Co")
	base := h.surveyBase(ws)
	_, body, _ := h.do(h.alice, "POST", base, map[string]any{"title": "Open survey", "delivery": "open"})
	id := body["id"].(string)
	sv := base + "/" + id
	h.do(h.alice, "PUT", sv+"/questions", map[string]any{"questions": []map[string]any{{"kind": "csat", "prompt": "How are we doing?"}}})
	if c, _, _ := h.do(h.alice, "POST", sv+"/invites", nil); c != 400 {
		t.Errorf("personal invitations for a public-link survey: %d", c)
	}
	h.do(h.alice, "POST", sv+"/open", nil)
	_, one, _ := h.do(h.alice, "GET", sv, nil)
	link, _ := one["publicLink"].(string)
	tok := strings.TrimPrefix(link, "https://app.example/s/")
	if !strings.HasPrefix(tok, "o.") {
		t.Fatalf("public link %q", link)
	}
	_, page, _ := h.do("", "GET", "/v1/public/surveys/"+tok, nil)
	qid := page["questions"].([]any)[0].(map[string]any)["id"].(string)
	browser := "web-browser-key-00000001"
	post := func(key string) (int, map[string]any) {
		c, b, _ := h.do("", "POST", "/v1/public/surveys/"+tok+"/answers", map[string]any{"respondent": key, "complete": true, "answers": []map[string]any{{"questionId": qid, "number": 4}}})
		return c, b
	}
	if c, b := post(browser); c != 200 || b["complete"] != true {
		t.Fatalf("answer: %d %v", c, b)
	}
	if c, b := post(browser); c != 200 || b["alreadyAnswered"] != true {
		t.Errorf("same browser again: %d %v", c, b)
	}
	if c, b := post("web"); c != 400 {
		t.Errorf("a short browser id: %d %v", c, b)
	}
	_, again, _ := h.do("", "GET", "/v1/public/surveys/"+tok+"?respondent="+browser, nil)
	if again["answered"] != true {
		t.Errorf("the page does not remember the browser: %v", again)
	}
	// the retired link stops working at once
	_, rs, _ := h.do(h.alice, "POST", sv+"/link/reset", nil)
	if rs["link"] == link {
		t.Error("the link did not change")
	}
	if c, _, _ := h.do("", "GET", "/v1/public/surveys/"+tok, nil); c != 404 {
		t.Errorf("a retired link: %d", c)
	}
	// the request limiter on public routes still applies to survey links
	h.setLimits(Limits{ReadPerMinute: 100000, WritePerMinute: 100000, PublicPerMinute: 3, RegisterPerHour: 100000})
	limited := 0
	for i := 0; i < 8; i++ {
		if c, _, _ := h.do("", "GET", "/v1/public/surveys/"+tok, nil); c == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("public survey requests were never limited")
	}
}

func TestSeveralConditionsOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Surveys Co")
	base := h.surveyBase(ws)
	_, body, _ := h.do(h.alice, "POST", base, map[string]any{"title": "Branches"})
	sv := base + "/" + body["id"].(string)
	qs := func(w any) []map[string]any {
		return []map[string]any{
			{"kind": "nps", "prompt": "Score"},
			{"kind": "choice", "prompt": "Plan", "options": []string{"Free", "Team"}},
			{"kind": "text", "prompt": "More?", "showWhen": w},
		}
	}
	good := map[string]any{"match": "any", "conditions": []map[string]any{{"question": 0, "op": "lte", "number": 6}, {"question": 1, "op": "eq", "choice": "Free"}}}
	if c, b, _ := h.do(h.alice, "PUT", sv+"/questions", map[string]any{"questions": qs(good)}); c != 204 {
		t.Fatalf("save: %d %v", c, b)
	}
	_, got, _ := h.do(h.alice, "GET", sv, nil)
	q := got["questions"].([]any)[2].(map[string]any)
	w := q["showWhen"].(map[string]any)
	if w["match"] != "any" || len(w["conditions"].([]any)) != 2 || q["showIf"] != nil {
		t.Fatalf("read back %v", q)
	}
	first := w["conditions"].([]any)[0].(map[string]any)
	if first["questionId"] != got["questions"].([]any)[0].(map[string]any)["id"] || first["op"] != "lte" {
		t.Errorf("condition %v", first)
	}
	// too many conditions and unknown fields are refused at the edge
	many := map[string]any{"match": "all", "conditions": []map[string]any{{"question": 0, "op": "lte", "number": 1}, {"question": 0, "op": "lte", "number": 2}, {"question": 0, "op": "lte", "number": 3}, {"question": 0, "op": "lte", "number": 4}, {"question": 0, "op": "lte", "number": 5}}}
	if c, _, _ := h.do(h.alice, "PUT", sv+"/questions", map[string]any{"questions": qs(many)}); c != 400 {
		t.Errorf("five conditions: %d", c)
	}
	if c, _, _ := h.do(h.alice, "PUT", sv+"/questions", map[string]any{"questions": qs(map[string]any{"match": "all", "conditions": []map[string]any{{"question": 0, "op": "lte", "number": 1, "extra": true}}})}); c != 400 {
		t.Errorf("an unknown field: %d", c)
	}
}
