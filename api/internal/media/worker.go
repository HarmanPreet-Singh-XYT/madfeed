package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/ai"
	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/redact"
	"product/api/internal/spans"
	"product/api/internal/storage"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/transcribe"
)

// PurgeMediaArgs removes a deleted recording after its undo window.
type PurgeMediaArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	MediaID     uuid.UUID `json:"media_id"`
}

func (PurgeMediaArgs) Kind() string { return "purge_media" }

// InsertOpts goes on the research queue: that is the worker that has the
// recording store, so it is the one that can delete the file.
func (PurgeMediaArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: jobs.QueueResearch}
}

// PurgeWorker deletes the file and the transcript once nobody can undo the delete any more.
type PurgeWorker struct {
	river.WorkerDefaults[PurgeMediaArgs]
	Pool  *pgxpool.Pool
	Store storage.Store
}

func (w *PurgeWorker) Work(ctx context.Context, job *river.Job[PurgeMediaArgs]) error {
	if w.Store == nil {
		return river.JobSnooze(time.Minute) // storage is not configured on this process; another worker will do it
	}
	t := store.Tenant{WorkspaceID: job.Args.WorkspaceID, Role: store.RoleAdmin}
	svc := &Service{Pool: w.Pool, Store: w.Store}
	purged, wait, err := svc.Purge(ctx, t, job.Args.MediaID, UndoWindow)
	if err != nil {
		return err
	}
	if !purged && wait > 0 {
		return river.JobSnooze(wait)
	}
	return nil
}

type TranscribeArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	MediaID     uuid.UUID `json:"media_id"`
	UserID      uuid.UUID `json:"user_id"`
}

func (TranscribeArgs) Kind() string { return "transcribe_media" }

// InsertOpts puts transcription on the research queue.
func (TranscribeArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: jobs.QueueResearch}
}

// MaxTranscriptBytes keeps one recording from creating a source too large to read or pay to analyse.
const MaxTranscriptBytes = 400_000

// TranscribeWorker reads the stored file, asks the provider for a transcript,
// and stores it as a text source plus its timed segments. With no Provider
// (no key configured) jobs wait instead of failing.
type TranscribeWorker struct {
	river.WorkerDefaults[TranscribeArgs]
	Pool       *pgxpool.Pool
	Store      storage.Store
	Provider   transcribe.Provider // nil: wait until one is configured
	Jobs       *river.Client[pgx.Tx]
	ChunkBytes int
	// Budget, when set, is asked before the vendor is called (and the work waits if the workspace has
	// used its AI allowance). PricePerMinuteUSD is what the vendor charges per audio minute, from
	// configuration; 0 means unknown, and the call is then recorded at no cost.
	Budget            ai.Budget
	PricePerMinuteUSD float64
}

