package hooks_test

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/hooks"
	"product/api/internal/secretbox"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type env struct {
	db                    *testdb.DB
	svc                   *hooks.Service
	send                  *hooks.Sender
	now                   time.Time
	admin, member, viewer store.Tenant
	other                 store.Tenant
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, err := secretbox.New(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	e := &env{db: db, now: time.Now()}
	e.svc = &hooks.Service{Pool: db.Backend, Box: box, AllowPrivate: true}
	e.send = &hooks.Sender{Pool: db.Backend, Box: box, AllowPrivate: true, Now: func() time.Time { return e.now }}
	ws := uuid.New()
	mk := func(ws uuid.UUID, r store.Role) store.Tenant {
		return store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: r}
	}
	e.admin, e.member, e.viewer, e.other = mk(ws, store.RoleAdmin), mk(ws, store.RoleMember), mk(ws, store.RoleViewer), mk(uuid.New(), store.RoleAdmin)
	for _, tn := range []store.Tenant{e.admin, e.member, e.viewer, e.other} {
		if _, err := db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1, 'Hooks') ON CONFLICT DO NOTHING`, tn.WorkspaceID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,$3)`, tn.WorkspaceID, tn.UserID, string(tn.Role)); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func (e *env) emit(t *testing.T, tn store.Tenant, typ string, data any) {
	t.Helper()
	err := store.WithTenantTx(ctx, e.db.Backend, tn, func(tx pgx.Tx, _ *dbgen.Queries) error {
		return hooks.Emit(ctx, tx, tn.WorkspaceID, typ, data)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// receiver records what arrives and answers with whatever status it is told to.
type receiver struct {
	mu     sync.Mutex
	status int
	got    []got
	srv    *httptest.Server
}
type got struct {
	body []byte
	h    http.Header
}

func newReceiver(t *testing.T) *receiver {
	r := &receiver{status: 200}
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		b, _ := io.ReadAll(q.Body)
		r.mu.Lock()
		r.got = append(r.got, got{b, q.Header.Clone()})
		st := r.status
		r.mu.Unlock()
		w.WriteHeader(st)
		_, _ = w.Write([]byte("secret-looking response body"))
	}))
	t.Cleanup(r.srv.Close)
	return r
}

func (r *receiver) count() int { r.mu.Lock(); defer r.mu.Unlock(); return len(r.got) }
func (r *receiver) set(st int) { r.mu.Lock(); r.status = st; r.mu.Unlock() }

func (e *env) endpoint(t *testing.T, url string, events ...string) (hooks.Endpoint, string) {
	t.Helper()
	ep, secret, err := e.svc.Create(ctx, e.admin, hooks.Input{URL: url, Events: events})
	if err != nil {
		t.Fatal(err)
	}
	return ep, secret
}

