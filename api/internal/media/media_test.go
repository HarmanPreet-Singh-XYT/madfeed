package media_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/media"
	"product/api/internal/storage"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
	"product/api/internal/transcribe"
)

var ctx = context.Background()

type fakeProvider struct {
	res   transcribe.Result
	err   error
	max   int64
	calls int
	got   []byte
}

func (f *fakeProvider) Name() string { return "fake" }
func (f *fakeProvider) MaxBytes() int64 {
	if f.max > 0 {
		return f.max
	}
	return 25 << 20
}
func (f *fakeProvider) Transcribe(_ context.Context, _, _ string, r io.Reader) (transcribe.Result, error) {
	f.calls++
	f.got, _ = io.ReadAll(r)
	return f.res, f.err
}

type env struct {
	db     *testdb.DB
	svc    *media.Service
	disk   *storage.Local
	worker *media.TranscribeWorker
	prov   *fakeProvider
	admin  store.Tenant
	member store.Tenant
	other  store.Tenant // a second member
	viewer store.Tenant
	now    time.Time
}

func addMember(t *testing.T, db *testdb.DB, ws uuid.UUID, role store.Role) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: role}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: ten.UserID, Role: string(role)})
	}); err != nil {
		t.Fatal(err)
	}
	return ten
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	db.EnableRiver(t)
	disk := &storage.Local{Dir: t.TempDir()}
	prov := &fakeProvider{}
	e := &env{db: db, disk: disk, prov: prov, now: time.Now()}
	e.worker = &media.TranscribeWorker{Pool: db.Backend, Store: disk, Provider: prov}
	workers := river.NewWorkers()
	river.AddWorker(workers, &intake.ExtractWorker{Pool: db.Backend})
	river.AddWorker(workers, e.worker)
	jc, err := jobs.NewClient(db.Backend, workers, nil)
	if err != nil {
		t.Fatal(err)
	}
	e.worker.Jobs = jc
	e.svc = &media.Service{Pool: db.Backend, Jobs: jc, Store: disk, Now: func() time.Time { return e.now }}
	ws := uuid.New()
	e.admin = store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, e.admin, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ws, Name: "Acme"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: e.admin.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	e.member = addMember(t, db, ws, store.RoleMember)
	e.other = addMember(t, db, ws, store.RoleMember)
	e.viewer = addMember(t, db, ws, store.RoleViewer)
	return e
}

func wav(n int) []byte {
	b := append([]byte("RIFF\x00\x00\x00\x00WAVEfmt "), bytes.Repeat([]byte{7}, n)...)
	return b
}

// upload sends data in pieces of `piece` bytes and completes it.
func (e *env) upload(t *testing.T, ten store.Tenant, name, mime string, data []byte, piece int) media.Upload {
	t.Helper()
	u, err := e.svc.Start(ctx, ten, name, mime, int64(len(data)), nil)
	if err != nil {
		t.Fatal(err)
	}
	for off := 0; off < len(data); off += piece {
		end := min(off+piece, len(data))
		if u, err = e.svc.Append(ctx, ten, u.ID, int64(off), bytes.NewReader(data[off:end])); err != nil {
			t.Fatal(err)
		}
	}
	if u, err = e.svc.Complete(ctx, ten, u.ID); err != nil {
		t.Fatal(err)
	}
	return u
}

func (e *env) runJob(t *testing.T, ten store.Tenant, id uuid.UUID, attempt, max int) error {
	t.Helper()
	return e.worker.Work(ctx, &river.Job[media.TranscribeArgs]{
		JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: max},
		Args:   media.TranscribeArgs{WorkspaceID: ten.WorkspaceID, MediaID: id, UserID: ten.UserID},
	})
}

func (e *env) count(t *testing.T, sql string, args ...any) (n int) {
	t.Helper()
	if err := e.db.Super.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return
}

