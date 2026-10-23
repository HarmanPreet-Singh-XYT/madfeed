package webhook_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/outreach"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
	"product/api/internal/webhook"
)

var ctx = context.Background()

var secret = "whsec_" + base64.StdEncoding.EncodeToString([]byte("test-signing-key-of-some-length"))

type env struct {
	db  *testdb.DB
	h   *webhook.Resend
	now time.Time
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	e := &env{db: db, now: time.Now()}
	e.h = &webhook.Resend{Pool: db.Backend, Suppress: &outreach.Service{Pool: db.Backend}, Secret: secret, Now: func() time.Time { return e.now }}
	return e
}

// message makes a sent message with a provider id in its own workspace and returns the pieces.
func (e *env) message(t *testing.T, to, state string) (ws uuid.UUID, providerID string, msgID uuid.UUID) {
	t.Helper()
	ws = uuid.New()
	ten := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, e.db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ws, Name: "W"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	var person, req, batch uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email) VALUES ($1,'P',$2) RETURNING id`, ws, to).Scan(&person))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'R') RETURNING id`, ws).Scan(&req))
	must(e.db.Super.QueryRow(ctx, `INSERT INTO outreach_batch (workspace_id, request_id, created_by, state) VALUES ($1,$2,$3,'approved') RETURNING id`, ws, req, ten.UserID).Scan(&batch))
	providerID = "re_" + uuid.NewString()
	must(e.db.Super.QueryRow(ctx, `INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email, evidence_ids, state, subject, body, approved_by, approved_at, sent_at, provider_message_id)
		VALUES ($1,$2,$3,$4,$5,'{}','sent','s','b',$6, now(), now(), $7) RETURNING id`, ws, batch, req, person, to, ten.UserID, providerID).Scan(&msgID))
	return
}

func (e *env) post(body string, mutate func(h http.Header)) *httptest.ResponseRecorder {
	id := "msg_" + uuid.NewString()
	sig, _ := webhook.Sign(secret, id, e.now, []byte(body))
	r := httptest.NewRequest("POST", "/v1/webhooks/resend", strings.NewReader(body))
	r.Header.Set("svix-id", id)
	r.Header.Set("svix-timestamp", strconv.FormatInt(e.now.Unix(), 10))
	r.Header.Set("svix-signature", sig)
	if mutate != nil {
		mutate(r.Header)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, r)
	return rec
}

func report(typ, id, bounce string) string {
	b := ""
	if bounce != "" {
		b = fmt.Sprintf(`,"bounce":{"type":%q,"subType":"General"}`, bounce)
	}
	return fmt.Sprintf(`{"type":%q,"created_at":"2026-10-23T00:00:00Z","data":{"email_id":%q,"to":["ignored@example.com"]%s}}`, typ, id, b)
}

func (e *env) suppressed(t *testing.T, ws uuid.UUID, addr string) (string, bool) {
	t.Helper()
	var reason string
	err := e.db.Super.QueryRow(ctx, `SELECT reason FROM suppression WHERE workspace_id=$1 AND email=$2`, ws, addr).Scan(&reason)
	return reason, err == nil
}