func TestAnEventIsSignedAndDeliveredOnce(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	ep, secret := e.endpoint(t, r.srv.URL, hooks.RequestStatusChanged)
	if !strings.HasPrefix(secret, "whsec_") {
		t.Fatalf("secret %q", secret)
	}
	e.emit(t, e.admin, hooks.RequestStatusChanged, map[string]any{"requestId": uuid.New(), "title": "Dark mode"})
	e.emit(t, e.admin, hooks.SurveyResponse, map[string]any{"x": 1}) // not subscribed

	n, err := e.send.RunDue(ctx, 10)
	if err != nil || n != 1 {
		t.Fatalf("sent %d: %v", n, err)
	}
	if n, _ := e.send.RunDue(ctx, 10); n != 0 {
		t.Errorf("a second run sent %d more", n)
	}
	if r.count() != 1 {
		t.Fatalf("received %d", r.count())
	}
	m := r.got[0]
	var env struct {
		ID, WorkspaceID uuid.UUID
		Type            string
		Data            map[string]any
	}
	if err := json.Unmarshal(m.body, &env); err != nil {
		t.Fatal(err)
	}
	if env.Type != hooks.RequestStatusChanged || env.WorkspaceID != e.admin.WorkspaceID || env.Data["title"] != "Dark mode" {
		t.Errorf("payload %s", m.body)
	}
	if m.h.Get("Webhook-Id") != env.ID.String() || m.h.Get("Webhook-Event") != hooks.RequestStatusChanged {
		t.Errorf("headers %v", m.h)
	}
	// the receiver can check the signature with the secret it was shown
	sig := m.h.Get("Webhook-Signature")
	ts, _, _ := strings.Cut(strings.TrimPrefix(sig, "t="), ",")
	var at int64
	_, _ = fmtSscan(ts, &at)
	if want := hooks.Sign(secret, time.Unix(at, 0), m.body); sig != want {
		t.Errorf("signature %s want %s", sig, want)
	}
	if hooks.Sign("whsec_other", time.Unix(at, 0), m.body) == sig {
		t.Error("a different secret produced the same signature")
	}
	ds, err := e.svc.Deliveries(ctx, e.admin, ep.ID)
	if err != nil || len(ds) != 1 || ds[0].State != "sent" || ds[0].LastStatus == nil || *ds[0].LastStatus != 200 {
		t.Fatalf("deliveries %+v %v", ds, err)
	}
}

func TestFailuresRetryWithBackoffThenGiveUp(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	r.set(500)
	ep, _ := e.endpoint(t, r.srv.URL, hooks.SuggestionsReady)
	e.emit(t, e.admin, hooks.SuggestionsReady, map[string]any{"count": 2})

	if n, _ := e.send.RunDue(ctx, 10); n != 1 {
		t.Fatalf("first run %d", n)
	}
	// not due again until the backoff passes
	if n, _ := e.send.RunDue(ctx, 10); n != 0 {
		t.Errorf("retried at once: %d", n)
	}
	ds, _ := e.svc.Deliveries(ctx, e.admin, ep.ID)
	if ds[0].State != "pending" || ds[0].Attempts != 1 || !strings.Contains(ds[0].LastError, "500") {
		t.Fatalf("%+v", ds[0])
	}
	if strings.Contains(ds[0].LastError, "secret-looking") {
		t.Error("the receiver's response body was stored")
	}
	// it gets better: the next attempt succeeds and the message is the same event
	r.set(200)
	e.skipAhead(t, ep.ID)
	if n, _ := e.send.RunDue(ctx, 10); n != 1 {
		t.Fatalf("retry %d", n)
	}
	if r.count() != 2 || r.got[0].h.Get("Webhook-Id") != r.got[1].h.Get("Webhook-Id") {
		t.Errorf("a retry must carry the same event id: %v", r.got)
	}
	ds, _ = e.svc.Deliveries(ctx, e.admin, ep.ID)
	if ds[0].State != "sent" || ds[0].Attempts != 2 {
		t.Errorf("%+v", ds[0])
	}

	// a receiver that never recovers: the message is given up after the last attempt
	r.set(503)
	e.emit(t, e.admin, hooks.SuggestionsReady, map[string]any{"count": 1})
	for i := 0; i < hooks.MaxAttempts; i++ {
		e.skipAhead(t, ep.ID)
		_, _ = e.send.RunDue(ctx, 10)
	}
	ds, _ = e.svc.Deliveries(ctx, e.admin, ep.ID)
	if ds[0].State != "failed" || ds[0].Attempts != hooks.MaxAttempts {
		t.Errorf("%+v", ds[0])
	}
}

// skipAhead makes everything waiting for a retry due now.
func (e *env) skipAhead(t *testing.T, id uuid.UUID) {
	t.Helper()
	if _, err := e.db.Super.Exec(ctx, `UPDATE outbound_delivery SET next_attempt_at = now() - interval '1 second' WHERE endpoint_id = $1 AND state = 'pending'`, id); err != nil {
		t.Fatal(err)
	}
}