func TestAnUploadCanBeInterruptedAndResumed(t *testing.T) {
	e := setup(t)
	data := wav(10_000)
	u, err := e.svc.Start(ctx, e.member, "call.wav", "audio/wav", int64(len(data)), nil)
	if err != nil || u.State != "uploading" || u.ReceivedBytes != 0 {
		t.Fatalf("%v %+v", err, u)
	}
	if _, err := e.svc.Append(ctx, e.member, u.ID, 0, bytes.NewReader(data[:4000])); err != nil {
		t.Fatal(err)
	}
	// The connection drops after chunk 1; the client retries chunk 1 and is told where to continue.
	got, err := e.svc.Append(ctx, e.member, u.ID, 0, bytes.NewReader(data[:4000]))
	if !errors.Is(err, media.ErrOffset) || got.ReceivedBytes != 4000 {
		t.Fatalf("retry of a stored chunk: %v %+v", err, got)
	}
	if _, err := e.svc.Append(ctx, e.member, u.ID, 9000, bytes.NewReader(data[9000:])); !errors.Is(err, media.ErrOffset) {
		t.Fatalf("skipped chunk: %v", err)
	}
	// Completing early is refused with the real numbers.
	if _, err := e.svc.Complete(ctx, e.member, u.ID); !errors.As(err, new(media.ErrConflict)) || !strings.Contains(err.Error(), "4000 of 10016") {
		t.Fatalf("early complete: %v", err)
	}
	cur, _ := e.svc.Get(ctx, e.member, u.ID)
	if cur.ReceivedBytes != 4000 {
		t.Fatalf("position: %d", cur.ReceivedBytes)
	}
	if _, err := e.svc.Append(ctx, e.member, u.ID, 4000, bytes.NewReader(data[4000:])); err != nil {
		t.Fatal(err)
	}
	done, err := e.svc.Complete(ctx, e.member, u.ID)
	if err != nil || done.State != "uploaded" {
		t.Fatalf("%v %+v", err, done)
	}
	// Transcription is heavy, so it goes to the research queue, away from email sending.
	if n := e.count(t, `SELECT count(*) FROM river.river_job WHERE kind='transcribe_media' AND queue='research' AND args->>'media_id'=$1`, u.ID.String()); n != 1 {
		t.Fatalf("transcription job not on the research queue: %d", n)
	}
	// Completing twice is harmless and queues one job only.
	if _, err := e.svc.Complete(ctx, e.member, u.ID); err != nil {
		t.Fatal(err)
	}
	if n := e.count(t, `SELECT count(*) FROM river.river_job WHERE kind='transcribe_media' AND args->>'media_id'=$1`, u.ID.String()); n != 1 {
		t.Fatalf("transcription jobs: %d", n)
	}
	o, _, err := e.svc.Open(ctx, e.viewer, u.ID) // anyone in the workspace can play it
	if err != nil {
		t.Fatal(err)
	}
	defer o.Close()
	b, _ := io.ReadAll(o)
	if !bytes.Equal(b, data) {
		t.Fatal("stored bytes differ from what was sent")
	}
	// More bytes after completion are refused.
	if _, err := e.svc.Append(ctx, e.member, u.ID, int64(len(data)), strings.NewReader("x")); !errors.As(err, new(media.ErrConflict)) {
		t.Fatalf("append after complete: %v", err)
	}
}

func TestStorageAheadOfTheDatabaseIsReconciled(t *testing.T) {
	e := setup(t)
	data := wav(3000)
	u, _ := e.svc.Start(ctx, e.member, "a.wav", "audio/wav", int64(len(data)), nil)
	// The first chunk reached storage but the database commit was lost.
	var key string
	_ = e.db.Super.QueryRow(ctx, `SELECT storage_key FROM media WHERE id=$1`, u.ID).Scan(&key)
	if _, err := e.disk.Append(ctx, key, 0, bytes.NewReader(data[:1000])); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.Append(ctx, e.member, u.ID, 0, bytes.NewReader(data[:1000]))
	if !errors.Is(err, media.ErrOffset) || got.ReceivedBytes != 1000 {
		t.Fatalf("the client must be told to continue at 1000: %v %+v", err, got)
	}
	if _, err := e.svc.Append(ctx, e.member, u.ID, 1000, bytes.NewReader(data[1000:])); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Complete(ctx, e.member, u.ID); err != nil {
		t.Fatal(err)
	}
}

