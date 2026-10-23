package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/webhook"
)

func TestDeliveryReportsReachTheHandlerWithoutSignInButOnlyIfSigned(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Hooks")
	wsID := uuid.MustParse(ws)
	ctx := context.Background()
	var person, req, batch uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(h.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email) VALUES ($1,'P','gone@example.com') RETURNING id`, wsID).Scan(&person))
	must(h.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'R') RETURNING id`, wsID).Scan(&req))
	must(h.db.Super.QueryRow(ctx, `INSERT INTO outreach_batch (workspace_id, request_id, created_by, state) VALUES ($1,$2,$3,'done') RETURNING id`, wsID, req, h.aliceID).Scan(&batch))
	pid := "re_" + uuid.NewString()
	_, err := h.db.Super.Exec(ctx, `INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email, evidence_ids, state, subject, body, approved_by, approved_at, sent_at, provider_message_id)
		VALUES ($1,$2,$3,$4,'gone@example.com','{}','sent','s','b',$5, now(), now(), $6)`, wsID, batch, req, person, h.aliceID, pid)
	must(err)

	body := `{"type":"email.complained","data":{"email_id":"` + pid + `"}}`
	send := func(sign bool) int {
		r := httptest.NewRequest("POST", "/v1/webhooks/resend", strings.NewReader(body))
		now := time.Now()
		r.Header.Set("svix-id", "msg_1")
		r.Header.Set("svix-timestamp", strconv.FormatInt(now.Unix(), 10))
		if sign {
			sig, _ := webhook.Sign(testWebhookSecret, "msg_1", now, []byte(body))
			r.Header.Set("svix-signature", sig)
		} else {
			r.Header.Set("svix-signature", "v1,AAAA")
		}
		rec := httptest.NewRecorder()
		h.h.ServeHTTP(rec, r)
		return rec.Code
	}
	if code := send(false); code != 401 {
		t.Fatalf("unsigned: %d", code)
	}
	var n int
	_ = h.db.Super.QueryRow(ctx, `SELECT count(*) FROM suppression WHERE workspace_id=$1`, wsID).Scan(&n)
	if n != 0 {
		t.Fatal("an unsigned report took effect")
	}
	if code := send(true); code != 204 {
		t.Fatalf("signed: %d", code)
	}
	_ = h.db.Super.QueryRow(ctx, `SELECT count(*) FROM suppression WHERE workspace_id=$1 AND email='gone@example.com' AND reason='complained'`, wsID).Scan(&n)
	if n != 1 {
		t.Fatalf("the complaint was not recorded: %d", n)
	}
	// Everything else still needs a sign-in, and the old routes are untouched.
	if code, _, _ := h.do("", "GET", "/v1/workspaces", nil); code != 401 {
		t.Fatalf("workspaces without sign-in: %d", code)
	}
	if code, _, _ := h.do(h.alice, "GET", "/v1/workspaces", nil); code != 200 {
		t.Fatalf("workspaces with sign-in: %d", code)
	}
	if code, _, _ := h.do(h.alice, "GET", "/v1/webhooks/other", nil); code != 404 && code != 401 {
		t.Fatalf("unknown webhook path: %d", code)
	}
	_ = http.StatusOK
}