func TestHardBouncesAndComplaintsStopAllFurtherEmail(t *testing.T) {
	e := setup(t)
	for name, c := range map[string]struct{ typ, bounce, reason string }{
		"hard bounce": {"email.bounced", "Permanent", "bounced"},
		"complaint":   {"email.complained", "", "complained"},
	} {
		addr := strings.ReplaceAll(name, " ", "-") + "@example.com"
		ws, pid, _ := e.message(t, addr, "sent")
		// A message still waiting to go to the same address is withdrawn too.
		var person, req, batch uuid.UUID
		_ = e.db.Super.QueryRow(ctx, `SELECT person_id, request_id, batch_id FROM outreach_message WHERE provider_message_id=$1`, pid).Scan(&person, &req, &batch)
		var other uuid.UUID
		_ = e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'R2') RETURNING id`, ws).Scan(&other)
		var batch2 uuid.UUID
		_ = e.db.Super.QueryRow(ctx, `INSERT INTO outreach_batch (workspace_id, request_id, created_by, state) VALUES ($1,$2,$3,'review') RETURNING id`, ws, other, uuid.New()).Scan(&batch2)
		var pending uuid.UUID
		if err := e.db.Super.QueryRow(ctx, `INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email, evidence_ids, state, subject, body) VALUES ($1,$2,$3,$4,$5,'{}','draft','s','b') RETURNING id`, ws, batch2, other, person, addr).Scan(&pending); err != nil {
			t.Fatal(err)
		}

		if rec := e.post(report(c.typ, pid, c.bounce), nil); rec.Code != 204 {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
		if reason, ok := e.suppressed(t, ws, addr); !ok || reason != c.reason {
			t.Errorf("%s: suppression = %q %v", name, reason, ok)
		}
		var state string
		_ = e.db.Super.QueryRow(ctx, `SELECT state FROM outreach_message WHERE id=$1`, pending).Scan(&state)
		if state != "suppressed" {
			t.Errorf("%s: the waiting message is %s, want suppressed", name, state)
		}
		// The address in the report body is never trusted: only the one we sent to.
		if _, ok := e.suppressed(t, ws, "ignored@example.com"); ok {
			t.Errorf("%s: an address from the payload was suppressed", name)
		}
		// The same report again changes nothing and still succeeds.
		if rec := e.post(report(c.typ, pid, c.bounce), nil); rec.Code != 204 {
			t.Errorf("%s repeat: %d", name, rec.Code)
		}
		var n int
		_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM suppression WHERE workspace_id=$1`, ws).Scan(&n)
		if n != 1 {
			t.Errorf("%s: %d suppression rows", name, n)
		}
	}
}

