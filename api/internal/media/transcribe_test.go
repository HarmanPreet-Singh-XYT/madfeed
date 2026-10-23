package media_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"product/api/internal/media"
	"product/api/internal/storage"
	"product/api/internal/store"
	"product/api/internal/transcribe"
)

func segs() transcribe.Result {
	return transcribe.Result{DurationMS: 31_000, Model: "whisper-1", Segments: []transcribe.Segment{
		{StartMS: 0, EndMS: 4000, Speaker: "Priya", Text: "We can't roll this out without single sign-on."},
		{StartMS: 4000, EndMS: 9500, Speaker: "Sam", Text: "Understood — café ☕ budget is fine\nnext quarter."},
		{StartMS: 9500, EndMS: 31_000, Text: "Also the CSV export is painful."},
	}}
}

func (e *env) transcribed(t *testing.T) (media.Upload, uuid.UUID) {
	t.Helper()
	e.prov.res, e.prov.err = segs(), nil
	u := e.upload(t, e.member, "Interview 1.mp3", "audio/mpeg", append([]byte("ID3"), make([]byte, 600)...), 300)
	if err := e.runJob(t, e.member, u.ID, 1, 3); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.Get(ctx, e.member, u.ID)
	if err != nil || got.SourceItemID == nil {
		t.Fatalf("%v %+v", err, got)
	}
	return got, *got.SourceItemID
}

func TestATranscriptBecomesAnOrdinarySourceWithTimedSegments(t *testing.T) {
	e := setup(t)
	got, src := e.transcribed(t)
	if got.State != "done" || got.DurationMS != 31_000 {
		t.Fatalf("%+v", got)
	}
	if e.prov.calls != 1 || len(e.prov.got) != 603 {
		t.Fatalf("the provider got %d bytes in %d calls", len(e.prov.got), e.prov.calls)
	}
	var kind, title, text string
	if err := e.db.Super.QueryRow(ctx, `SELECT kind, title, raw_text FROM source_item WHERE id=$1`, src).Scan(&kind, &title, &text); err != nil {
		t.Fatal(err)
	}
	want := "Priya: We can't roll this out without single sign-on.\nSam: Understood — café ☕ budget is fine next quarter.\nAlso the CSV export is painful."
	if kind != "recording" || title != "Interview 1" || text != want {
		t.Fatalf("%q %q %q", kind, title, text)
	}
	mid, ss, err := e.svc.Segments(ctx, e.viewer, src)
	if err != nil || mid != got.ID || len(ss) != 3 {
		t.Fatalf("%v %v %+v", err, mid, ss)
	}
	// Each segment's byte span is exactly its line, and times follow the recording.
	lines := strings.Split(want, "\n")
	for i, s := range ss {
		if text[s.SpanStart:s.SpanEnd] != lines[i] {
			t.Errorf("segment %d span covers %q, want %q", i, text[s.SpanStart:s.SpanEnd], lines[i])
		}
	}
	if ss[1].StartMS != 4000 || ss[1].Speaker != "Sam" || ss[2].StartMS != 9500 || ss[2].EndMS != 31_000 {
		t.Fatalf("%+v", ss)
	}
	// Chunks tile the text, and extraction was queued for it: quotes, highlights and Q&A all work from here.
	var tiled int
	_ = e.db.Super.QueryRow(ctx, `SELECT coalesce(sum(end_offset-start_offset),0) FROM chunk WHERE source_item_id=$1`, src).Scan(&tiled)
	if tiled != len(text) {
		t.Errorf("chunks cover %d of %d bytes", tiled, len(text))
	}
	if n := e.count(t, `SELECT count(*) FROM river.river_job WHERE kind='extract_source_item' AND args->>'source_item_id'=$1`, src.String()); n != 1 {
		t.Errorf("extraction jobs: %d", n)
	}
	if n := e.count(t, `SELECT count(*) FROM ai_event WHERE workspace_id=$1 AND task='transcription' AND outcome='ok'`, e.admin.WorkspaceID); n < 1 {
		t.Error("no audit event for the transcription")
	}
	// Quotes on a transcript keep the verbatim guarantee, down to the byte.
	quote := "single sign-on"
	i := strings.Index(text, quote)
	var chunk uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `SELECT id FROM chunk WHERE source_item_id=$1 ORDER BY ordinal LIMIT 1`, src).Scan(&chunk)
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO highlight (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		e.admin.WorkspaceID, src, chunk, i, i+len(quote), quote, e.admin.UserID); err != nil {
		t.Fatal(err)
	}
	// A highlight maps back to the moment it was said.
	var startMS int
	_ = e.db.Super.QueryRow(ctx, `SELECT start_ms FROM segment WHERE source_item_id=$1 AND span_start <= $2 ORDER BY span_start DESC LIMIT 1`, src, i).Scan(&startMS)
	if startMS != 0 {
		t.Errorf("the quote is in the first segment, got start %d", startMS)
	}
	// Running the job again changes nothing.
	if err := e.runJob(t, e.member, got.ID, 2, 3); err != nil {
		t.Fatal(err)
	}
	if e.prov.calls != 1 || e.count(t, `SELECT count(*) FROM source_item WHERE kind='recording' AND workspace_id=$1`, e.admin.WorkspaceID) != 1 {
		t.Error("a repeated job transcribed or stored twice")
	}
	// Segments of a source that is not a recording are not found.
	var paste uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste','x',$2,$3) RETURNING id`, e.admin.WorkspaceID, uuid.NewString(), e.admin.UserID).Scan(&paste)
	if _, _, err := e.svc.Segments(ctx, e.member, paste); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("%v", err)
	}
}

