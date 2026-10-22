// Package review implements the review queue: people accept, edit, dismiss
// and undo machine-proposed requests. Nothing a model proposes becomes a
// request or evidence until a person accepts it here.
package review

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound = errors.New("review: not found")
	// ErrConflict means the proposal is not in a state that allows the action
	// (for example, accepting something already accepted).
	ErrConflict      = errors.New("review: proposal is not in the right state for this action")
	ErrAlreadyLinked = errors.New("review: this quote is already evidence on that request")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type Service struct{ Pool *pgxpool.Pool }

type AcceptOpts struct {
	// TargetRequestID attaches the quote to an existing request (a merge)
	// instead of creating a new one.
	TargetRequestID *uuid.UUID
	// Title overrides the proposed title for a newly created request.
	Title *string
}

type Accepted struct{ RequestID, EvidenceID uuid.UUID }

func (s *Service) List(ctx context.Context, t store.Tenant, state string, limit int) ([]dbgen.Proposal, error) {
	if state != "suggested" && state != "accepted" && state != "dismissed" {
		return nil, ErrInvalid("unknown state")
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	var out []dbgen.Proposal
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) (err error) {
		out, err = q.ListProposals(ctx, dbgen.ListProposalsParams{WorkspaceID: t.WorkspaceID, State: state, PageSize: int32(limit)})
		return
	})
	return out, err
}

func (s *Service) Accept(ctx context.Context, t store.Tenant, proposalID uuid.UUID, opts AcceptOpts) (Accepted, error) {
	if !t.CanWrite() {
		return Accepted{}, store.ErrForbidden
	}
	title := ""
	if opts.Title != nil {
		var err error
		if title, err = cleanTitle(*opts.Title); err != nil {
			return Accepted{}, err
		}
	}
	var out Accepted
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		p, err := lock(ctx, q, t, proposalID)
		if err != nil {
			return err
		}
		if p.State != "suggested" {
			return ErrConflict
		}
		item, err := q.GetSourceItem(ctx, dbgen.GetSourceItemParams{WorkspaceID: t.WorkspaceID, ID: p.SourceItemID})
		if err != nil {
			return err
		}

		// Keeping a changed title on the suggestion itself records that a person
		// corrected it, and survives an undo.
		if opts.TargetRequestID == nil && title != "" && title != p.Title {
			if _, err := q.UpdateProposalTitle(ctx, dbgen.UpdateProposalTitleParams{WorkspaceID: t.WorkspaceID, ID: p.ID, Title: title}); err != nil {
				return err
			}
		}
		var requestID uuid.UUID
		created := false
		if opts.TargetRequestID != nil {
			if _, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: *opts.TargetRequestID}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
			requestID = *opts.TargetRequestID
		} else {
			if title == "" {
				title = p.Title
			}
			req, err := q.CreateMachineRequest(ctx, dbgen.CreateMachineRequestParams{WorkspaceID: t.WorkspaceID, Title: title})
			if err != nil {
				return fmt.Errorf("create request: %w", err)
			}
			requestID, created = req.ID, true
		}

		ev, err := q.InsertEvidence(ctx, dbgen.InsertEvidenceParams{
			WorkspaceID: t.WorkspaceID, RequestID: requestID, SourceItemID: p.SourceItemID, ChunkID: p.ChunkID,
			PersonID: item.PersonID, QuoteText: p.QuoteText, SpanStart: p.SpanStart, SpanEnd: p.SpanEnd,
			Confidence: nullFloat(p.Confidence), CreatedBy: t.UserID,
		})
		if err != nil {
			var pe *pgconn.PgError
			if errors.As(err, &pe) && pe.Code == "23505" {
				return ErrAlreadyLinked
			}
			return fmt.Errorf("create evidence: %w", err)
		}
		if err := q.MarkProposalAccepted(ctx, dbgen.MarkProposalAcceptedParams{
			WorkspaceID: t.WorkspaceID, ID: p.ID, RequestID: uuid.NullUUID{UUID: requestID, Valid: true},
			EvidenceID: uuid.NullUUID{UUID: ev.ID, Valid: true}, CreatedRequest: created,
			DecidedBy: uuid.NullUUID{UUID: t.UserID, Valid: true},
		}); err != nil {
			return err
		}
		out = Accepted{RequestID: requestID, EvidenceID: ev.ID}
		return nil
	})
	return out, err
}

