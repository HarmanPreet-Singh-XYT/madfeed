package media_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/media"
	"product/api/internal/storage"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

func (e *env) person(t *testing.T, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := store.WithTenant(ctx, e.db.Backend, e.admin, func(q *dbgen.Queries) error {
		p, err := q.CreatePerson(ctx, dbgen.CreatePersonParams{
			WorkspaceID: e.admin.WorkspaceID,
			Name:        name,
			Email:       pgtype.Text{},
		})
		if err != nil {
			return err
		}
		id = p.ID
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestRenamingARecordingRenamesItsTranscript(t *testing.T) {
	e := setup(t)
	u, srcID := e.transcribed(t)

	name := "Renewal call with Priya"
	got, err := e.svc.Update(ctx, e.member, u.ID, &name, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != name {
		t.Fatalf("title: %q", got.Title)
	}
	var sourceTitle string
	if err := e.db.Super.QueryRow(ctx, `SELECT title FROM source_item WHERE id=$1`, srcID).Scan(&sourceTitle); err != nil {
		t.Fatal(err)
	}
	if sourceTitle != name {
		t.Fatalf("the transcript still says %q", sourceTitle)
	}

	// Saying who is speaking follows the same path, and reaches the transcript too.
	person := e.person(t, "Priya Shah")
	if _, err := e.svc.Update(ctx, e.member, u.ID, nil, &person); err != nil {
		t.Fatal(err)
	}
	var mediaPerson, sourcePerson uuid.NullUUID
	if err := e.db.Super.QueryRow(ctx, `SELECT person_id FROM media WHERE id=$1`, u.ID).Scan(&mediaPerson); err != nil {
		t.Fatal(err)
	}
	if err := e.db.Super.QueryRow(ctx, `SELECT person_id FROM source_item WHERE id=$1`, srcID).Scan(&sourcePerson); err != nil {
		t.Fatal(err)
	}
	if mediaPerson.UUID != person || sourcePerson.UUID != person {
		t.Fatalf("person: media %v, source %v", mediaPerson, sourcePerson)
	}
}

func TestRenamingIsGuarded(t *testing.T) {
	e := setup(t)
	u, _ := e.transcribed(t)
	name := "A new name"

	// Someone else's upload is theirs to rename; a viewer cannot at all.
	if _, err := e.svc.Update(ctx, e.other, u.ID, &name, nil); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("another member: %v", err)
	}
	if _, err := e.svc.Update(ctx, e.viewer, u.ID, &name, nil); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer: %v", err)
	}
	blank := "   "
	if _, err := e.svc.Update(ctx, e.member, u.ID, &blank, nil); !errors.As(err, new(media.ErrInvalid)) {
		t.Fatalf("blank name: %v", err)
	}
	if _, err := e.svc.Update(ctx, e.member, uuid.New(), &name, nil); !errors.Is(err, media.ErrNotFound) {
		t.Fatalf("unknown recording: %v", err)
	}
}

func TestALibraryPageCanBeSearchedAndContinued(t *testing.T) {
	e := setup(t)
	ids := make([]uuid.UUID, 0, 5)
	for i := 0; i < 5; i++ {
		u := e.upload(t, e.member, "call-"+string(rune('1'+i))+".wav", "audio/wav", wav(300), 300)
		ids = append(ids, u.ID)
	}
	// Ordered newest first, one minute apart, so paging is deterministic.
	for i, id := range ids {
		if _, err := e.db.Super.Exec(ctx, `UPDATE media SET created_at = now() - make_interval(mins => $2) WHERE id=$1`, id, i); err != nil {
			t.Fatal(err)
		}
	}
	priya := e.person(t, "Priya Shah")
	if _, err := e.svc.Update(ctx, e.member, ids[1], nil, &priya); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Super.Exec(ctx, `UPDATE media SET state='failed' WHERE id=$1`, ids[2]); err != nil {
		t.Fatal(err)
	}

	page1, next, err := e.svc.ListPage(ctx, e.member, media.ListOptions{Limit: 2})
	if err != nil || next == nil {
		t.Fatalf("%v next=%v", err, next)
	}
	if len(page1) != 2 || page1[0].ID != ids[0] || page1[1].ID != ids[1] {
		t.Fatalf("page 1: %+v", page1)
	}
	page2, next2, err := e.svc.ListPage(ctx, e.member, media.ListOptions{Limit: 2, Cursor: next})
	if err != nil || len(page2) != 2 || page2[0].ID != ids[2] || page2[1].ID != ids[3] {
		t.Fatalf("page 2: %v %+v", err, page2)
	}
	page3, next3, err := e.svc.ListPage(ctx, e.member, media.ListOptions{Limit: 2, Cursor: next2})
	if err != nil || len(page3) != 1 || page3[0].ID != ids[4] || next3 != nil {
		t.Fatalf("page 3: %v %+v next=%v", err, page3, next3)
	}

	// Search by file name, and by the person's name rather than the file's.
	byName, _, err := e.svc.ListPage(ctx, e.member, media.ListOptions{Q: "call-3"})
	if err != nil || len(byName) != 1 || byName[0].ID != ids[2] {
		t.Fatalf("search by name: %v %+v", err, byName)
	}
	byPerson, _, err := e.svc.ListPage(ctx, e.member, media.ListOptions{Q: "Priya"})
	if err != nil || len(byPerson) != 1 || byPerson[0].ID != ids[1] {
		t.Fatalf("search by person: %v %+v", err, byPerson)
	}

	// "Needs attention" is the failed or unfinished ones; a state narrows further.
	attention, _, err := e.svc.ListPage(ctx, e.member, media.ListOptions{Attention: true})
	if err != nil || len(attention) != 1 || attention[0].ID != ids[2] {
		t.Fatalf("attention: %v %+v", err, attention)
	}
	uploaded, _, err := e.svc.ListPage(ctx, e.member, media.ListOptions{State: "uploaded"})
	if err != nil || len(uploaded) != 4 {
		t.Fatalf("uploaded: %v %+v", err, uploaded)
	}

	// A viewer reads the same library; a bad state is refused.
	if rows, _, err := e.svc.ListPage(ctx, e.viewer, media.ListOptions{Limit: 2}); err != nil || len(rows) != 2 {
		t.Fatalf("viewer: %v %+v", err, rows)
	}
	if _, _, err := e.svc.ListPage(ctx, e.member, media.ListOptions{State: "nonesuch"}); !errors.As(err, new(media.ErrInvalid)) {
		t.Fatalf("bad state: %v", err)
	}
}

func TestAFailedTranscriptionCanBeTriedAgain(t *testing.T) {
	e := setup(t)
	u := e.upload(t, e.member, "call.wav", "audio/wav", wav(600), 300)
	e.prov.err = errors.New("vendor is down")
	_ = e.runJob(t, e.member, u.ID, 3, 3)
	failed, err := e.svc.Get(ctx, e.member, u.ID)
	if err != nil || failed.State != "failed" {
		t.Fatalf("%v %+v", err, failed)
	}

	got, err := e.svc.Retry(ctx, e.member, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "uploaded" || got.FailureReason != "" {
		t.Fatalf("after retry: %+v", got)
	}
	if n := e.count(t, `SELECT count(*) FROM river.river_job WHERE kind='transcribe_media' AND args->>'media_id'=$1`, u.ID.String()); n != 2 {
		t.Fatalf("transcription jobs after retry: %d", n)
	}
	// Only a failed one can be retried, and only by someone who may write.
	if _, err := e.svc.Retry(ctx, e.member, u.ID); !errors.As(err, new(media.ErrConflict)) {
		t.Fatalf("retry of a healthy upload: %v", err)
	}
	if _, err := e.svc.Retry(ctx, e.other, u.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("another member: %v", err)
	}
	if _, err := e.svc.Retry(ctx, e.viewer, u.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer: %v", err)
	}
}

func TestDeletingARecordingCanBeUndoneForAMoment(t *testing.T) {
	e := setup(t)
	u, _ := e.transcribed(t)

	if err := e.svc.Delete(ctx, e.member, u.ID); err != nil {
		t.Fatal(err)
	}
	// Gone from the library, still readable by id, and one purge is waiting.
	rows, _, err := e.svc.ListPage(ctx, e.member, media.ListOptions{})
	if err != nil || len(rows) != 0 {
		t.Fatalf("the deleted recording is still listed: %v %+v", err, rows)
	}
	if got, err := e.svc.Get(ctx, e.member, u.ID); err != nil || got.ID != u.ID {
		t.Fatalf("deleted recording by id: %v %+v", err, got)
	}
	if err := e.svc.Delete(ctx, e.member, u.ID); err != nil {
		t.Fatalf("a second delete should be harmless: %v", err)
	}
	if n := e.count(t, `SELECT count(*) FROM river.river_job WHERE kind='purge_media' AND args->>'media_id'=$1`, u.ID.String()); n != 1 {
		t.Fatalf("purge jobs: %d", n)
	}

	// Too early to purge; and the window is honest about how long is left.
	if purged, wait, err := e.svc.Purge(ctx, e.admin, u.ID, media.UndoWindow); err != nil || purged || wait <= 0 {
		t.Fatalf("early purge: purged=%v wait=%v err=%v", purged, wait, err)
	}

	// Undo brings it back exactly as it was.
	if _, err := e.svc.Restore(ctx, e.other, u.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("another member: %v", err)
	}
	back, err := e.svc.Restore(ctx, e.member, u.ID)
	if err != nil || back.ID != u.ID {
		t.Fatalf("restore: %v %+v", err, back)
	}
	rows, _, err = e.svc.ListPage(ctx, e.member, media.ListOptions{})
	if err != nil || len(rows) != 1 || rows[0].ID != u.ID {
		t.Fatalf("after restore: %v %+v", err, rows)
	}
	// A purge that wakes up after an undo does nothing.
	if purged, wait, err := e.svc.Purge(ctx, e.admin, u.ID, media.UndoWindow); err != nil || purged || wait != 0 {
		t.Fatalf("purge after restore: purged=%v wait=%v err=%v", purged, wait, err)
	}
}

func TestARecordingIsPurgedAfterTheWindow(t *testing.T) {
	e := setup(t)
	u, src := e.transcribed(t)
	var key string
	if err := e.db.Super.QueryRow(ctx, `SELECT storage_key FROM media WHERE id=$1`, u.ID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Delete(ctx, e.member, u.ID); err != nil {
		t.Fatal(err)
	}
	e.now = e.now.Add(media.UndoWindow + time.Second)
	purged, _, err := e.svc.Purge(ctx, e.admin, u.ID, media.UndoWindow)
	if err != nil || !purged {
		t.Fatalf("purge: purged=%v err=%v", purged, err)
	}
	if _, err := e.svc.Get(ctx, e.member, u.ID); !errors.Is(err, media.ErrNotFound) {
		t.Fatalf("after purge: %v", err)
	}
	if n := e.count(t, `SELECT count(*) FROM source_item WHERE id=$1`, src); n != 0 {
		t.Fatalf("the transcript survived: %d", n)
	}
	if _, err := e.disk.Size(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("the stored file survived: %v", err)
	}
}