func TestOnlyRealProblemsWithOurOwnMessagesCount(t *testing.T) {
	e := setup(t)
	ws, pid, _ := e.message(t, "ok@example.com", "sent")
	for name, body := range map[string]string{
		"temporary bounce":    report("email.bounced", pid, "Transient"),
		"undetermined bounce": report("email.bounced", pid, "Undetermined"),
		"delivered":           report("email.delivered", pid, ""),
		"opened":              report("email.opened", pid, ""),
		"unknown id":          report("email.complained", "re_never-sent-by-us", ""),
		"empty id":            report("email.complained", "", ""),
		"unknown event":       `{"type":"domain.updated","data":{}}`,
	} {
		if rec := e.post(body, nil); rec.Code != 204 {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	if _, ok := e.suppressed(t, ws, "ok@example.com"); ok {
		t.Error("a harmless report suppressed an address")
	}
	var total int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM suppression WHERE email IN ('ok@example.com','ignored@example.com')`).Scan(&total)
	if total != 0 {
		t.Errorf("%d suppressions from harmless reports", total)
	}
	// Reports act inside the right workspace only.
	ws2, pid2, _ := e.message(t, "ok@example.com", "sent") // same address, other workspace
	if rec := e.post(report("email.complained", pid2, ""), nil); rec.Code != 204 {
		t.Fatal(rec.Code)
	}
	if _, ok := e.suppressed(t, ws2, "ok@example.com"); !ok {
		t.Error("the right workspace was not updated")
	}
	if _, ok := e.suppressed(t, ws, "ok@example.com"); ok {
		t.Error("another workspace's opt-out list was changed")
	}
}

func TestOnlySignedFreshUntamperedRequestsAreAccepted(t *testing.T) {
	e := setup(t)
	ws, pid, _ := e.message(t, "x@example.com", "sent")
	body := report("email.complained", pid, "")
	check := func(name string, code int, mutate func(http.Header)) {
		t.Helper()
		if rec := e.post(body, mutate); rec.Code != code {
			t.Errorf("%s: %d, want %d", name, rec.Code, code)
		}
		if _, ok := e.suppressed(t, ws, "x@example.com"); ok && code == 401 {
			t.Fatalf("%s: a rejected request still took effect", name)
		}
	}
	check("missing signature", 401, func(h http.Header) { h.Del("svix-signature") })
	check("missing id", 401, func(h http.Header) { h.Del("svix-id") })
	check("missing timestamp", 401, func(h http.Header) { h.Del("svix-timestamp") })
	check("garbage signature", 401, func(h http.Header) { h.Set("svix-signature", "v1,AAAA") })
	check("no version prefix", 401, func(h http.Header) {
		s := strings.TrimPrefix(h.Get("svix-signature"), "v1,")
		h.Set("svix-signature", s)
	})
	check("different id than signed", 401, func(h http.Header) { h.Set("svix-id", "msg_other") })
	// Correctly signed, but too old or too far ahead: a captured request cannot be replayed later.
	resign := func(at time.Time) func(http.Header) {
		return func(h http.Header) {
			sig, _ := webhook.Sign(secret, h.Get("svix-id"), at, []byte(body))
			h.Set("svix-timestamp", strconv.FormatInt(at.Unix(), 10))
			h.Set("svix-signature", sig)
		}
	}
	check("stale but correctly signed", 401, resign(e.now.Add(-6*time.Minute)))
	check("future but correctly signed", 401, resign(e.now.Add(6*time.Minute)))
	check("timestamp edited without re-signing", 401, func(h http.Header) { h.Set("svix-timestamp", strconv.FormatInt(e.now.Add(-time.Minute).Unix(), 10)) })
	check("timestamp not a number", 401, func(h http.Header) { h.Set("svix-timestamp", "yesterday") })

	// Signed with a different secret.
	other := "whsec_" + base64.StdEncoding.EncodeToString([]byte("some-other-key"))
	sig, _ := webhook.Sign(other, "msg_1", e.now, []byte(body))
	check("wrong secret", 401, func(h http.Header) { h.Set("svix-id", "msg_1"); h.Set("svix-signature", sig) })

	// Body changed after signing.
	r := httptest.NewRequest("POST", "/", strings.NewReader(strings.Replace(body, "complained", "bounced", 1)))
	good, _ := webhook.Sign(secret, "msg_2", e.now, []byte(body))
	r.Header.Set("svix-id", "msg_2")
	r.Header.Set("svix-timestamp", strconv.FormatInt(e.now.Unix(), 10))
	r.Header.Set("svix-signature", good)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, r)
	if rec.Code != 401 {
		t.Errorf("tampered body: %d", rec.Code)
	}

	// Nothing above had any effect.
	if _, ok := e.suppressed(t, ws, "x@example.com"); ok {
		t.Fatal("a rejected request took effect")
	}

	// Just inside the window is fine (this one is valid, so it takes effect).
	if rec := e.post(body, resign(e.now.Add(-4*time.Minute))); rec.Code != 204 {
		t.Errorf("4 minutes old: %d", rec.Code)
	}

	// Two signatures (secret rotation): one valid is enough, in either position.
	for _, order := range []string{"v1,AAAA %s", "%s v1,BBBB"} {
		pidN := pid
		b := report("email.complained", pidN, "")
		sig, _ := webhook.Sign(secret, "msg_3", e.now, []byte(b))
		rq := httptest.NewRequest("POST", "/", strings.NewReader(b))
		rq.Header.Set("svix-id", "msg_3")
		rq.Header.Set("svix-timestamp", strconv.FormatInt(e.now.Unix(), 10))
		rq.Header.Set("svix-signature", fmt.Sprintf(order, sig))
		rc := httptest.NewRecorder()
		e.h.ServeHTTP(rc, rq)
		if rc.Code != 204 {
			t.Errorf("rotated signatures %q: %d", order, rc.Code)
		}
	}
	if _, ok := e.suppressed(t, ws, "x@example.com"); !ok {
		t.Error("a valid request did not take effect")
	}

	// Switched off without a secret; only POST; body size capped.
	off := &webhook.Resend{Pool: e.db.Backend, Suppress: &outreach.Service{Pool: e.db.Backend}}
	rc := httptest.NewRecorder()
	off.ServeHTTP(rc, httptest.NewRequest("POST", "/", strings.NewReader(body)))
	if rc.Code != 503 {
		t.Errorf("no secret configured: %d", rc.Code)
	}
	rc = httptest.NewRecorder()
	e.h.ServeHTTP(rc, httptest.NewRequest("GET", "/", nil))
	if rc.Code != 405 {
		t.Errorf("GET: %d", rc.Code)
	}
	rc = httptest.NewRecorder()
	e.h.ServeHTTP(rc, httptest.NewRequest("POST", "/", bytes.NewReader(make([]byte, 70<<10))))
	if rc.Code != 413 {
		t.Errorf("70 KB body: %d", rc.Code)
	}
}
