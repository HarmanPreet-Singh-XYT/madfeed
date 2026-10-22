package release_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/release"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func tenant(t *testing.T, db *testdb.DB, name string) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: name}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	return ten
}

func slug(t *testing.T) string { return "ws-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12] }

func request(t *testing.T, db *testdb.DB, ten store.Tenant, title string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,$2) RETURNING id`, ten.WorkspaceID, title).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestNoteLifecycleAndPublicVisibility(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	ten := tenant(t, db, "Acme Software")
	sl := slug(t)
	if err := svc.UpdateSettings(ctx, ten, sl, "Priya from Acme"); err != nil {
		t.Fatal(err)
	}
	secret := request(t, db, ten, "INTERNAL: Globex wants SAML")

	id, err := svc.Create(ctx, ten, "Single sign-on is here", "You can now sign in with your company account.\n\nSecond paragraph.")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetRequests(ctx, ten, id, []uuid.UUID{secret}); err != nil {
		t.Fatal(err)
	}
	n, _ := svc.Get(ctx, ten, id)
	if n.State != "draft" || n.LiveNow || len(n.Requests) != 1 || n.Requests[0].Title != "INTERNAL: Globex wants SAML" {
		t.Fatalf("%+v", n)
	}

	// A draft is invisible: in the list, by id, and on a made-up address.
	if page, err := svc.PublicList(ctx, sl, 10); err != nil || len(page.Notes) != 0 {
		t.Fatalf("draft is public: %+v %v", page, err)
	}
	if _, _, err := svc.PublicGet(ctx, sl, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("draft by id: %v", err)
	}

	// Published: visible, with only the title, text and time.
	if err := svc.Publish(ctx, ten, id, nil); err != nil {
		t.Fatal(err)
	}
	page, err := svc.PublicList(ctx, sl, 10)
	if err != nil || len(page.Notes) != 1 || page.WorkspaceName != "Acme Software" {
		t.Fatalf("%+v %v", page, err)
	}
	pub, name, err := svc.PublicGet(ctx, sl, id)
	if err != nil || pub.Title != "Single sign-on is here" || name != "Acme Software" || pub.PublishedAt.IsZero() {
		t.Fatalf("%+v %v", pub, err)
	}
	// Nothing internal leaks, even though the note is linked to a request with a sensitive title.
	raw, _ := json.Marshal(map[string]any{"page": page, "note": pub})
	for _, leak := range []string{"INTERNAL", "Globex", "SAML", secret.String(), ten.WorkspaceID.String(), ten.UserID.String()} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("public output leaks %q: %s", leak, raw)
		}
	}
	if err := svc.Publish(ctx, ten, id, nil); !errors.As(err, new(release.ErrConflict)) {
		t.Fatalf("publishing twice: %v", err)
	}

	// Editing a live note changes the public page; unpublishing removes it everywhere.
	if err := svc.Update(ctx, ten, id, "Single sign-on is live", "Updated."); err != nil {
		t.Fatal(err)
	}
	if pub, _, _ := svc.PublicGet(ctx, sl, id); pub.Title != "Single sign-on is live" {
		t.Fatalf("%+v", pub)
	}
	if err := svc.Unpublish(ctx, ten, id); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.PublicGet(ctx, sl, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("unpublished note still public: %v", err)
	}
	if page, _ := svc.PublicList(ctx, sl, 10); len(page.Notes) != 0 {
		t.Fatal("unpublished note still listed")
	}
	if err := svc.Unpublish(ctx, ten, id); !errors.As(err, new(release.ErrConflict)) {
		t.Fatalf("unpublishing twice: %v", err)
	}
	// It can be published again later.
	if err := svc.Publish(ctx, ten, id, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.PublicGet(ctx, sl, id); err != nil {
		t.Fatalf("republished: %v", err)
	}
}

func TestScheduledNotesAppearAtTheirInstantInAnyTimeZone(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	ten := tenant(t, db, "Zones")
	sl := slug(t)
	_ = svc.UpdateSettings(ctx, ten, sl, "")

	id, _ := svc.Create(ctx, ten, "Scheduled", "Body")
	// The same instant written in many zones (including ones with daylight saving) is stored identically.
	base := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	var stored time.Time
	for _, zone := range []string{"UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe"} {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.Publish(ctx, ten, id, ptr(base.In(loc))); err != nil {
			t.Fatalf("%s: %v", zone, err)
		}
		n, _ := svc.Get(ctx, ten, id)
		if n.State != "scheduled" || n.ScheduledFor == nil {
			t.Fatalf("%s: %+v", zone, n)
		}
		if stored.IsZero() {
			stored = *n.ScheduledFor
		}
		if !n.ScheduledFor.Equal(stored) || !n.ScheduledFor.Equal(base) {
			t.Fatalf("%s: stored %v, want the instant %v", zone, n.ScheduledFor, base)
		}
	}

	// Before its time the note is invisible; the moment it is due it appears, with no job involved.
	if _, _, err := svc.PublicGet(ctx, sl, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("scheduled note visible early: %v", err)
	}
	if n, _ := svc.Get(ctx, ten, id); n.LiveNow {
		t.Fatal("LiveNow before the time")
	}
	set := func(offset string) {
		if _, err := db.Super.Exec(ctx, `UPDATE release_note SET scheduled_for = now() + $2::interval WHERE id=$1`, id, offset); err != nil {
			t.Fatal(err)
		}
	}
	set("1 second")
	if _, _, err := svc.PublicGet(ctx, sl, id); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("one second early: %v", err)
	}
	set("-1 second")
	pub, _, err := svc.PublicGet(ctx, sl, id)
	if err != nil || pub.Title != "Scheduled" {
		t.Fatalf("one second late: %v", err)
	}
	if n, _ := svc.Get(ctx, ten, id); !n.LiveNow || n.State != "scheduled" {
		t.Fatalf("%+v", n)
	}
	if page, _ := svc.PublicList(ctx, sl, 10); len(page.Notes) != 1 || !page.Notes[0].PublishedAt.Equal(pub.PublishedAt) {
		t.Fatalf("%+v", page)
	}

	// Times that are not in the future, or absurdly far, are refused.
	other, _ := svc.Create(ctx, ten, "Other", "")
	for name, at := range map[string]time.Time{"past": time.Now().Add(-time.Hour), "now": time.Now(), "far": time.Now().AddDate(2, 0, 0)} {
		if err := svc.Publish(ctx, ten, other, ptr(at)); !errors.As(err, new(release.ErrInvalid)) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func ptr[T any](v T) *T { return &v }

func TestPublicAddressesAreIsolatedValidatedAndUnique(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	a, b := tenant(t, db, "A Co"), tenant(t, db, "B Co")
	sa, sb := slug(t), slug(t)
	_ = svc.UpdateSettings(ctx, a, sa, "")
	_ = svc.UpdateSettings(ctx, b, sb, "")
	idA, _ := svc.Create(ctx, a, "A's note", "a")
	_ = svc.Publish(ctx, a, idA, nil)

	// A note is only reachable through its own workspace's address.
	if _, _, err := svc.PublicGet(ctx, sb, idA); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("A's note under B's address: %v", err)
	}
	if page, _ := svc.PublicList(ctx, sb, 10); len(page.Notes) != 0 {
		t.Fatal("B's page shows A's note")
	}
	for _, bad := range []string{"nope-nope-nope", "", "UPPER", "a", "../etc", "x' OR '1'='1", strings.Repeat("a", 60)} {
		if _, err := svc.PublicList(ctx, bad, 10); !errors.Is(err, release.ErrNotFound) {
			t.Errorf("address %q: %v", bad, err)
		}
	}
	if _, _, err := svc.PublicGet(ctx, sa, uuid.New()); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("made-up id: %v", err)
	}

	// Address rules.
	for name, s := range map[string]string{"too short": "ab", "reserved": "admin", "bad chars": "my_page!", "leading hyphen": "-abc", "taken": sa} {
		err := svc.UpdateSettings(ctx, b, s, "")
		if name == "taken" {
			if !errors.As(err, new(release.ErrConflict)) {
				t.Errorf("taken: %v", err)
			}
			continue
		}
		if !errors.As(err, new(release.ErrInvalid)) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := svc.UpdateSettings(ctx, b, sb, "Bad\nName"); !errors.As(err, new(release.ErrInvalid)) {
		t.Errorf("sender name with a line break: %v", err)
	}
	if err := svc.UpdateSettings(ctx, b, sb, `Evil" <x@y.z>`); !errors.As(err, new(release.ErrInvalid)) {
		t.Errorf("sender name with quotes and brackets: %v", err)
	}
	// Removing the address takes the whole page offline.
	if err := svc.UpdateSettings(ctx, a, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicList(ctx, sa, 10); !errors.Is(err, release.ErrNotFound) {
		t.Fatalf("page still reachable after the address was removed: %v", err)
	}
}