func TestBadUploadsAreRefusedBeforeAnythingIsKept(t *testing.T) {
	e := setup(t)
	inv := func(err error) bool { return errors.As(err, new(media.ErrInvalid)) }
	for name, c := range map[string]struct {
		file, mime string
		size       int64
	}{
		"not audio":      {"x.exe", "application/octet-stream", 10},
		"script":         {"x.html", "text/html", 10},
		"name mismatch":  {"call.mp3", "audio/wav", 10},
		"no extension":   {"call", "audio/wav", 10},
		"empty":          {"a.wav", "audio/wav", 0},
		"negative":       {"a.wav", "audio/wav", -5},
		"over the limit": {"a.wav", "audio/wav", 2 << 30},
		"empty name":     {"  ", "audio/wav", 10},
		"long name":      {strings.Repeat("a", 300) + ".wav", "audio/wav", 10},
	} {
		if _, err := e.svc.Start(ctx, e.member, c.file, c.mime, c.size, nil); !inv(err) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := e.svc.Start(ctx, e.viewer, "a.wav", "audio/wav", 10, nil); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer: %v", err)
	}
	// Path tricks in the name are reduced to a plain name; the stored key never contains them.
	u, err := e.svc.Start(ctx, e.member, `../../etc/passwd/..\evil.wav`, "audio/wav; charset=x", 10, nil)
	if err != nil || u.Filename != "evil.wav" {
		t.Fatalf("%v %+v", err, u)
	}
	var key string
	_ = e.db.Super.QueryRow(ctx, `SELECT storage_key FROM media WHERE id=$1`, u.ID).Scan(&key)
	if storage.CheckKey(key) != nil || strings.Contains(key, "evil") {
		t.Errorf("key: %q", key)
	}
	// The bytes must look like what the name claims.
	mp3, _ := e.svc.Start(ctx, e.member, "talk.mp3", "audio/mpeg", 100, nil)
	if _, err := e.svc.Append(ctx, e.member, mp3.ID, 0, bytes.NewReader(wav(100)[:100])); !inv(err) {
		t.Fatalf("wav bytes as mp3: %v", err)
	}
	if keys, _ := e.disk.Keys(ctx); len(keys) != 0 {
		// the wav-as-mp3 chunk must not remain on disk
		var k string
		_ = e.db.Super.QueryRow(ctx, `SELECT storage_key FROM media WHERE id=$1`, mp3.ID).Scan(&k)
		for _, kk := range keys {
			if kk == k {
				if sz, _ := e.disk.Size(ctx, k); sz != 0 {
					t.Errorf("refused bytes were kept: %d", sz)
				}
			}
		}
	}
	// A chunk may not run past the declared size.
	short, _ := e.svc.Start(ctx, e.member, "s.wav", "audio/wav", 50, nil)
	if _, err := e.svc.Append(ctx, e.member, short.ID, 0, bytes.NewReader(wav(100))); !inv(err) {
		t.Fatalf("overlong chunk: %v", err)
	}
	if got, _ := e.svc.Get(ctx, e.member, short.ID); got.ReceivedBytes != 0 {
		t.Fatalf("an overlong chunk was partly kept: %d", got.ReceivedBytes)
	}
	if _, err := e.svc.Append(ctx, e.member, short.ID, 0, bytes.NewReader(nil)); !inv(err) {
		t.Fatalf("empty chunk: %v", err)
	}
}

