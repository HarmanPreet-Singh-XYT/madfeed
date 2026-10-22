package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/intake"
	"product/api/internal/review"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ready fails closed when the business services are not wired (development
// without a database); health routes do not call it.
func (s *Server) ready() error {
	if s.Pool == nil || s.Workspaces == nil || s.Intake == nil || s.Review == nil || s.Directory == nil {
		return errNotConfigured
	}
	return nil
}

// tenant resolves the caller's role in the workspace from our own tables. A
// workspace the caller does not belong to looks exactly like one that does not
// exist.
func (s *Server) tenant(ctx context.Context, workspaceID uuid.UUID) (store.Tenant, error) {
	if err := s.ready(); err != nil {
		return store.Tenant{}, err
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return store.Tenant{}, errUnauthorized
	}
	return store.ResolveTenant(ctx, s.Pool, id.UserID, workspaceID)
}

func (s *Server) ListWorkspaces(ctx context.Context, _ ListWorkspacesRequestObject) (ListWorkspacesResponseObject, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	list, err := s.Workspaces.List(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]Workspace, 0, len(list))
	for _, w := range list {
		out = append(out, Workspace{Id: w.ID, Name: w.Name, Role: WorkspaceRole(w.Role)})
	}
	return ListWorkspaces200JSONResponse{Workspaces: out}, nil
}

func (s *Server) CreateWorkspace(ctx context.Context, req CreateWorkspaceRequestObject) (CreateWorkspaceResponseObject, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, errUnauthorized
	}
	if req.Body == nil {
		return nil, badRequest("A name is required.")
	}
	w, err := s.Workspaces.Create(ctx, id.UserID, req.Body.Name)
	if err != nil {
		return nil, err
	}
	return CreateWorkspace201JSONResponse(Workspace{Id: w.ID, Name: w.Name, Role: WorkspaceRole(w.Role)}), nil
}

func (s *Server) IngestPaste(ctx context.Context, req IngestPasteRequestObject) (IngestPasteResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Text is required.")
	}
	in := intake.PasteInput{Text: req.Body.Text}
	if req.Body.Title != nil {
		in.Title = *req.Body.Title
	}
	if req.Body.OriginUrl != nil {
		in.OriginURL = *req.Body.OriginUrl
	}
	if req.Body.PersonId != nil {
		id := uuid.UUID(*req.Body.PersonId)
		in.PersonID = &id
	}
	res, err := s.Intake.IngestPaste(ctx, t, in)
	if err != nil {
		return nil, err
	}
	return IngestPaste202JSONResponse{SourceItemId: res.SourceItemID, Duplicate: res.Duplicate}, nil
}

func (s *Server) GetSource(ctx context.Context, req GetSourceRequestObject) (GetSourceResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	var item dbgen.SourceItem
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) (err error) {
		item, err = q.GetSourceItem(ctx, dbgen.GetSourceItemParams{WorkspaceID: t.WorkspaceID, ID: req.SourceItemId})
		return
	}); err != nil {
		return nil, err
	}
	out := Source{Id: item.ID, Title: item.Title, State: SourceState(item.ProcessingState), CreatedAt: item.CreatedAt, Text: item.RawText}
	if item.FailureReason.Valid {
		out.FailureReason = &item.FailureReason.String
	}
	return GetSource200JSONResponse(out), nil
}

func (s *Server) ListProposals(ctx context.Context, req ListProposalsRequestObject) (ListProposalsResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	state, limit := "suggested", 50
	if req.Params.State != nil {
		state = string(*req.Params.State)
	}
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	ps, err := s.Review.List(ctx, t, state, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Proposal, 0, len(ps))
	for _, p := range ps {
		item := Proposal{
			Id: p.ID, SourceItemId: p.SourceItemID, Kind: ProposalKind(p.Kind), StatementKind: ProposalStatementKind(p.StatementKind),
			Title: p.Title, Quote: p.QuoteText, SpanStart: int(p.SpanStart), SpanEnd: int(p.SpanEnd), Confidence: p.Confidence,
			State: ProposalState(p.State), CreatedAt: p.CreatedAt,
		}
		if p.RequestID.Valid {
			rid := p.RequestID.UUID
			item.RequestId = &rid
		}
		out = append(out, item)
	}
	return ListProposals200JSONResponse{Proposals: out}, nil
}