func TestTranscriptionFailuresAreExplainedAndNotRetriedWhenRetryCannotHelp(t *testing.T) {
	data := append([]byte("ID3"), make([]byte, 100)...)
	fileCases := map[string]struct {
		err  error
		text string
	}{
		"vendor says too big":  {transcribe.ErrTooLarge, "too large"},
		"cannot read the file": {transcribe.ErrUnsupported, "could not read"},
		"no speech":            {transcribe.ErrEmpty, "No speech"},
	}
	for name, c := range fileCases {
		e := setup(t)
		e.prov.err = c.err
		u := e.upload(t, e.member, "a.mp3", "audio/mpeg", data, 50)
		err := e.runJob(t, e.member, u.ID, 1, 3)
		var cancel *river.JobCancelError
		if !errors.As(err, &cancel) {
			t.Errorf("%s: want a cancel (no retry), got %v", name, err)
		}
		got, _ := e.svc.Get(ctx, e.member, u.ID)
		if got.State != "failed" || !strings.Contains(got.FailureReason, c.text) {
			t.Errorf("%s: %+v", name, got)
		}
		if n := e.count(t, `SELECT count(*) FROM source_item WHERE kind='recording' AND workspace_id=$1`, e.admin.WorkspaceID); n != 0 {
			t.Errorf("%s: a failed recording created a source", name)
		}
	}

	// A temporary failure retries, and only marks the file failed on the last attempt.
	e := setup(t)
	e.prov.err = transcribe.ErrUnavailable
	u := e.upload(t, e.member, "a.mp3", "audio/mpeg", data, 50)
	if err := e.runJob(t, e.member, u.ID, 1, 3); !errors.Is(err, transcribe.ErrUnavailable) {
		t.Fatalf("first attempt: %v", err)
	}
	if got, _ := e.svc.Get(ctx, e.member, u.ID); got.State != "transcribing" {
		t.Fatalf("between attempts: %s", got.State)
	}
	if err := e.runJob(t, e.member, u.ID, 3, 3); err == nil {
		t.Fatal("last attempt should still report the error")
	}
	if got, _ := e.svc.Get(ctx, e.member, u.ID); got.State != "failed" || !strings.Contains(got.FailureReason, "try again later") {
		t.Fatalf("after the last attempt: %+v", got)
	}
	// ... and then it recovers on a later success without duplicating anything.
	e.prov.res, e.prov.err = segs(), nil
	got, _ := e.svc.Get(ctx, e.member, u.ID)
	if got.State != "failed" {
		t.Fatal("setup")
	}

	// Over the vendor's size limit: never sent.
	e2 := setup(t)
	e2.prov.max = 10
	u2 := e2.upload(t, e2.member, "big.mp3", "audio/mpeg", data, 50)
	if err := e2.runJob(t, e2.member, u2.ID, 1, 3); err == nil {
		t.Error("expected a cancel")
	}
	if got, _ := e2.svc.Get(ctx, e2.member, u2.ID); got.State != "failed" || e2.prov.calls != 0 || !strings.Contains(got.FailureReason, "too large") {
		t.Errorf("%+v calls=%d", got, e2.prov.calls)
	}

	// No provider configured: the job waits instead of failing.
	e3 := setup(t)
	e3.worker.Provider = nil
	u3 := e3.upload(t, e3.member, "a.mp3", "audio/mpeg", data, 50)
	err := e3.worker.Work(ctx, &river.Job[media.TranscribeArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: media.TranscribeArgs{WorkspaceID: e3.admin.WorkspaceID, MediaID: u3.ID, UserID: e3.member.UserID}})
	var snooze *river.JobSnoozeError
	if !errors.As(err, &snooze) {
		t.Errorf("want a snooze, got %v", err)
	}
	if got, _ := e3.svc.Get(ctx, e3.member, u3.ID); got.State != "uploaded" {
		t.Errorf("a waiting recording changed state: %s", got.State)
	}

	// A recording deleted while the job waits is simply skipped.
	e4 := setup(t)
	e4.prov.res = segs()
	u4 := e4.upload(t, e4.member, "a.mp3", "audio/mpeg", data, 50)
	if err := e4.svc.Delete(ctx, e4.member, u4.ID); err != nil {
		t.Fatal(err)
	}
	if err := e4.runJob(t, e4.member, u4.ID, 1, 3); err != nil || e4.prov.calls != 0 {
		t.Errorf("%v calls=%d", err, e4.prov.calls)
	}
}