func TestOnlyTheUploaderOrAnAdminTouchesAnUpload_AndWorkspacesAreIsolated(t *testing.T) {
	e := setup(t)
	data := wav(500)
	u, _ := e.svc.Start(ctx, e.member, "a.wav", "audio/wav", int64(len(data)), nil)
	if _, err := e.svc.Append(ctx, e.other, u.ID, 0, bytes.NewReader(data)); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("another member appended: %v", err)
	}
	if _, err := e.svc.Append(ctx, e.viewer, u.ID, 0, bytes.NewReader(data)); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer appended: %v", err)
	}
	if err := e.svc.Delete(ctx, e.other, u.ID); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("another member deleted: %v", err)
	}
	// A different workspace cannot even see it.
	ws2 := uuid.New()
	stranger := store.Tenant{WorkspaceID: ws2, UserID: uuid.New(), Role: store.RoleAdmin}
	_ = store.WithTenant(ctx, e.db.Backend, stranger, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ws2, Name: "Other"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws2, UserID: stranger.UserID, Role: "admin"})
	})
	if _, err := e.svc.Get(ctx, stranger, u.ID); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("cross-tenant get: %v", err)
	}
	if _, err := e.svc.Append(ctx, stranger, u.ID, 0, bytes.NewReader(data)); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("cross-tenant append: %v", err)
	}
	if err := e.svc.Delete(ctx, stranger, u.ID); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("cross-tenant delete: %v", err)
	}
	if list, _ := e.svc.List(ctx, stranger); len(list) != 0 {
		t.Errorf("cross-tenant list: %+v", list)
	}
	// The admin can.
	if _, err := e.svc.Append(ctx, e.admin, u.ID, 0, bytes.NewReader(data)); err != nil {
		t.Errorf("admin append: %v", err)
	}
}

func TestLimitsOnOpenUploadsAndDailyVolume(t *testing.T) {
	e := setup(t)
	e.svc.OpenUploads = 2
	e.svc.DailyBytes = 1000
	for i := 0; i < 2; i++ {
		if _, err := e.svc.Start(ctx, e.member, fmt.Sprintf("a%d.wav", i), "audio/wav", 100, nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.svc.Start(ctx, e.member, "c.wav", "audio/wav", 100, nil); !errors.As(err, new(media.ErrQuota)) {
		t.Errorf("open upload limit: %v", err)
	}
	e2 := setup(t)
	e2.svc.DailyBytes = 1000
	if _, err := e2.svc.Start(ctx, e2.member, "big.wav", "audio/wav", 600, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := e2.svc.Start(ctx, e2.member, "big2.wav", "audio/wav", 600, nil); !errors.As(err, new(media.ErrQuota)) {
		t.Errorf("daily limit: %v", err)
	}
}

func TestAbandonedUploadsAreRemovedWithTheirFiles(t *testing.T) {
	e := setup(t)
	data := wav(800)
	stale, _ := e.svc.Start(ctx, e.member, "stale.wav", "audio/wav", int64(len(data)), nil)
	_, _ = e.svc.Append(ctx, e.member, stale.ID, 0, bytes.NewReader(data[:300]))
	finished := e.upload(t, e.member, "ok.wav", "audio/wav", data, 400)

	if n, err := e.svc.CleanupExpired(ctx); err != nil || n != 0 {
		t.Fatalf("nothing is old yet: %d %v", n, err)
	}
	e.now = e.now.Add(48 * time.Hour)
	// (The database is shared with other tests, whose abandoned uploads also expire; ours must be among them.)
	if n, err := e.svc.CleanupExpired(ctx); err != nil || n < 1 {
		t.Fatalf("expected the abandoned upload to go: %d %v", n, err)
	}
	if _, err := e.svc.Get(ctx, e.member, stale.ID); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("stale upload still exists: %v", err)
	}
	if _, err := e.svc.Get(ctx, e.member, finished.ID); err != nil {
		t.Errorf("a finished upload was removed: %v", err)
	}
	if orphans, err := e.svc.Orphans(ctx); err != nil || len(orphans) != 0 {
		t.Fatalf("orphaned files: %v %v", orphans, err)
	}
	// A file with no row is reported.
	stray := storage.Key(uuid.New(), uuid.New())
	_, _ = e.disk.Append(ctx, stray, 0, strings.NewReader("x"))
	if orphans, _ := e.svc.Orphans(ctx); len(orphans) != 1 || orphans[0] != stray {
		t.Fatalf("stray file not found: %v", orphans)
	}
}