func (w *TranscribeWorker) Work(ctx context.Context, job *river.Job[TranscribeArgs]) error {
	if w.Provider == nil {
		return river.JobSnooze(5 * time.Minute)
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleAdmin}
	if w.Budget != nil {
		if err := w.Budget.Check(store.WithContext(ctx, t)); errors.Is(err, ai.ErrBudgetExceeded) {
			return river.JobSnooze(30 * time.Minute) // the recording stays uploaded and is transcribed when the allowance frees up
		}
	}
	var m dbgen.Medium
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		var err error
		m, err = q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: a.WorkspaceID, ID: a.MediaID})
		if err != nil {
			return err
		}
		if m.DeletedAt.Valid {
			return nil // deleted while it waited; the purge job removes it
		}
		if m.State == "uploaded" || m.State == "transcribing" {
			return q.SetMediaState(ctx, dbgen.SetMediaStateParams{WorkspaceID: a.WorkspaceID, ID: a.MediaID, State: "transcribing"})
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // deleted while waiting
	}
	if err != nil {
		return err
	}
	if m.State != "uploaded" && m.State != "transcribing" || m.DeletedAt.Valid {
		return nil // done, failed or deleted: nothing to do
	}
	if m.SizeBytes > w.Provider.MaxBytes() {
		return w.fail(ctx, t, m.ID, fmt.Sprintf("This file is too large for the transcription service (limit %d MB). Upload a compressed copy such as MP3 or M4A.", w.Provider.MaxBytes()>>20))
	}
	obj, err := w.Store.Open(ctx, m.StorageKey)
	if err != nil {
		return w.fail(ctx, t, m.ID, "The uploaded file could not be found. Please upload it again.")
	}
	defer obj.Close()
	start := time.Now()
	res, err := w.Provider.Transcribe(ctx, m.Filename, m.MimeType, obj)
	switch {
	case errors.Is(err, transcribe.ErrTooLarge):
		return w.fail(ctx, t, m.ID, "This file is too large for the transcription service. Upload a compressed copy such as MP3 or M4A.")
	case errors.Is(err, transcribe.ErrUnsupported):
		return w.fail(ctx, t, m.ID, "The transcription service could not read this file. Try exporting it again as MP3 or M4A.")
	case errors.Is(err, transcribe.ErrEmpty):
		return w.fail(ctx, t, m.ID, "No speech was found in this recording.")
	case err != nil:
		if job.Attempt >= job.MaxAttempts {
			_ = w.fail(ctx, t, m.ID, "The transcription service did not respond. Please try again later.")
		}
		return err
	}
	text, segs, err := buildTranscript(res.Segments)
	if err != nil {
		return w.fail(ctx, t, m.ID, err.Error())
	}
	text, segs, hidden := redactTranscript(res.Segments, text, segs, res.DurationMS)
	clean := struct{ Total int }{hidden}
	chunkBytes := w.ChunkBytes
	if chunkBytes <= 0 {
		chunkBytes = intake.DefaultChunkBytes
	}
	sum := sha256.Sum256([]byte("recording:" + m.ID.String() + "\n" + text))
	return store.WithTenantTx(ctx, w.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		cur, err := q.GetMediaForUpdate(ctx, dbgen.GetMediaForUpdateParams{WorkspaceID: a.WorkspaceID, ID: a.MediaID})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if cur.State == "done" || cur.SourceItemID.Valid {
			return nil // a retry after success
		}
		title := strings.TrimSpace(cur.Title.String)
		if title == "" {
			title = strings.TrimSuffix(cur.Filename, extOf(cur.Filename))
		}
		item, err := q.InsertRecordingSource(ctx, dbgen.InsertRecordingSourceParams{WorkspaceID: a.WorkspaceID, Title: title,
			RawText: text, ContentHash: hex.EncodeToString(sum[:]), PersonID: cur.PersonID, CreatedBy: a.UserID, Redactions: int32(clean.Total)})
		if err != nil {
			return fmt.Errorf("store transcript: %w", err)
		}
		for _, c := range spans.Split(text, chunkBytes) {
			if _, err := q.InsertChunk(ctx, dbgen.InsertChunkParams{WorkspaceID: a.WorkspaceID, SourceItemID: item.ID, Ordinal: int32(c.Ordinal),
				StartOffset: int32(c.Start), EndOffset: int32(c.End), Text: c.Text}); err != nil {
				return fmt.Errorf("store chunk: %w", err)
			}
		}
		for i, s := range segs {
			if err := q.InsertSegment(ctx, dbgen.InsertSegmentParams{WorkspaceID: a.WorkspaceID, SourceItemID: item.ID, Ordinal: int32(i),
				StartMs: int32(s.StartMS), EndMs: int32(s.EndMS), Speaker: s.Speaker, SpanStart: int32(s.SpanStart), SpanEnd: int32(s.SpanEnd)}); err != nil {
				return fmt.Errorf("store segment: %w", err)
			}
		}
		if err := q.SetMediaDone(ctx, dbgen.SetMediaDoneParams{WorkspaceID: a.WorkspaceID, ID: a.MediaID, SourceItemID: uuid.NullUUID{UUID: item.ID, Valid: true},
			DurationMs: pgtype.Int4{Int32: int32(res.DurationMS), Valid: true}}); err != nil {
			return err
		}
		// The vendor bills by audio minute. The price comes from configuration; unset, the cost is unknown (0).
		var cost pgtype.Numeric
		_ = cost.Scan(strconv.FormatFloat(float64(res.DurationMS)/60000*w.PricePerMinuteUSD, 'f', 6, 64))
		if err := q.InsertAIEvent(ctx, dbgen.InsertAIEventParams{WorkspaceID: a.WorkspaceID, Task: "transcription", Tier: "audio", Provider: w.Provider.Name(), Model: res.Model,
			PromptVersion: "n/a", CostUsd: cost, LatencyMs: int32(time.Since(start).Milliseconds()), Outcome: "ok"}); err != nil {
			return err
		}
		_, err = w.Jobs.InsertTx(ctx, tx, intake.ExtractArgs{WorkspaceID: a.WorkspaceID, SourceItemID: item.ID, UserID: a.UserID}, nil)
		return err
	})
}