func TestAnEndpointIsSwitchedOffAfterRepeatedFailures(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	r.set(500)
	ep, _ := e.endpoint(t, r.srv.URL, hooks.SuggestionsReady)
	for i := 0; i < hooks.PauseAfter; i++ {
		e.emit(t, e.admin, hooks.SuggestionsReady, map[string]any{"i": i})
	}
	if _, err := e.send.RunDue(ctx, 200); err != nil {
		t.Fatal(err)
	}
	eps, _ := e.svc.List(ctx, e.admin)
	if eps[0].Enabled || eps[0].PausedReason == "" {
		t.Fatalf("%+v", eps[0])
	}
	// switched off: new events are not even queued
	before := r.count()
	e.emit(t, e.admin, hooks.SuggestionsReady, map[string]any{"late": true})
	e.skipAhead(t, ep.ID)
	_, _ = e.send.RunDue(ctx, 200)
	if r.count() != before {
		t.Errorf("an endpoint that is off still received something")
	}
	// an admin turns it back on and the count starts over
	r.set(200)
	if err := e.svc.Update(ctx, e.admin, ep.ID, hooks.Input{URL: r.srv.URL, Events: []string{hooks.SuggestionsReady}}, true); err != nil {
		t.Fatal(err)
	}
	eps, _ = e.svc.List(ctx, e.admin)
	if !eps[0].Enabled || eps[0].ConsecutiveFailures != 0 || eps[0].PausedReason != "" {
		t.Errorf("%+v", eps[0])
	}
}

func TestTheTestButtonWorksEvenWhenNotSubscribed(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	ep, _ := e.endpoint(t, r.srv.URL, hooks.RequestCreated)
	if _, err := e.svc.SendTest(ctx, e.admin, ep.ID); err != nil {
		t.Fatal(err)
	}
	_, _ = e.send.RunDue(ctx, 10)
	if r.count() != 1 || r.got[0].h.Get("Webhook-Event") != hooks.Ping {
		t.Errorf("%v", r.got)
	}
	if _, err := e.svc.SendTest(ctx, e.other, ep.ID); !errors.Is(err, hooks.ErrNotFound) {
		t.Errorf("another workspace's test: %v", err)
	}
}

