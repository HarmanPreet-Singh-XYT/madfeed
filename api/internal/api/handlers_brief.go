package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"product/api/internal/brief"
)

func briefView(v brief.View) Brief {
	out := Brief{State: BriefState(v.State), Stale: v.Stale, LowEvidence: v.LowEvidence, GeneratedAt: v.GeneratedAt, Quotes: make([]BriefQuote, 0, len(v.Quotes))}
	if v.Claim != "" {
		c := v.Claim
		out.Claim = &c
	}
	if v.Disproof != "" {
		d := v.Disproof
		out.Disproof = &d
	}
	if v.FailureReason != "" {
		f := v.FailureReason
		out.FailureReason = &f
	}
	for _, q := range v.Quotes {
		out.Quotes = append(out.Quotes, BriefQuote{EvidenceId: q.ID, SourceItemId: q.SourceItemID, Quote: q.Text, SpanStart: q.SpanStart, SpanEnd: q.SpanEnd})
	}
	f := v.Facts
	out.Facts = BriefFacts{
		EvidenceCount: f.EvidenceCount, NewLast30Days: f.NewLast30Days, UnidentifiedQuotes: f.Unidentified, PeopleCount: f.PeopleCount,
		AccountCount: f.AccountCount, AccountsWithValue: f.AccountsWithValue, TotalValue: f.TotalValue,
		FirstEvidenceAt: f.FirstEvidenceAt, NewestEvidenceAt: f.NewestEvidenceAt, Accounts: make([]BriefAccount, 0, len(f.Accounts)),
	}
	if out.Facts.TotalValue == "" {
		out.Facts.TotalValue = "0.00"
	}
	for _, a := range f.Accounts {
		item := BriefAccount{Id: a.ID, Name: a.Name, PeopleCount: a.PeopleCount}
		if a.Revenue != "" {
			r := a.Revenue
			item.Revenue = &r
		}
		out.Facts.Accounts = append(out.Facts.Accounts, item)
	}
	return out
}

func briefError(err error) error {
	var q brief.ErrQuota
	switch {
	case errors.Is(err, brief.ErrNotFound):
		return errNotFound
	case errors.Is(err, brief.ErrNoEvidence):
		return &APIError{http.StatusConflict, "no_evidence", "This request has no customer quotes yet. Accept at least one suggestion first."}
	case errors.As(err, &q):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", q.Error()}
	}
	return err
}

func (s *Server) GetBrief(ctx context.Context, req GetBriefRequestObject) (GetBriefResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if s.Brief == nil {
		return nil, errNotConfigured
	}
	v, err := s.Brief.Get(ctx, t, uuid.UUID(req.RequestId))
	if err != nil {
		return nil, briefError(err)
	}
	return GetBrief200JSONResponse(briefView(v)), nil
}

func (s *Server) RequestBrief(ctx context.Context, req RequestBriefRequestObject) (RequestBriefResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if s.Brief == nil {
		return nil, errNotConfigured
	}
	v, started, err := s.Brief.Request(ctx, t, uuid.UUID(req.RequestId))
	if err != nil {
		return nil, briefError(err)
	}
	if started {
		return RequestBrief202JSONResponse(briefView(v)), nil
	}
	return RequestBrief200JSONResponse(briefView(v)), nil
}