func (s *Server) RenameProposal(ctx context.Context, req RenameProposalRequestObject) (RenameProposalResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A title is required.")
	}
	if err := s.Review.EditTitle(ctx, t, req.ProposalId, req.Body.Title); err != nil {
		return nil, err
	}
	return RenameProposal204Response{}, nil
}

func (s *Server) AcceptProposal(ctx context.Context, req AcceptProposalRequestObject) (AcceptProposalResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	var opts review.AcceptOpts
	if req.Body != nil {
		if req.Body.TargetRequestId != nil {
			id := uuid.UUID(*req.Body.TargetRequestId)
			opts.TargetRequestID = &id
		}
		opts.Title = req.Body.Title
	}
	res, err := s.Review.Accept(ctx, t, req.ProposalId, opts)
	if err != nil {
		return nil, err
	}
	return AcceptProposal200JSONResponse{RequestId: res.RequestID, EvidenceId: res.EvidenceID}, nil
}

func (s *Server) DismissProposal(ctx context.Context, req DismissProposalRequestObject) (DismissProposalResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Review.Dismiss(ctx, t, req.ProposalId); err != nil {
		return nil, err
	}
	return DismissProposal204Response{}, nil
}

func (s *Server) UndoProposal(ctx context.Context, req UndoProposalRequestObject) (UndoProposalResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Review.Undo(ctx, t, req.ProposalId); err != nil {
		return nil, err
	}
	return UndoProposal204Response{}, nil
}

func (s *Server) BulkAcceptProposals(ctx context.Context, req BulkAcceptProposalsRequestObject) (BulkAcceptProposalsResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A threshold is required.")
	}
	res, err := s.Review.BulkAccept(ctx, t, float64(req.Body.Threshold))
	if err != nil {
		return nil, err
	}
	return BulkAcceptProposals200JSONResponse{Accepted: res.Accepted, Skipped: res.Skipped}, nil
}

// impactOf converts the stored numbers; value stays decimal text so money is never a float.
func impactOf(evidence, people, accounts, withValue int32, value pgtype.Numeric, newest pgtype.Timestamptz) Impact {
	out := Impact{EvidenceCount: int(evidence), PeopleCount: int(people), AccountCount: int(accounts), AccountsWithValue: int(withValue), TotalValue: "0.00"}
	if v := numericText(value); v != "" {
		out.TotalValue = v
	}
	if newest.Valid {
		t := newest.Time
		out.NewestEvidenceAt = &t
	}
	return out
}

func numericText(n pgtype.Numeric) string {
	v, err := n.Value()
	if err != nil || v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func (s *Server) ListRequests(ctx context.Context, req ListRequestsRequestObject) (ListRequestsResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	limit := 50
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	byValue := req.Params.Sort != nil && *req.Params.Sort == Value
	cursor := ""
	if req.Params.Cursor != nil {
		cursor = *req.Params.Cursor
	}

	type item struct {
		id      uuid.UUID
		title   string
		via     string
		at      time.Time
		impact  Impact
		valText string
		status  StatusRef
	}
	var rows []item
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		if byValue {
			var v pgtype.Numeric
			_ = v.Scan("9999999999999999")
			beforeID := uuid.Max
			if cursor != "" {
				var verr error
				if v, beforeID, verr = decodeValueCursor(cursor); verr != nil {
					return badRequest("The page cursor is not valid.")
				}
			}
			rs, err := q.ListRequestSummariesByValue(ctx, dbgen.ListRequestSummariesByValueParams{WorkspaceID: t.WorkspaceID, BeforeValue: v, BeforeID: beforeID, PageSize: int32(limit + 1)})
			for _, r := range rs {
				rows = append(rows, item{r.ID, r.Title, r.CreatedVia, r.CreatedAt, impactOf(r.EvidenceCount, r.PeopleCount, r.AccountCount, r.AccountsWithValue, r.TotalValue, r.NewestEvidenceAt), numericText(r.TotalValue), StatusRef{Id: r.StatusID, Name: r.StatusName, Bucket: StatusRefBucket(r.StatusBucket)}})
			}
			return err
		}
		before, beforeID := time.Now().Add(24*time.Hour), uuid.Max
		if cursor != "" {
			var cerr error
			if before, beforeID, cerr = decodeCursor(cursor); cerr != nil {
				return badRequest("The page cursor is not valid.")
			}
		}
		rs, err := q.ListRequestSummaries(ctx, dbgen.ListRequestSummariesParams{WorkspaceID: t.WorkspaceID, BeforeCreatedAt: before, BeforeID: beforeID, PageSize: int32(limit + 1)})
		for _, r := range rs {
			rows = append(rows, item{r.ID, r.Title, r.CreatedVia, r.CreatedAt, impactOf(r.EvidenceCount, r.PeopleCount, r.AccountCount, r.AccountsWithValue, r.TotalValue, r.NewestEvidenceAt), "", StatusRef{Id: r.StatusID, Name: r.StatusName, Bucket: StatusRefBucket(r.StatusBucket)}})
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		c := encodeCursor(last.at, last.id)
		if byValue {
			c = encodeValueCursor(last.valText, last.id)
		}
		next = &c
	}
	out := make([]RequestSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, RequestSummary{Id: r.id, Title: r.title, CreatedVia: RequestSummaryCreatedVia(r.via), Impact: r.impact, Status: r.status, CreatedAt: r.at})
	}
	return ListRequests200JSONResponse{Requests: out, NextCursor: next}, nil
}

