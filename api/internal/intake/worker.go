package intake

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/extract"
	"product/api/internal/spans"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

type ExtractArgs struct {
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	SourceItemID uuid.UUID `json:"source_item_id"`
	UserID       uuid.UUID `json:"user_id"`
}

func (ExtractArgs) Kind() string { return "extract_source_item" }

// ExtractWorker turns a stored source item into review-queue proposals. It is
// idempotent: a retry never duplicates proposals (unique on source span) and a
// finished item is skipped.
type ExtractWorker struct {
	river.WorkerDefaults[ExtractArgs]
	Pool      *pgxpool.Pool
	Completer extract.Completer
}

func (w *ExtractWorker) Work(ctx context.Context, job *river.Job[ExtractArgs]) error {
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}
	ctx = store.WithContext(ctx, t) // lets the AI event recorder write tenant-scoped rows

	// Read first, release the connection, then call the model (slow), then write.
	var item dbgen.SourceItem
	var chunks []dbgen.Chunk
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) (err error) {
		if item, err = q.GetSourceItem(ctx, dbgen.GetSourceItemParams{WorkspaceID: t.WorkspaceID, ID: a.SourceItemID}); err != nil {
			return err
		}
		if item.ProcessingState == "done" {
			return nil
		}
		if err = q.SetSourceItemState(ctx, dbgen.SetSourceItemStateParams{WorkspaceID: t.WorkspaceID, ID: item.ID, ProcessingState: "processing"}); err != nil {
			return err
		}
		chunks, err = q.ListChunks(ctx, dbgen.ListChunksParams{WorkspaceID: t.WorkspaceID, SourceItemID: item.ID})
		return err
	})
	if err != nil {
		return fmt.Errorf("load source item: %w", err)
	}
	if item.ProcessingState == "done" {
		return nil
	}

	sc := make([]spans.Chunk, len(chunks))
	for i, c := range chunks {
		sc[i] = spans.Chunk{Ordinal: int(c.Ordinal), Start: int(c.StartOffset), End: int(c.EndOffset), Text: c.Text}
	}
	res, exErr := extract.Extract(ctx, w.Completer, item.RawText, sc, extract.DefaultOverlap)
	if exErr != nil {
		if job.Attempt >= job.MaxAttempts {
			_ = w.setState(ctx, t, item.ID, "failed", "extraction failed")
		}
		return fmt.Errorf("extract: %w", exErr)
	}

	byOrdinal := map[int]dbgen.Chunk{}
	for _, c := range chunks {
		byOrdinal[int(c.Ordinal)] = c
	}
	err = store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		for _, f := range res.Found {
			// Second check, independent of the extractor: the quote must equal the
			// stored source at its span. (The database trigger is the third.)
			if err := spans.Validate(item.RawText, f.Start, f.End, f.Quote); err != nil {
				return fmt.Errorf("refusing to store unverifiable quote: %w", err)
			}
			if _, err := q.InsertProposal(ctx, dbgen.InsertProposalParams{
				WorkspaceID: t.WorkspaceID, SourceItemID: item.ID, ChunkID: byOrdinal[f.ChunkOrdinal].ID,
				StatementKind: f.Kind, Title: f.Title, QuoteText: f.Quote,
				SpanStart: int32(f.Start), SpanEnd: int32(f.End), Confidence: float32(f.Confidence),
			}); err != nil {
				return fmt.Errorf("store proposal: %w", err)
			}
		}
		if res.FailedChunks > 0 {
			return nil // keep what we found; state stays "processing" so the retry finishes the rest
		}
		return q.SetSourceItemState(ctx, dbgen.SetSourceItemStateParams{WorkspaceID: t.WorkspaceID, ID: item.ID, ProcessingState: "done"})
	})
	if err != nil {
		return err
	}
	if res.FailedChunks > 0 {
		if job.Attempt >= job.MaxAttempts {
			_ = w.setState(ctx, t, item.ID, "failed", fmt.Sprintf("%d section(s) could not be processed", res.FailedChunks))
		}
		return fmt.Errorf("%d chunk(s) failed; will retry", res.FailedChunks)
	}
	return nil
}

func (w *ExtractWorker) setState(ctx context.Context, t store.Tenant, id uuid.UUID, state, reason string) error {
	return store.WithTenant(context.WithoutCancel(ctx), w.Pool, t, func(q *dbgen.Queries) error {
		return q.SetSourceItemState(ctx, dbgen.SetSourceItemStateParams{WorkspaceID: t.WorkspaceID, ID: id, ProcessingState: state, FailureReason: pgText(reason)})
	})
}