func TestRolesAndValidation(t *testing.T) {
	db := testdb.New(t)
	svc := &release.Service{Pool: db.Backend}
	ten := tenant(t, db, "Roles")
	viewer := ten
	viewer.UserID, viewer.Role = uuid.New(), store.RoleViewer
	member := ten
	member.UserID, member.Role = uuid.New(), store.RoleMember
	id, _ := svc.Create(ctx, ten, "Note", "body")

	for name, err := range map[string]error{
		"create":    func() error { _, err := svc.Create(ctx, viewer, "x", ""); return err }(),
		"update":    svc.Update(ctx, viewer, id, "x", ""),
		"publish":   svc.Publish(ctx, viewer, id, nil),
		"unpublish": svc.Unpublish(ctx, viewer, id),
		"link":      svc.SetRequests(ctx, viewer, id, nil),
	} {
		if !errors.Is(err, store.ErrForbidden) {
			t.Errorf("viewer %s: %v", name, err)
		}
	}
	if _, err := svc.Get(ctx, viewer, id); err != nil {
		t.Errorf("viewer may read: %v", err)
	}
	// Only admins change the public address or the sender name.
	if err := svc.UpdateSettings(ctx, member, slug(t), ""); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("member settings: %v", err)
	}
	if _, err := svc.Create(ctx, member, "Member note", ""); err != nil {
		t.Errorf("members may write notes: %v", err)
	}

	for name, c := range map[string][2]string{"empty title": {" ", "b"}, "multi-line title": {"a\nb", "b"}, "long title": {strings.Repeat("t", 201), "b"}, "huge body": {"t", strings.Repeat("x", 20001)}} {
		if _, err := svc.Create(ctx, ten, c[0], c[1]); !errors.As(err, new(release.ErrInvalid)) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Linking to another workspace's request is refused.
	other := tenant(t, db, "Other")
	foreign := request(t, db, other, "theirs")
	if err := svc.SetRequests(ctx, ten, id, []uuid.UUID{foreign}); !errors.As(err, new(release.ErrInvalid)) {
		t.Errorf("cross-tenant link: %v", err)
	}
	// A stranger cannot read or change this note.
	if _, err := svc.Get(ctx, other, id); !errors.Is(err, release.ErrNotFound) {
		t.Errorf("stranger get: %v", err)
	}
	if err := svc.Update(ctx, other, id, "x", ""); !errors.Is(err, release.ErrNotFound) {
		t.Errorf("stranger update: %v", err)
	}
	if err := svc.Publish(ctx, other, id, nil); !errors.Is(err, release.ErrNotFound) {
		t.Errorf("stranger publish: %v", err)
	}
	// Backlinks: the request knows which notes mention it.
	mine := request(t, db, ten, "mine")
	_ = svc.SetRequests(ctx, ten, id, []uuid.UUID{mine})
	notes, _ := svc.ForRequest(ctx, ten, mine)
	if len(notes) != 1 || notes[0].ID != id {
		t.Fatalf("%+v", notes)
	}
}
