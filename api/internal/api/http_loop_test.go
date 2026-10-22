package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/outreach"
)

func (hn *harness) statusID(token, ws, name string) string {
	hn.t.Helper()
	_, body, _ := hn.do(token, "GET", "/v1/workspaces/"+ws+"/statuses", nil)
	for _, s := range body["statuses"].([]any) {
		m := s.(map[string]any)
		if m["name"] == name {
			return m["id"].(string)
		}
	}
	hn.t.Fatalf("no status %s", name)
	return ""
}

// requestFrom creates a request with one accepted quote from each person (by email).
func (hn *harness) requestFrom(token, ws string, emails ...string) string {
	hn.t.Helper()
	base := "/v1/workspaces/" + ws
	var reqID string
	for _, e := range emails {
		src := hn.pasteAs(token, ws, hn.personID(token, ws, e), "Someone: We really need SSO for our team.\n\n"+uuid.NewString())
		body := map[string]any{}
		if reqID != "" {
			body["targetRequestId"] = reqID
		}
		code, res, _ := hn.do(token, "POST", base+"/proposals/"+hn.proposalFor(token, ws, src)+"/accept", body)
		if code != 200 {
			hn.t.Fatalf("accept: %d %v", code, res)
		}
		reqID = res["requestId"].(string)
	}
	return reqID
}

func (hn *harness) draftAll(ws string, batch map[string]any) {
	hn.t.Helper()
	for _, m := range batch["messages"].([]any) {
		id := uuid.MustParse(m.(map[string]any)["id"].(string))
		if err := hn.draftW.Work(context.Background(), &river.Job[outreach.DraftArgs]{
			JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3},
			Args:   outreach.DraftArgs{WorkspaceID: uuid.MustParse(ws), MessageID: id, UserID: hn.aliceID},
		}); err != nil {
			hn.t.Fatal(err)
		}
	}
}

func (hn *harness) sendAll(ws string, batch map[string]any) {
	hn.t.Helper()
	for _, m := range batch["messages"].([]any) {
		id := uuid.MustParse(m.(map[string]any)["id"].(string))
		if err := hn.sendW.Work(context.Background(), &river.Job[outreach.SendArgs]{
			JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 5},
			Args:   outreach.SendArgs{WorkspaceID: uuid.MustParse(ws), MessageID: id, UserID: hn.aliceID},
		}); err != nil {
			hn.t.Fatal(err)
		}
	}
}

func TestShipReviewApproveSendOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Loop")
	base := "/v1/workspaces/" + ws
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	req := h.requestFrom(h.alice, ws, "dana@acme.com", "raj@acme.com")
	shipped := h.statusID(h.alice, ws, "Shipped")

	// A new request starts as "New".
	_, detail, _ := h.do(h.alice, "GET", base+"/requests/"+req, nil)
	if st := detail["status"].(map[string]any); st["name"] != "New" || st["bucket"] != "open" || detail["openBatchId"] != nil {
		t.Fatalf("%v", detail)
	}

	code, ch, _ := h.do(h.alice, "PUT", base+"/requests/"+req+"/status", map[string]any{"statusId": shipped})
	if code != 200 || ch["shipped"] != true || ch["willContact"].(float64) != 2 || ch["batchId"] == nil {
		t.Fatalf("ship: %d %v", code, ch)
	}
	batchID := ch["batchId"].(string)
	if code, again, _ := h.do(h.alice, "PUT", base+"/requests/"+req+"/status", map[string]any{"statusId": shipped}); code != 200 || again["shipped"] != false {
		t.Fatalf("replay: %d %v", code, again)
	}
	_, detail, _ = h.do(h.alice, "GET", base+"/requests/"+req, nil)
	if detail["openBatchId"] != batchID || detail["status"].(map[string]any)["bucket"] != "done" {
		t.Fatalf("%v", detail)
	}
	_, list, _ := h.do(h.alice, "GET", base+"/requests", nil)
	if list["requests"].([]any)[0].(map[string]any)["status"].(map[string]any)["name"] != "Shipped" {
		t.Fatalf("%v", list)
	}

	// While drafting, approval is refused with a plain message.
	if code, e, _ := h.do(h.alice, "POST", base+"/outreach/"+batchID+"/approve", nil); code != 409 || e["error"].(map[string]any)["code"] != "still_drafting" {
		t.Fatalf("approve while drafting: %d %v", code, e)
	}
	_, batch, _ := h.do(h.alice, "GET", base+"/outreach/"+batchID, nil)
	h.draftAll(ws, batch)
	_, batch, _ = h.do(h.alice, "GET", base+"/outreach/"+batchID, nil)
	msgs := batch["messages"].([]any)
	if batch["state"] != "review" || len(msgs) != 2 || batch["readyToSend"].(float64) != 2 {
		t.Fatalf("%v", batch)
	}
	for _, m := range msgs {
		mm := m.(map[string]any)
		if mm["state"] != "draft" || !strings.HasPrefix(mm["body"].(string), "Hi ") || len(mm["quotes"].([]any)) != 1 {
			t.Fatalf("%v", mm)
		}
	}
	// The queue lists it.
	if _, open, _ := h.do(h.alice, "GET", base+"/outreach", nil); len(open["batches"].([]any)) != 1 {
		t.Fatalf("%v", open)
	}

	// Strangers and viewers cannot touch it.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if code, _, _ := h.do(h.bob, "POST", base+"/outreach/"+batchID+"/approve", nil); code != 404 {
		t.Fatalf("stranger: %d", code)
	}
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "GET", base+"/outreach/"+batchID, nil); code != 200 {
		t.Fatalf("viewer read: %d", code)
	}
	first := msgs[0].(map[string]any)["id"].(string)
	for name, call := range map[string][3]string{
		"approve": {"POST", base + "/outreach/" + batchID + "/approve", ""}, "cancel": {"POST", base + "/outreach/" + batchID + "/cancel", ""},
		"exclude": {"POST", base + "/outreach/messages/" + first + "/exclude", ""},
	} {
		if code, _, _ := h.do(h.bob, call[0], call[1], nil); code != 403 {
			t.Errorf("viewer %s: %d", name, code)
		}
	}
	if code, _, _ := h.do(h.bob, "PUT", base+"/requests/"+req+"/status", map[string]any{"statusId": h.statusID(h.alice, ws, "Planned")}); code != 403 {
		t.Errorf("viewer status: %d", code)
	}

	// Edit one, leave one out, then include it again; nothing has been sent yet.
	if code, e, _ := h.do(h.alice, "PUT", base+"/outreach/messages/"+first, map[string]any{"subject": "Our SSO is live", "body": "Hi,\n\nIt is live.\n\nAcme"}); code != 204 {
		t.Fatalf("edit: %d %v", code, e)
	}
	if code, e, _ := h.do(h.alice, "PUT", base+"/outreach/messages/"+first, map[string]any{"subject": "a\nBcc: x@y.z", "body": "b"}); code != 400 {
		t.Fatalf("edit with a header injection: %d %v", code, e)
	}
	second := msgs[1].(map[string]any)["id"].(string)
	h.do(h.alice, "POST", base+"/outreach/messages/"+second+"/exclude", nil)
	h.do(h.alice, "POST", base+"/outreach/messages/"+second+"/include", nil)
	if len(h.mail.all()) != 0 {
		t.Fatal("something was sent before approval")
	}

	code, ok, _ := h.do(h.alice, "POST", base+"/outreach/"+batchID+"/approve", nil)
	if code != 202 || ok["queued"].(float64) != 2 {
		t.Fatalf("approve: %d %v", code, ok)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/outreach/"+batchID+"/approve", nil); code != 409 {
		t.Fatalf("approve twice: %d", code)
	}
	_, batch, _ = h.do(h.alice, "GET", base+"/outreach/"+batchID, nil)
	h.sendAll(ws, batch)
	sent := h.mail.all()
	if len(sent) != 2 {
		t.Fatalf("sent %d emails", len(sent))
	}
	got := map[string]string{}
	for _, m := range sent {
		got[m.To[0]] = m.Subject
	}
	if got["dana@acme.com"] == "" || got["raj@acme.com"] == "" || (got["dana@acme.com"] != "Our SSO is live" && got["raj@acme.com"] != "Our SSO is live") {
		t.Fatalf("%v", got)
	}

	// The request now shows who was told and when; the batch moved to "done".
	_, detail, _ = h.do(h.alice, "GET", base+"/requests/"+req, nil)
	informed := detail["informed"].([]any)
	if len(informed) != 2 || detail["openBatchId"] != nil {
		t.Fatalf("%v", detail)
	}
	if _, done, _ := h.do(h.alice, "GET", base+"/outreach?state=done", nil); len(done["batches"].([]any)) != 1 {
		t.Fatalf("%v", done)
	}
}

func TestReleaseNotesAndPublicPagesOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Acme Software")
	base := "/v1/workspaces/" + ws
	slug := "acme-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	req := h.requestFrom(h.alice, ws, "dana@acme.com")

	if code, e, _ := h.do(h.alice, "PUT", base+"/settings", map[string]any{"publicSlug": slug, "senderName": "Priya from Acme"}); code != 204 {
		t.Fatalf("settings: %d %v", code, e)
	}
	if _, st, _ := h.do(h.alice, "GET", base+"/settings", nil); st["publicSlug"] != slug || st["senderName"] != "Priya from Acme" {
		t.Fatalf("%v", st)
	}
	for name, body := range map[string]map[string]any{"reserved": {"publicSlug": "admin"}, "too short": {"publicSlug": "ab"}, "bad sender": {"senderName": "Evil\" <x@y.z>"}} {
		if code, _, _ := h.do(h.alice, "PUT", base+"/settings", body); code != 400 {
			t.Errorf("%s: %d", name, code)
		}
	}

	code, created, _ := h.do(h.alice, "POST", base+"/release-notes", map[string]any{"title": "Single sign-on is here", "body": "Sign in with your company account.\n\nThat's it."})
	if code != 201 {
		t.Fatalf("create: %d %v", code, created)
	}
	note := created["id"].(string)
	if code, e, _ := h.do(h.alice, "PUT", base+"/release-notes/"+note+"/requests", map[string]any{"requestIds": []string{req}}); code != 204 {
		t.Fatalf("link: %d %v", code, e)
	}
	_, got, _ := h.do(h.alice, "GET", base+"/release-notes/"+note, nil)
	if got["state"] != "draft" || got["liveNow"] != false || len(got["requests"].([]any)) != 1 {
		t.Fatalf("%v", got)
	}
	_, detail, _ := h.do(h.alice, "GET", base+"/requests/"+req, nil)
	if rn := detail["releaseNotes"].([]any); len(rn) != 1 || rn[0].(map[string]any)["title"] != "Single sign-on is here" {
		t.Fatalf("backlink: %v", detail["releaseNotes"])
	}

	// The public page needs no sign-in and shows nothing until published.
	if code, _, _ := h.do("", "GET", "/v1/public/releases/"+slug, nil); code != 200 {
		t.Fatalf("public list: %d", code)
	}
	if _, page, _ := h.do("", "GET", "/v1/public/releases/"+slug, nil); len(page["notes"].([]any)) != 0 || page["workspaceName"] != "Acme Software" {
		t.Fatalf("%v", page)
	}
	if code, _, _ := h.do("", "GET", "/v1/public/releases/"+slug+"/"+note, nil); code != 404 {
		t.Fatalf("draft by id: %d", code)
	}

	if code, e, _ := h.do(h.alice, "POST", base+"/release-notes/"+note+"/publish", nil); code != 204 {
		t.Fatalf("publish: %d %v", code, e)
	}
	_, page, _ := h.do("", "GET", "/v1/public/releases/"+slug, nil)
	notes := page["notes"].([]any)
	if len(notes) != 1 || notes[0].(map[string]any)["title"] != "Single sign-on is here" {
		t.Fatalf("%v", page)
	}
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/public/releases/"+slug+"/"+note, nil))
	raw := rec.Body.String()
	if rec.Code != 200 || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	for _, leak := range []string{req, ws, "dana", "Dana", "SSO for our team", "quote"} {
		if strings.Contains(raw, leak) {
			t.Errorf("the public note leaks %q: %s", leak, raw)
		}
	}
	// Other workspaces' addresses never show it.
	if code, _, _ := h.do("", "GET", "/v1/public/releases/nope-nope-nope/"+note, nil); code != 404 {
		t.Fatalf("wrong address: %d", code)
	}

	// Unpublish takes it down; scheduling accepts any zone offset but one absolute moment, and refuses the past.
	h.do(h.alice, "POST", base+"/release-notes/"+note+"/unpublish", nil)
	if code, _, _ := h.do("", "GET", "/v1/public/releases/"+slug+"/"+note, nil); code != 404 {
		t.Fatalf("unpublished: %d", code)
	}
	instant := time.Now().Add(3 * time.Hour).UTC().Truncate(time.Second)
	ist := time.FixedZone("IST", 5*3600+1800)
	if code, e, _ := h.do(h.alice, "POST", base+"/release-notes/"+note+"/publish", map[string]any{"scheduledFor": instant.In(ist).Format(time.RFC3339)}); code != 204 {
		t.Fatalf("schedule: %d %v", code, e)
	}
	_, got, _ = h.do(h.alice, "GET", base+"/release-notes/"+note, nil)
	at, _ := time.Parse(time.RFC3339, got["scheduledFor"].(string))
	if got["state"] != "scheduled" || got["liveNow"] != false || !at.Equal(instant) {
		t.Fatalf("%v (want %v)", got, instant)
	}
	if code, _, _ := h.do("", "GET", "/v1/public/releases/"+slug+"/"+note, nil); code != 404 {
		t.Fatalf("not due yet: %d", code)
	}
	if code, _, _ := h.do(h.alice, "POST", base+"/release-notes/"+note+"/publish", map[string]any{"scheduledFor": time.Now().Add(-time.Hour).Format(time.RFC3339)}); code != 400 {
		t.Fatalf("past: %d", code)
	}
	// A member can write notes but only an admin changes the public address.
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := h.do(h.bob, "POST", base+"/release-notes", map[string]any{"title": "Member note"}); code != 201 {
		t.Errorf("member note: %d", code)
	}
	if code, _, _ := h.do(h.bob, "PUT", base+"/settings", map[string]any{"publicSlug": "hijack-me"}); code != 403 {
		t.Errorf("member settings: %d", code)
	}
}

func TestUnsubscribeLinksOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Unsub")
	base := "/v1/workspaces/" + ws
	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": peopleCSV})
	req := h.requestFrom(h.alice, ws, "dana@acme.com", "raj@acme.com")
	wsID := uuid.MustParse(ws)
	tok := h.unsub.Token(wsID, "dana@acme.com")

	// Opening the link (or a mail scanner prefetching it) changes nothing and reveals only a masked address.
	code, body, _ := h.do("", "GET", "/v1/public/unsubscribe/"+tok, nil)
	if code != 200 || body["maskedEmail"] != "d***@acme.com" {
		t.Fatalf("%d %v", code, body)
	}
	var n int
	_ = h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM suppression WHERE workspace_id=$1`, ws).Scan(&n)
	if n != 0 {
		t.Fatal("a GET unsubscribed someone")
	}
	if code, _, _ := h.do("", "POST", "/v1/public/unsubscribe/"+tok, nil); code != 204 {
		t.Fatalf("confirm: %d", code)
	}
	if code, _, _ := h.do("", "POST", "/v1/public/unsubscribe/"+tok, nil); code != 204 {
		t.Fatalf("confirming twice must be harmless: %d", code)
	}
	_ = h.db.Super.QueryRow(context.Background(), `SELECT count(*) FROM suppression WHERE workspace_id=$1 AND email='dana@acme.com' AND reason='unsubscribed'`, ws).Scan(&n)
	if n != 1 {
		t.Fatalf("suppression rows: %d", n)
	}
	for name, bad := range map[string]string{"tampered": tok[:len(tok)-3] + "AAA", "other address": h.unsub.Token(uuid.New(), "x@y.io")[:30], "garbage": strings.Repeat("a", 40)} {
		if code, _, _ := h.do("", "GET", "/v1/public/unsubscribe/"+bad, nil); code != 404 {
			t.Errorf("%s GET: %d", name, code)
		}
		if code, _, _ := h.do("", "POST", "/v1/public/unsubscribe/"+bad, nil); code != 404 {
			t.Errorf("%s POST: %d", name, code)
		}
	}
	// Shipping afterwards does not contact the person who opted out.
	_, ch, _ := h.do(h.alice, "PUT", base+"/requests/"+req+"/status", map[string]any{"statusId": h.statusID(h.alice, ws, "Shipped")})
	if ch["willContact"].(float64) != 1 || ch["suppressed"].(float64) != 1 {
		t.Fatalf("%v", ch)
	}
}

func TestLoopRoutesNeedSignInButPublicOnesDoNot(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Auth")
	b := "/v1/workspaces/" + ws
	id := uuid.NewString()
	for _, r := range []struct{ method, path string }{
		{"GET", b + "/statuses"}, {"POST", b + "/statuses"}, {"PUT", b + "/requests/" + id + "/status"}, {"GET", b + "/outreach"},
		{"GET", b + "/outreach/" + id}, {"POST", b + "/outreach/" + id + "/approve"}, {"PUT", b + "/outreach/messages/" + id},
		{"GET", b + "/release-notes"}, {"POST", b + "/release-notes/" + id + "/publish"}, {"GET", b + "/settings"}, {"PUT", b + "/settings"},
	} {
		if code, _, _ := h.do("", r.method, r.path, "{}"); code != 401 {
			t.Errorf("%s %s without a token: %d", r.method, r.path, code)
		}
	}
	for _, p := range []string{"/v1/public/releases/some-address", "/v1/public/releases/some-address/" + id} {
		if code, _, _ := h.do("", "GET", p, nil); code != 404 {
			t.Errorf("public %s: %d (404 for something that does not exist, never 401)", p, code)
		}
	}
	raw, _ := json.Marshal(map[string]any{})
	_ = raw
}