func TestOnlyAdminsManageEndpointsAndOthersSeeNothing(t *testing.T) {
	e := setup(t)
	ep, _ := e.endpoint(t, "https://example.com/hook", hooks.RequestCreated)
	in := hooks.Input{URL: "https://example.com/other", Events: []string{hooks.RequestCreated}}
	for name, tn := range map[string]store.Tenant{"member": e.member, "viewer": e.viewer} {
		if _, _, err := e.svc.Create(ctx, tn, in); !errors.Is(err, store.ErrForbidden) {
			t.Errorf("%s create: %v", name, err)
		}
		if _, err := e.svc.List(ctx, tn); !errors.Is(err, store.ErrForbidden) {
			t.Errorf("%s list: %v", name, err)
		}
		if err := e.svc.Update(ctx, tn, ep.ID, in, true); !errors.Is(err, store.ErrForbidden) {
			t.Errorf("%s update: %v", name, err)
		}
		if _, err := e.svc.RotateSecret(ctx, tn, ep.ID); !errors.Is(err, store.ErrForbidden) {
			t.Errorf("%s rotate: %v", name, err)
		}
		if err := e.svc.Delete(ctx, tn, ep.ID); !errors.Is(err, store.ErrForbidden) {
			t.Errorf("%s delete: %v", name, err)
		}
		if _, err := e.svc.Deliveries(ctx, tn, ep.ID); !errors.Is(err, store.ErrForbidden) {
			t.Errorf("%s deliveries: %v", name, err)
		}
	}
	// another workspace's admin cannot touch or even find it
	if err := e.svc.Delete(ctx, e.other, ep.ID); !errors.Is(err, hooks.ErrNotFound) {
		t.Errorf("other delete: %v", err)
	}
	if _, err := e.svc.RotateSecret(ctx, e.other, ep.ID); !errors.Is(err, hooks.ErrNotFound) {
		t.Errorf("other rotate: %v", err)
	}
	if eps, _ := e.svc.List(ctx, e.other); len(eps) != 0 {
		t.Errorf("other workspace sees %v", eps)
	}
	// and an event in one workspace is never queued for another's endpoint
	e.emit(t, e.other, hooks.RequestCreated, map[string]any{})
	var n int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outbound_delivery WHERE endpoint_id = $1`, ep.ID).Scan(&n)
	if n != 0 {
		t.Errorf("%d deliveries leaked across workspaces", n)
	}
}

func TestAddressesThatPointInsideAreRefused(t *testing.T) {
	e := setup(t)
	strict := &hooks.Service{Pool: e.db.Backend, Box: e.svc.Box}
	for _, u := range []string{
		"http://example.com/hook", "https://localhost/hook", "https://127.0.0.1/hook", "https://10.0.0.5/hook",
		"https://192.168.1.1/hook", "https://169.254.169.254/latest", "https://[::1]/hook", "https://100.64.0.1/hook",
		"https://user:pw@example.com/hook", "ftp://example.com", "example.com/hook", "https://service.internal/hook", "https://[::ffff:10.0.0.1]/hook",
	} {
		if _, err := strict.CheckURL(u); err == nil {
			t.Errorf("accepted %s", u)
		}
	}
	if _, err := strict.CheckURL("https://hooks.example.com/in?x=1"); err != nil {
		t.Errorf("refused a normal address: %v", err)
	}
}

func TestMessagesAreNeverSentToAPrivateAddress(t *testing.T) {
	e := setup(t)
	r := newReceiver(t) // listens on 127.0.0.1
	ep, _ := e.endpoint(t, r.srv.URL, hooks.RequestCreated)
	strict := &hooks.Sender{Pool: e.db.Backend, Box: e.send.Box, Now: e.send.Now} // AllowPrivate off
	e.emit(t, e.admin, hooks.RequestCreated, map[string]any{})
	if _, err := strict.RunDue(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if r.count() != 0 {
		t.Fatal("a message reached a loopback address")
	}
	ds, _ := e.svc.Deliveries(ctx, e.admin, ep.ID)
	if ds[0].State != "pending" || !strings.Contains(ds[0].LastError, "private") {
		t.Errorf("%+v", ds[0])
	}
}

func TestARedirectIsNotFollowed(t *testing.T) {
	e := setup(t)
	target := newReceiver(t)
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		http.Redirect(w, q, target.srv.URL, http.StatusFound)
	}))
	t.Cleanup(redirect.Close)
	ep, _ := e.endpoint(t, redirect.URL, hooks.RequestCreated)
	e.emit(t, e.admin, hooks.RequestCreated, map[string]any{})
	_, _ = e.send.RunDue(ctx, 10)
	if target.count() != 0 {
		t.Fatal("the redirect was followed")
	}
	ds, _ := e.svc.Deliveries(ctx, e.admin, ep.ID)
	if ds[0].State != "pending" || ds[0].Attempts != 1 {
		t.Errorf("%+v", ds[0])
	}
}

func TestRotatingTheSecretChangesTheSignature(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	ep, old := e.endpoint(t, r.srv.URL, hooks.RequestCreated)
	fresh, err := e.svc.RotateSecret(ctx, e.admin, ep.ID)
	if err != nil || fresh == old {
		t.Fatalf("%v", err)
	}
	e.emit(t, e.admin, hooks.RequestCreated, map[string]any{})
	_, _ = e.send.RunDue(ctx, 10)
	m := r.got[0]
	ts, _, _ := strings.Cut(strings.TrimPrefix(m.h.Get("Webhook-Signature"), "t="), ",")
	var at int64
	_, _ = fmtSscan(ts, &at)
	if m.h.Get("Webhook-Signature") != hooks.Sign(fresh, time.Unix(at, 0), m.body) {
		t.Error("not signed with the new secret")
	}
}

func TestInputRules(t *testing.T) {
	e := setup(t)
	bad := []hooks.Input{
		{URL: "https://example.com/x", Events: nil},
		{URL: "https://example.com/x", Events: []string{"nope"}},
		{URL: "https://example.com/x", Events: []string{hooks.RequestCreated}, Description: strings.Repeat("x", 201)},
		{URL: "https://example.com/x", Events: []string{hooks.Ping}}, // ping is only ever sent by the test button
	}
	for i, in := range bad {
		if _, _, err := e.svc.Create(ctx, e.admin, in); err == nil {
			t.Errorf("accepted bad input %d", i)
		}
	}
	// at most ten
	for i := 0; i < hooks.MaxEndpoints; i++ {
		if _, _, err := e.svc.Create(ctx, e.other, hooks.Input{URL: "https://example.com/" + uuid.NewString(), Events: []string{hooks.RequestCreated}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := e.svc.Create(ctx, e.other, hooks.Input{URL: "https://example.com/more", Events: []string{hooks.RequestCreated}}); err == nil {
		t.Error("an eleventh address was accepted")
	}
}

func TestDeletingAnEndpointRemovesItsHistory(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	ep, _ := e.endpoint(t, r.srv.URL, hooks.RequestCreated)
	e.emit(t, e.admin, hooks.RequestCreated, map[string]any{})
	if err := e.svc.Delete(ctx, e.admin, ep.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outbound_delivery WHERE endpoint_id = $1`, ep.ID).Scan(&n)
	if n != 0 {
		t.Errorf("%d deliveries remain", n)
	}
	if k, _ := e.send.RunDue(ctx, 10); k != 0 || r.count() != 0 {
		t.Error("something was sent after deletion")
	}
}