func (s *Server) GetRequest(ctx context.Context, req GetRequestRequestObject) (GetRequestResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	var detail RequestDetail
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: req.RequestId})
		if err != nil {
			return err
		}
		im, err := q.GetRequestImpact(ctx, dbgen.GetRequestImpactParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		evs, err := q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		st, err := q.GetStatus(ctx, dbgen.GetStatusParams{WorkspaceID: t.WorkspaceID, ID: r.StatusID})
		if err != nil {
			return err
		}
		informed, err := q.ListInformedForRequest(ctx, dbgen.ListInformedForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		notes, err := q.ListNotesForRequest(ctx, dbgen.ListNotesForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		detail = RequestDetail{Status: StatusRef{Id: st.ID, Name: st.Name, Bucket: StatusRefBucket(st.Bucket)}, Informed: make([]InformedPerson, 0, len(informed)), ReleaseNotes: make([]NoteRef, 0, len(notes)), Id: r.ID, Title: r.Title, CreatedVia: RequestDetailCreatedVia(r.CreatedVia), CreatedAt: r.CreatedAt, Evidence: make([]Evidence, 0, len(evs)),
			Impact: impactOf(im.EvidenceCount, im.PeopleCount, im.AccountCount, im.AccountsWithValue, im.TotalValue, im.NewestEvidenceAt)}
		for _, i := range informed {
			if i.SentAt.Valid {
				detail.Informed = append(detail.Informed, InformedPerson{PersonId: i.PersonID, Name: i.PersonName, SentAt: i.SentAt.Time})
			}
		}
		for _, n := range notes {
			ref := NoteRef{Id: n.ID, Title: n.Title, State: NoteRefState(n.State)}
			if n.PublishedAt.Valid {
				at := n.PublishedAt.Time
				ref.PublishedAt = &at
			}
			detail.ReleaseNotes = append(detail.ReleaseNotes, ref)
		}
		if b, err := q.GetOpenBatchForRequest(ctx, dbgen.GetOpenBatchForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID}); err == nil {
			id := b.ID
			detail.OpenBatchId = &id
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		for _, e := range evs {
			ev := Evidence{Id: e.ID, SourceItemId: e.SourceItemID, Quote: e.QuoteText, SpanStart: int(e.SpanStart), SpanEnd: int(e.SpanEnd), CreatedAt: e.CreatedAt}
			if e.Confidence.Valid {
				c := e.Confidence.Float32
				ev.Confidence = &c
			}
			detail.Evidence = append(detail.Evidence, ev)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return GetRequest200JSONResponse(detail), nil
}

func encodeValueCursor(value string, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte("v:" + value + "|" + id.String()))
}

func decodeValueCursor(c string) (pgtype.Numeric, uuid.UUID, error) {
	var n pgtype.Numeric
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil || !strings.HasPrefix(string(raw), "v:") {
		return n, uuid.Nil, errNotFound
	}
	val, idStr, ok := strings.Cut(string(raw)[2:], "|")
	if !ok {
		return n, uuid.Nil, errNotFound
	}
	if err := n.Scan(val); err != nil {
		return n, uuid.Nil, err
	}
	id, err := uuid.Parse(idStr)
	return n, id, err
}

func encodeCursor(at time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeCursor(c string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	ts, idStr, ok := strings.Cut(string(raw), "|")
	if !ok {
		return time.Time{}, uuid.Nil, errNotFound
	}
	at, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(idStr)
	return at, id, err
}

var _ openapi_types.UUID // generated UUID type is an alias of uuid.UUID
