package apikey_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"product/api/internal/apikey"
	"product/api/internal/cache"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/team"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type env struct {
	db    *testdb.DB
	mr    *miniredis.Miniredis
	rc    *cache.Redis
	svc   *apikey.Service
	admin store.Tenant
}

func setup(t *testing.T) env {
	t.Helper()
	db := testdb.New(t)
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })
	admin := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	err = store.WithTenant(ctx, db.Backend, admin, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: admin.WorkspaceID, Name: "keys"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: admin.WorkspaceID, UserID: admin.UserID, Role: "admin"})
	})
	if err != nil {
		t.Fatal(err)
	}
	return env{db, mr, rc, &apikey.Service{Pool: db.Backend, Cache: rc}, admin}
}

func TestAKeyIsRememberedButRevokingItEndsItAtOnce(t *testing.T) {
	e := setup(t)
	k, secret, err := e.svc.Create(ctx, e.admin, "ci", apikey.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if in, err := e.svc.Authenticate(ctx, secret, "203.0.113.7"); err != nil || in.ID != k.ID || in.WorkspaceID != e.admin.WorkspaceID {
		t.Fatalf("first use: %+v %v", in, err)
	}
	// Ended behind the cache's back: still accepted, which proves the database was skipped.
	if _, err := e.db.Super.Exec(ctx, `UPDATE api_key SET revoked_at = now() WHERE id = $1`, k.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Authenticate(ctx, secret, "203.0.113.7"); err != nil {
		t.Fatalf("the key was not served from the cache: %v", err)
	}
	// Ended through the service: gone immediately.
	k2, secret2, _ := e.svc.Create(ctx, e.admin, "ci2", apikey.Options{})
	if _, err := e.svc.Authenticate(ctx, secret2, ""); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Revoke(ctx, e.admin, k2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Authenticate(ctx, secret2, ""); !errors.Is(err, apikey.ErrBadKey) {
		t.Fatalf("a revoked key still works: %v", err)
	}
}

func TestTheAddressRuleIsCheckedOnEveryCallEvenWhenTheKeyIsRemembered(t *testing.T) {
	e := setup(t)
	_, secret, err := e.svc.Create(ctx, e.admin, "office", apikey.Options{AllowedCIDRs: []string{"203.0.113.0/24"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Authenticate(ctx, secret, "203.0.113.9"); err != nil {
		t.Fatalf("allowed address: %v", err)
	}
	for _, ip := range []string{"198.51.100.1", "not-an-address", ""} {
		if _, err := e.svc.Authenticate(ctx, secret, ip); !errors.Is(err, apikey.ErrBadKey) {
			t.Errorf("from %q: %v", ip, err)
		}
	}
}

func TestARememberedKeyNeverOutlivesItsOwnExpiry(t *testing.T) {
	e := setup(t)
	_, secret, err := e.svc.Create(ctx, e.admin, "short", apikey.Options{Lifetime: 1500 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Authenticate(ctx, secret, ""); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1700 * time.Millisecond)
	e.mr.FastForward(0) // the entry's own TTL is capped at the key's remaining life
	if _, err := e.svc.Authenticate(ctx, secret, ""); !errors.Is(err, apikey.ErrBadKey) {
		t.Fatalf("an expired key still works: %v", err)
	}
}

func TestRemovingAPersonEndsTheKeysTheyMadeAtOnce(t *testing.T) {
	e := setup(t)
	mate := uuid.New()
	err := store.WithTenant(ctx, e.db.Backend, e.admin, func(q *dbgen.Queries) error {
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: e.admin.WorkspaceID, UserID: mate, Role: "admin"})
	})
	if err != nil {
		t.Fatal(err)
	}
	mateT := store.Tenant{WorkspaceID: e.admin.WorkspaceID, UserID: mate, Role: store.RoleAdmin}
	_, secret, err := e.svc.Create(ctx, mateT, "theirs", apikey.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Authenticate(ctx, secret, ""); err != nil {
		t.Fatal(err)
	}
	if err := (&team.Service{Pool: e.db.Backend, Cache: e.rc}).Remove(ctx, e.admin, mate); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Authenticate(ctx, secret, ""); !errors.Is(err, apikey.ErrBadKey) {
		t.Fatalf("a removed person's key still works: %v", err)
	}
}

func TestUsageIsWrittenInBatchesAndNothingIsLostAtShutdown(t *testing.T) {
	e := setup(t)
	k, _, err := e.svc.Create(ctx, e.admin, "busy", apikey.Options{})
	if err != nil {
		t.Fatal(err)
	}
	in := apikey.Info{ID: k.ID, WorkspaceID: e.admin.WorkspaceID, Name: "busy"}

	e.svc.Record(ctx, in, "list", "", true) // not started: written straight away
	if n := len(events(t, e, k.ID)); n != 1 {
		t.Fatalf("direct write: %d entries", n)
	}

	runCtx, stop := context.WithCancel(ctx)
	wait := e.svc.StartLog(runCtx)
	for i := 0; i < 250; i++ {
		e.svc.Record(ctx, in, "get", "", i%2 == 0)
	}
	stop()
	wait()                                     // writes what is left
	if n := len(events(t, e, k.ID)); n != 50 { // the list shows the latest 50 of 251
		t.Fatalf("after shutdown the log shows %d entries, want its full page of 50", n)
	}
	var total int
	if err := e.db.Super.QueryRow(ctx, `SELECT count(*) FROM api_key_event WHERE key_id = $1`, k.ID).Scan(&total); err != nil || total != 251 {
		t.Fatalf("stored %d entries, want 251 (%v)", total, err)
	}
	e.svc.Record(ctx, in, "search", "", true) // stopped: back to direct writes
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM api_key_event WHERE key_id = $1`, k.ID).Scan(&total)
	if total != 252 {
		t.Fatalf("a call after shutdown was lost: %d", total)
	}
}

func events(t *testing.T, e env, id uuid.UUID) []apikey.Event {
	t.Helper()
	ev, err := e.svc.Events(ctx, e.admin, id)
	if err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestOneBadEntryDoesNotTakeItsNeighboursWithIt(t *testing.T) {
	e := setup(t)
	k, _, _ := e.svc.Create(ctx, e.admin, "mixed", apikey.Options{})
	in := apikey.Info{ID: k.ID, WorkspaceID: e.admin.WorkspaceID, Name: "mixed"}
	runCtx, stop := context.WithCancel(ctx)
	wait := e.svc.StartLog(runCtx)
	e.svc.Record(ctx, in, "get", "", true)
	e.svc.Record(ctx, in, "not-an-action", "", true)
	e.svc.Record(ctx, in, "list", "", true)
	stop()
	wait()
	if n := len(events(t, e, k.ID)); n != 2 {
		t.Fatalf("%d entries stored, want the 2 good ones", n)
	}
}

func TestTheLogReadsNewestFirstEvenWhenEntriesAreWrittenTogether(t *testing.T) {
	e := setup(t)
	k, _, _ := e.svc.Create(ctx, e.admin, "ordered", apikey.Options{})
	in := apikey.Info{ID: k.ID, WorkspaceID: e.admin.WorkspaceID, Name: "ordered"}
	runCtx, stop := context.WithCancel(ctx)
	wait := e.svc.StartLog(runCtx)
	for _, a := range []string{"list", "get", "search", "ask", "update"} {
		e.svc.Record(ctx, in, a, "", true)
		time.Sleep(2 * time.Millisecond)
	}
	stop()
	wait() // all five go out in one transaction
	got := events(t, e, k.ID)
	want := []string{"update", "ask", "search", "get", "list"}
	if len(got) != len(want) {
		t.Fatalf("%d entries", len(got))
	}
	for i, w := range want {
		if got[i].Action != w {
			t.Fatalf("entry %d is %q, want %q (full order: %v)", i, got[i].Action, w, got)
		}
	}
}

func TestCallsRacingTheShutdownAreNeverLeftInTheQueue(t *testing.T) {
	e := setup(t)
	k, _, _ := e.svc.Create(ctx, e.admin, "racy", apikey.Options{})
	in := apikey.Info{ID: k.ID, WorkspaceID: e.admin.WorkspaceID, Name: "racy"}
	runCtx, stop := context.WithCancel(ctx)
	wait := e.svc.StartLog(runCtx)
	const n = 200
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < n; i++ {
			e.svc.Record(ctx, in, "get", "", true)
			if i == n/2 {
				stop() // shutdown begins while calls are still arriving
			}
		}
	}()
	<-done
	wait()
	var total int
	if err := e.db.Super.QueryRow(ctx, `SELECT count(*) FROM api_key_event WHERE key_id = $1`, k.ID).Scan(&total); err != nil || total != n {
		t.Fatalf("stored %d of %d entries (%v)", total, n, err)
	}
}