func TestACommittedChangeAndItsEventStandOrFallTogether(t *testing.T) {
	e := setup(t)
	r := newReceiver(t)
	ep, _ := e.endpoint(t, r.srv.URL, hooks.RequestCreated)
	boom := errors.New("rolled back")
	err := store.WithTenantTx(ctx, e.db.Backend, e.admin, func(tx pgx.Tx, _ *dbgen.Queries) error {
		if err := hooks.Emit(ctx, tx, e.admin.WorkspaceID, hooks.RequestCreated, map[string]any{}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatal(err)
	}
	var n int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM outbound_delivery WHERE endpoint_id = $1`, ep.ID).Scan(&n)
	if n != 0 {
		t.Errorf("an event for a rolled-back change was queued")
	}
}

func TestSecretsAreSealedAtRest(t *testing.T) {
	e := setup(t)
	_, secret := e.endpoint(t, "https://example.com/hook", hooks.RequestCreated)
	var sealed []byte
	if err := e.db.Super.QueryRow(ctx, `SELECT secret FROM outbound_endpoint WHERE workspace_id = $1 LIMIT 1`, e.admin.WorkspaceID).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(sealed), secret) || strings.Contains(string(sealed), "whsec_") {
		t.Error("the signing secret is stored in clear")
	}
}

func fmtSscan(s string, v *int64) (int, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	*v = n
	return 1, err
}

func TestChatFormatsCarryReadableTextAndNeverLetATitleMentionAnyone(t *testing.T) {
	e := setup(t)
	e.send.WebURL = "https://app.example.com/"
	title := "Dark *mode* <!channel> @everyone [click](https://evil.example) `x`"
	req := uuid.New()
	for _, format := range []string{"slack", "discord", "teams"} {
		r := newReceiver(t)
		if _, _, err := e.svc.Create(ctx, e.admin, hooks.Input{URL: r.srv.URL, Events: []string{hooks.RequestStatusChanged}, Format: format}); err != nil {
			t.Fatal(err)
		}
		e.emit(t, e.admin, hooks.RequestStatusChanged, map[string]any{"requestId": req, "title": title, "toStatusName": "Planned"})
		if _, err := e.send.RunDue(ctx, 50); err != nil {
			t.Fatal(err)
		}
		if r.count() != 1 {
			t.Fatalf("%s: received %d", format, r.count())
		}
		body := string(r.got[0].body)
		link := "https://app.example.com/w/" + e.admin.WorkspaceID.String() + "/requests/" + req.String()
		if !strings.Contains(body, "moved to Planned") || !strings.Contains(body, link) {
			t.Errorf("%s: %s", format, body)
		}
		var m map[string]any
		if err := json.Unmarshal(r.got[0].body, &m); err != nil {
			t.Fatalf("%s: not JSON: %v", format, err)
		}
		switch format {
		case "slack":
			txt, _ := m["text"].(string)
			if txt == "" || strings.Contains(txt, "<!channel>") || !strings.Contains(txt, "&lt;!channel&gt;") {
				t.Errorf("slack: %s", body)
			}
		case "discord":
			am, _ := m["allowed_mentions"].(map[string]any)
			if m["content"] == nil || am == nil || len(am["parse"].([]any)) != 0 || strings.Contains(m["content"].(string), "@everyone") {
				t.Errorf("discord: %s", body)
			}
		case "teams":
			if m["type"] != "message" || !strings.Contains(body, "AdaptiveCard") || strings.Contains(body, "[click](") {
				t.Errorf("teams: %s", body)
			}
		}
		// still signed, over the body that was sent
		sig := r.got[0].h.Get("Webhook-Signature")
		if !strings.HasPrefix(sig, "t=") || !strings.Contains(sig, ",v1=") {
			t.Errorf("%s: signature %q", format, sig)
		}
	}
}

func TestEveryEventHasAChatSentence(t *testing.T) {
	ws := uuid.New()
	for _, typ := range append(append([]string{}, hooks.Events...), hooks.Ping) {
		env, _ := json.Marshal(map[string]any{"type": typ, "data": map[string]any{"title": "T", "count": 3, "toStatusName": "Done", "requestId": uuid.New()}})
		for _, f := range []string{"slack", "discord", "teams"} {
			out := string(hooks.Render(f, "", ws, env))
			if strings.Contains(out, "Something happened") || len(out) < 15 {
				t.Errorf("%s/%s: %s", typ, f, out)
			}
		}
	}
	if got := string(hooks.Render("json", "", ws, []byte(`{"a":1}`))); got != `{"a":1}` {
		t.Errorf("json must be left as it is: %s", got)
	}
	if _, _, err := (&hooks.Service{Box: nil}).Create(ctx, store.Tenant{}, hooks.Input{}); err == nil {
		t.Error("created without being an admin")
	}
}

func TestAnUnknownFormatIsRefused(t *testing.T) {
	e := setup(t)
	if _, _, err := e.svc.Create(ctx, e.admin, hooks.Input{URL: "https://example.com/h", Events: []string{hooks.RequestCreated}, Format: "xml"}); err == nil {
		t.Error("accepted")
	}
	ep, _, err := e.svc.Create(ctx, e.admin, hooks.Input{URL: "https://example.com/h", Events: []string{hooks.RequestCreated}, Format: "slack"})
	if err != nil || ep.Format != "slack" {
		t.Fatalf("%v %+v", err, ep)
	}
	if err := e.svc.Update(ctx, e.admin, ep.ID, hooks.Input{URL: "https://example.com/h", Events: []string{hooks.RequestCreated}, Format: "discord"}, true); err != nil {
		t.Fatal(err)
	}
	eps, _ := e.svc.List(ctx, e.admin)
	if eps[len(eps)-1].Format != "discord" && eps[0].Format != "discord" {
		t.Errorf("%+v", eps)
	}
}