func (s *Service) Dismiss(ctx context.Context, t store.Tenant, proposalID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		p, err := lock(ctx, q, t, proposalID)
		if err != nil {
			return err
		}
		if p.State != "suggested" {
			return ErrConflict
		}
		return q.MarkProposalDismissed(ctx, dbgen.MarkProposalDismissedParams{
			WorkspaceID: t.WorkspaceID, ID: p.ID, DecidedBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
	})
}

// Undo restores a decided proposal to "suggested" exactly as it was before the
// decision: the evidence it created is removed, and so is the request it
// created if that request has no other evidence.
func (s *Service) Undo(ctx context.Context, t store.Tenant, proposalID uuid.UUID) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		p, err := lock(ctx, q, t, proposalID)
		if err != nil {
			return err
		}
		switch p.State {
		case "suggested":
			return ErrConflict
		case "accepted":
			if p.EvidenceID.Valid {
				if _, err := q.DeleteEvidence(ctx, dbgen.DeleteEvidenceParams{WorkspaceID: t.WorkspaceID, ID: p.EvidenceID.UUID}); err != nil {
					return err
				}
			}
			if p.CreatedRequest && p.RequestID.Valid {
				n, err := q.CountEvidenceForRequest(ctx, dbgen.CountEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: p.RequestID.UUID})
				if err != nil {
					return err
				}
				if n == 0 {
					if _, err := q.DeleteRequest(ctx, dbgen.DeleteRequestParams{WorkspaceID: t.WorkspaceID, ID: p.RequestID.UUID}); err != nil {
						return err
					}
				}
			}
		}
		return q.ResetProposal(ctx, dbgen.ResetProposalParams{WorkspaceID: t.WorkspaceID, ID: p.ID})
	})
}

func (s *Service) EditTitle(ctx context.Context, t store.Tenant, proposalID uuid.UUID, title string) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	title, err := cleanTitle(title)
	if err != nil {
		return err
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateProposalTitle(ctx, dbgen.UpdateProposalTitleParams{WorkspaceID: t.WorkspaceID, ID: proposalID, Title: title})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict // missing, other workspace, or already decided
		}
		return nil
	})
}

type BulkResult struct{ Accepted, Skipped int }

// BulkAccept accepts new-request suggestions whose confidence is at or above
// threshold, each in its own transaction so one bad item cannot block the rest.
// Anything below the threshold is untouched.
func (s *Service) BulkAccept(ctx context.Context, t store.Tenant, threshold float64) (BulkResult, error) {
	if !t.CanWrite() {
		return BulkResult{}, store.ErrForbidden
	}
	if threshold < 0.5 || threshold > 1 {
		return BulkResult{}, ErrInvalid("threshold must be between 0.5 and 1")
	}
	var ids []uuid.UUID
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) (err error) {
		ids, err = q.ListSuggestedAtOrAbove(ctx, dbgen.ListSuggestedAtOrAboveParams{WorkspaceID: t.WorkspaceID, Confidence: float32(threshold), PageSize: 500})
		return
	})
	if err != nil {
		return BulkResult{}, err
	}
	var res BulkResult
	for _, id := range ids {
		if _, err := s.Accept(ctx, t, id, AcceptOpts{}); err != nil {
			if errors.Is(err, ErrConflict) || errors.Is(err, ErrAlreadyLinked) {
				res.Skipped++
				continue
			}
			return res, err
		}
		res.Accepted++
	}
	return res, nil
}

func lock(ctx context.Context, q *dbgen.Queries, t store.Tenant, id uuid.UUID) (dbgen.Proposal, error) {
	p, err := q.GetProposalForUpdate(ctx, dbgen.GetProposalForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func cleanTitle(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) > 200 {
		return "", ErrInvalid("title must be 1 to 200 characters")
	}
	return s, nil
}