func TestATranscriptTooLongToAnalyseIsRefusedWithAReason(t *testing.T) {
	e := setup(t)
	long := strings.Repeat("word ", 1000)
	var ss []transcribe.Segment
	for i := 0; i < 100; i++ {
		ss = append(ss, transcribe.Segment{StartMS: i * 1000, EndMS: i*1000 + 900, Text: long})
	}
	e.prov.res = transcribe.Result{Segments: ss, DurationMS: 100_000}
	u := e.upload(t, e.member, "long.mp3", "audio/mpeg", append([]byte("ID3"), make([]byte, 50)...), 40)
	_ = e.runJob(t, e.member, u.ID, 1, 3)
	got, _ := e.svc.Get(ctx, e.member, u.ID)
	if got.State != "failed" || !strings.Contains(got.FailureReason, "too long") {
		t.Fatalf("%+v", got)
	}
}

func TestDeletingARecordingRemovesEverythingBuiltOnIt(t *testing.T) {
	e := setup(t)
	got, src := e.transcribed(t)
	ws := e.admin.WorkspaceID
	text := ""
	_ = e.db.Super.QueryRow(ctx, `SELECT raw_text FROM source_item WHERE id=$1`, src).Scan(&text)
	quote := "CSV export is painful"
	i := strings.Index(text, quote)
	var chunk, req, person uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `SELECT id FROM chunk WHERE source_item_id=$1 ORDER BY ordinal LIMIT 1`, src).Scan(&chunk)
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'CSV export') RETURNING id`, ws).Scan(&req)
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email) VALUES ($1,'Priya','priya@acme.com') RETURNING id`, ws).Scan(&person)
	for _, q := range []string{
		`INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
	} {
		if _, err := e.db.Super.Exec(ctx, q, ws, req, src, chunk, person, quote, i, i+len(quote), e.admin.UserID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO highlight (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, ws, src, chunk, i, i+len(quote), quote, e.admin.UserID); err != nil {
		t.Fatal(err)
	}
	if n := e.count(t, `SELECT evidence_count FROM request_impact WHERE request_id=$1`, req); n != 1 {
		t.Fatalf("impact before: %d", n)
	}
	var key string
	_ = e.db.Super.QueryRow(ctx, `SELECT storage_key FROM media WHERE id=$1`, got.ID).Scan(&key)
	if _, err := e.disk.Size(ctx, key); err != nil {
		t.Fatal("the file should exist")
	}

	if err := e.svc.Delete(ctx, e.viewer, got.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer: %v", err)
	}
	if err := e.svc.Delete(ctx, e.member, got.ID); err != nil {
		t.Fatal(err)
	}
	for table, where := range map[string]string{"media": "id", "source_item": "id", "chunk": "source_item_id", "segment": "source_item_id", "evidence": "source_item_id", "highlight": "source_item_id"} {
		id := src
		if table == "media" {
			id = got.ID
		}
		if n := e.count(t, "SELECT count(*) FROM "+table+" WHERE "+where+"=$1", id); n != 0 {
			t.Errorf("%s still has %d rows", table, n)
		}
	}
	if _, err := e.disk.Size(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("the stored file is still there: %v", err)
	}
	if n := e.count(t, `SELECT evidence_count FROM request_impact WHERE request_id=$1`, req); n != 0 {
		t.Errorf("impact after: %d (should have dropped with the quote)", n)
	}
	if orphans, _ := e.svc.Orphans(ctx); len(orphans) != 0 {
		t.Errorf("orphans: %v", orphans)
	}
	if err := e.svc.Delete(ctx, e.member, got.ID); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
}

func TestDeletingAPersonRemovesTheirWordsRecordingsAndMessagesButKeepsTheirOptOut(t *testing.T) {
	e := setup(t)
	e.prov.res = segs()
	ws := e.admin.WorkspaceID
	var person, other, req uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email) VALUES ($1,'Priya','priya@acme.com') RETURNING id`, ws).Scan(&person)
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email) VALUES ($1,'Sam','sam@acme.com') RETURNING id`, ws).Scan(&other)
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'SSO') RETURNING id`, ws).Scan(&req)

	// Priya's recording, and a paste of hers, and a quote of hers inside Sam's conversation.
	u, err := e.svc.Start(ctx, e.member, "priya.mp3", "audio/mpeg", 103, &person)
	if err != nil {
		t.Fatal(err)
	}
	data := append([]byte("ID3"), make([]byte, 100)...)
	_, _ = e.svc.Append(ctx, e.member, u.ID, 0, strings.NewReader(string(data)))
	_, _ = e.svc.Complete(ctx, e.member, u.ID)
	if err := e.runJob(t, e.member, u.ID, 1, 3); err != nil {
		t.Fatal(err)
	}
	var samSrc, chunk uuid.UUID
	text := "Sam: Priya said she needs single sign-on."
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, person_id, created_by) VALUES ($1,'paste',$2,$3,$4,$5) RETURNING id`, ws, text, uuid.NewString(), other, e.admin.UserID).Scan(&samSrc)
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, samSrc, len(text), text).Scan(&chunk)
	q := "needs single sign-on"
	i := strings.Index(text, q)
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ws, req, samSrc, chunk, person, q, i, i+len(q), e.admin.UserID); err != nil {
		t.Fatal(err)
	}
	var batch uuid.UUID
	_ = e.db.Super.QueryRow(ctx, `INSERT INTO outreach_batch (workspace_id, request_id, created_by) VALUES ($1,$2,$3) RETURNING id`, ws, req, e.admin.UserID).Scan(&batch)
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email, evidence_ids, state, subject, body) VALUES ($1,$2,$3,$4,'priya@acme.com','{}','draft','s','Hi Priya')`, ws, batch, req, person); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO suppression (workspace_id, email, reason) VALUES ($1,'priya@acme.com','unsubscribed')`, ws); err != nil {
		t.Fatal(err)
	}

	if err := e.svc.DeletePerson(ctx, e.member, person); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("member deleted a person: %v", err)
	}
	if err := e.svc.DeletePerson(ctx, e.admin, uuid.New()); !errors.Is(err, media.ErrNotFound) {
		t.Fatalf("unknown person: %v", err)
	}
	if err := e.svc.DeletePerson(ctx, e.admin, person); err != nil {
		t.Fatal(err)
	}
	for name, sql := range map[string]string{
		"person":       `SELECT count(*) FROM person WHERE id=$1`,
		"her sources":  `SELECT count(*) FROM source_item WHERE person_id=$1`,
		"her quotes":   `SELECT count(*) FROM evidence WHERE person_id=$1`,
		"her messages": `SELECT count(*) FROM outreach_message WHERE person_id=$1`,
	} {
		if n := e.count(t, sql, person); n != 0 {
			t.Errorf("%s: %d left", name, n)
		}
	}
	if n := e.count(t, `SELECT count(*) FROM media WHERE workspace_id=$1 AND uploaded_by IS NOT NULL AND filename='priya.mp3'`, ws); n != 0 {
		t.Errorf("her recording row remains")
	}
	if keys, _ := e.disk.Keys(ctx); len(keys) != 0 {
		t.Errorf("stored files remain: %v", keys)
	}
	// Sam, his conversation and the request survive; the request lost Priya's quote.
	if n := e.count(t, `SELECT count(*) FROM person WHERE id=$1`, other) + e.count(t, `SELECT count(*) FROM source_item WHERE id=$1`, samSrc) + e.count(t, `SELECT count(*) FROM request WHERE id=$1`, req); n != 3 {
		t.Errorf("collateral damage: %d of 3 survive", n)
	}
	if n := e.count(t, `SELECT evidence_count FROM request_impact WHERE request_id=$1`, req); n != 0 {
		t.Errorf("impact still counts her quote: %d", n)
	}
	// The opt-out stays, so nobody can write to that address again.
	if n := e.count(t, `SELECT count(*) FROM suppression WHERE workspace_id=$1 AND email='priya@acme.com'`, ws); n != 1 {
		t.Errorf("the opt-out was removed")
	}
	if orphans, _ := e.svc.Orphans(ctx); len(orphans) != 0 {
		t.Errorf("orphans: %v", orphans)
	}
}

func TestSecretsReadOutInARecordingAreNotStored(t *testing.T) {
	e := setup(t)
	e.prov.res = transcribe.Result{DurationMS: 30_000, Model: "m", Segments: []transcribe.Segment{
		{StartMS: 0, EndMS: 5000, Speaker: "Priya", Text: "We need single sign-on."},
		{StartMS: 5000, EndMS: 10_000, Speaker: "Priya", Text: "My card is 4111 1111 1111 1111 and the key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789."},
		{StartMS: 10_000, EndMS: 15_000, Speaker: "Priya", Text: "Another card, 5555 5555"}, // split across two segments
		{StartMS: 15_000, EndMS: 20_000, Speaker: "Priya", Text: "5555 4444, thanks."},
	}}
	u := e.upload(t, e.member, "call.mp3", "audio/mpeg", append([]byte("ID3"), make([]byte, 200)...), 100)
	if err := e.runJob(t, e.member, u.ID, 1, 3); err != nil {
		t.Fatal(err)
	}
	got, _ := e.svc.Get(ctx, e.member, u.ID)
	if got.SourceItemID == nil {
		t.Fatalf("%+v", got)
	}
	var text string
	var hidden int
	_ = e.db.Super.QueryRow(ctx, `SELECT raw_text, redactions FROM source_item WHERE id=$1`, *got.SourceItemID).Scan(&text, &hidden)
	for _, leak := range []string{"4111", "sk-proj", "5555 5555", "5555 4444"} {
		if strings.Contains(text, leak) {
			t.Errorf("%q stored in %q", leak, text)
		}
	}
	if hidden < 2 || !strings.Contains(text, "We need single sign-on.") {
		t.Errorf("%d %q", hidden, text)
	}
	// Every segment still points at a real, non-empty part of the cleaned text.
	_, segs, err := e.svc.Segments(ctx, e.member, *got.SourceItemID)
	if err != nil || len(segs) == 0 {
		t.Fatalf("%v %v", err, segs)
	}
	for _, s := range segs {
		if s.SpanStart < 0 || s.SpanEnd > len(text) || s.SpanEnd <= s.SpanStart {
			t.Errorf("bad span %+v for text of %d bytes", s, len(text))
		}
	}
}