func extOf(name string) string {
	if i := strings.LastIndex(name, "."); i > 0 {
		return name[i:]
	}
	return ""
}

// fail records a plain-language reason and stops (no retry): the file, not the
// service, is the problem.
func (w *TranscribeWorker) fail(ctx context.Context, t store.Tenant, id uuid.UUID, reason string) error {
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		return q.SetMediaState(ctx, dbgen.SetMediaStateParams{WorkspaceID: t.WorkspaceID, ID: id, State: "failed", FailureReason: pgtype.Text{String: reason, Valid: true}})
	})
	if err != nil {
		return err
	}
	return river.JobCancel(errors.New("transcription failed: " + reason))
}

type builtSegment struct {
	StartMS, EndMS     int
	Speaker            string
	SpanStart, SpanEnd int
}

// buildTranscript writes one line per segment ("Speaker: words") and records
// where each line sits, in bytes, so every word maps back to a moment.
func buildTranscript(in []transcribe.Segment) (string, []builtSegment, error) {
	var b strings.Builder
	var out []builtSegment
	for _, s := range in {
		text := strings.Join(strings.Fields(s.Text), " ")
		if text == "" {
			continue
		}
		speaker := strings.Join(strings.Fields(s.Speaker), " ")
		line := text
		if speaker != "" {
			line = speaker + ": " + text
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		start := b.Len()
		b.WriteString(line)
		out = append(out, builtSegment{StartMS: s.StartMS, EndMS: s.EndMS, Speaker: speaker, SpanStart: start, SpanEnd: b.Len()})
		if b.Len() > MaxTranscriptBytes {
			return "", nil, errors.New("This recording's transcript is too long to analyse (over 400 KB of text). Split the recording and upload the parts.")
		}
	}
	if len(out) == 0 {
		return "", nil, errors.New("No speech was found in this recording.")
	}
	return b.String(), out, nil
}

// redactTranscript hides card numbers, keys and passwords spoken or read out in
// a recording. Each segment is cleaned first (so timing stays intact). A value
// spoken across two segments ("four one one one..." then the rest) only shows up
// in the joined text; then the lines are cleaned there and re-aligned, and if
// that is not possible (a whole key spanning many lines) the transcript is kept
// as one untimed block rather than risk keeping the secret.
func redactTranscript(in []transcribe.Segment, text string, segs []builtSegment, durationMS int) (string, []builtSegment, int) {
	hidden := 0
	cleaned := make([]transcribe.Segment, len(in))
	copy(cleaned, in)
	// A card number read out across two segments only exists in the spoken words joined together
	// (not with the speaker labels in between), so look there and mask the part inside each segment.
	var joined strings.Builder
	starts := make([]int, len(in))
	for i, s := range in {
		if i > 0 {
			joined.WriteByte(' ')
		}
		starts[i] = joined.Len()
		joined.WriteString(s.Text)
	}
	for _, span := range redact.CardSpans(joined.String()) {
		crossed := 0
		for i, s := range in {
			lo, hi := starts[i], starts[i]+len(s.Text)
			if span[1] <= lo || span[0] >= hi {
				continue
			}
			crossed++
			a, b := max(span[0], lo)-lo, min(span[1], hi)-lo
			t := cleaned[i].Text
			if a >= 0 && b <= len(t) && a < b {
				cleaned[i].Text = t[:a] + redact.CardMark + t[b:]
			}
		}
		if crossed > 1 { // wholly inside one segment is counted by the per-segment pass below
			hidden++
		}
	}
	for i, s := range cleaned {
		t, sp := redact.Text(s.Text), redact.Text(s.Speaker)
		hidden += t.Total + sp.Total
		s.Text, s.Speaker = t.Text, sp.Text
		cleaned[i] = s
	}
	if hidden > 0 {
		if rebuilt, rebuiltSegs, err := buildTranscript(cleaned); err == nil {
			text, segs = rebuilt, rebuiltSegs
		}
	}
	// A second look at the joined text finds values that straddle two lines.
	if again := redact.Text(text); again.Total > 0 {
		hidden += again.Total
		lines := strings.Split(again.Text, "\n")
		if len(lines) == len(segs) {
			pos := 0
			for i := range segs {
				segs[i].SpanStart, segs[i].SpanEnd = pos, pos+len(lines[i])
				pos += len(lines[i]) + 1
			}
		} else {
			segs = []builtSegment{{StartMS: 0, EndMS: durationMS, SpanStart: 0, SpanEnd: len(again.Text)}}
		}
		text = again.Text
	}
	return text, segs, hidden
}
