package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"product/api/internal/ai"
	"product/api/internal/findings"
	"product/api/internal/insights"
)

// shape fills a generated response type from plain maps and slices, so a handler does not have to spell out
// the generated anonymous struct types.
func shape[T any](v any) T {
	var out T
	b, _ := json.Marshal(v)
	_ = json.Unmarshal(b, &out)
	return out
}

func (s *Server) findingsReady() error {
	if s.Findings == nil {
		return errNotConfigured
	}
	return nil
}

func (s *Server) insightsReady() error {
	if s.Insights == nil {
		return errNotConfigured
	}
	return nil
}

func (s *Server) ListFindings(ctx context.Context, req ListFindingsRequestObject) (ListFindingsResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Findings.List(ctx, t)
	if err != nil {
		return nil, err
	}
	docs := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		docs = append(docs, map[string]any{"id": r.ID, "title": r.Title, "state": r.State, "blocks": r.Blocks, "updatedAt": r.UpdatedAt})
	}
	return shape[ListFindings200JSONResponse](map[string]any{"documents": docs}), nil
}

func (s *Server) CreateFinding(ctx context.Context, req CreateFindingRequestObject) (CreateFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, err := s.Findings.Create(ctx, t, req.Body.Title)
	if err != nil {
		return nil, err
	}
	return CreateFinding201JSONResponse{Id: id}, nil
}

func (s *Server) GetFinding(ctx context.Context, req GetFindingRequestObject) (GetFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	d, err := s.Findings.Get(ctx, t, req.DocId)
	if err != nil {
		return nil, err
	}
	blocks := make([]map[string]any, 0, len(d.Blocks))
	for _, b := range d.Blocks {
		m := map[string]any{"id": b.ID, "kind": b.Kind, "body": b.Body, "removed": b.Removed}
		if b.QuoteKind != "" {
			m["quoteKind"] = b.QuoteKind
		}
		if b.QuoteID != nil {
			m["quoteId"] = b.QuoteID
		}
		if b.Kind == "quote" && !b.Removed {
			m["quote"], m["sourceTitle"], m["requestTitle"] = b.Quote, b.SourceTitle, b.RequestTitle
			if b.SourceItemID != nil {
				m["sourceItemId"] = b.SourceItemID
			}
		}
		blocks = append(blocks, m)
	}
	out := map[string]any{"id": d.ID, "title": d.Title, "state": d.State, "updatedAt": d.UpdatedAt, "blocks": blocks}
	if d.PublicLink != "" {
		out["publicLink"] = d.PublicLink
	}
	if d.PublishedAt != nil {
		out["publishedAt"] = d.PublishedAt
	}
	return shape[GetFinding200JSONResponse](out), nil
}

func (s *Server) RenameFinding(ctx context.Context, req RenameFindingRequestObject) (RenameFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Findings.Rename(ctx, t, req.DocId, req.Body.Title); err != nil {
		return nil, err
	}
	return RenameFinding204Response{}, nil
}

func (s *Server) DeleteFinding(ctx context.Context, req DeleteFindingRequestObject) (DeleteFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Findings.Delete(ctx, t, req.DocId); err != nil {
		return nil, err
	}
	return DeleteFinding204Response{}, nil
}

func (s *Server) SetFindingBlocks(ctx context.Context, req SetFindingBlocksRequestObject) (SetFindingBlocksResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	in := make([]findings.BlockInput, 0, len(req.Body.Blocks))
	for _, b := range req.Body.Blocks {
		bi := findings.BlockInput{ID: b.Id, Kind: string(b.Kind), QuoteID: b.QuoteId}
		if b.Body != nil {
			bi.Body = *b.Body
		}
		if b.QuoteKind != nil {
			bi.QuoteKind = string(*b.QuoteKind)
		}
		in = append(in, bi)
	}
	if err := s.Findings.SetBlocks(ctx, t, req.DocId, in); err != nil {
		return nil, err
	}
	return SetFindingBlocks204Response{}, nil
}

func (s *Server) PublishFinding(ctx context.Context, req PublishFindingRequestObject) (PublishFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	link, err := s.Findings.Publish(ctx, t, req.DocId, req.Body.Confirmed)
	if err != nil {
		return nil, err
	}
	return PublishFinding200JSONResponse{Link: link}, nil
}

func (s *Server) UnpublishFinding(ctx context.Context, req UnpublishFindingRequestObject) (UnpublishFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Findings.Unpublish(ctx, t, req.DocId); err != nil {
		return nil, err
	}
	return UnpublishFinding204Response{}, nil
}

func (s *Server) GetPublicFinding(ctx context.Context, req GetPublicFindingRequestObject) (GetPublicFindingResponseObject, error) {
	if err := s.findingsReady(); err != nil {
		return nil, err
	}
	p, err := s.Findings.Public(ctx, req.Token)
	if err != nil {
		return nil, err
	}
	blocks := make([]map[string]any, 0, len(p.Blocks))
	for _, b := range p.Blocks {
		m := map[string]any{"kind": b.Kind, "text": b.Text}
		if b.Note != "" {
			m["note"] = b.Note
		}
		blocks = append(blocks, m)
	}
	out := map[string]any{"title": p.Title, "blocks": blocks}
	if p.PublishedAt != nil {
		out["publishedAt"] = p.PublishedAt
	}
	return shape[GetPublicFinding200JSONResponse](out), nil
}

func (s *Server) ListQuotes(ctx context.Context, req ListQuotesRequestObject) (ListQuotesResponseObject, error) {
	if err := s.insightsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	p := req.Params
	f := insights.Filter{TagID: p.TagId, AfterAt: p.AfterAt, AfterID: p.AfterId}
	if p.Sentiment != nil {
		f.Sentiment = string(*p.Sentiment)
	}
	if p.SourceKind != nil {
		f.SourceKind = string(*p.SourceKind)
	}
	if p.Kind != nil {
		f.Kind = string(*p.Kind)
	}
	if p.Q != nil {
		f.Search = *p.Q
	}
	if p.Limit != nil {
		f.Limit = *p.Limit
	}
	qs, next, err := s.Insights.Quotes(ctx, t, f)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(qs))
	for _, q := range qs {
		tags := make([]map[string]any, 0, len(q.Tags))
		for _, tg := range q.Tags {
			tags = append(tags, map[string]any{"id": tg.ID, "name": tg.Name, "color": tg.Color})
		}
		m := map[string]any{"kind": q.Kind, "id": q.ID, "at": q.At, "text": q.Text, "sourceItemId": q.SourceItemID, "sourceTitle": q.SourceTitle, "sourceKind": q.SourceKind, "tags": tags}
		if q.RequestID != nil {
			m["requestId"], m["requestTitle"] = q.RequestID, q.RequestTitle
		}
		if q.Sentiment != "" {
			m["sentiment"], m["sentimentSource"] = q.Sentiment, q.SentimentSource
		}
		rows = append(rows, m)
	}
	out := map[string]any{"quotes": rows}
	if next != nil {
		out["next"] = map[string]any{"at": next.At, "id": next.ID}
	}
	return shape[ListQuotes200JSONResponse](out), nil
}

func (s *Server) SetQuoteSentiment(ctx context.Context, req SetQuoteSentimentRequestObject) (SetQuoteSentimentResponseObject, error) {
	if err := s.insightsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	label := string(req.Body.Label)
	if label == "none" {
		label = ""
	}
	if err := s.Insights.Label(ctx, t, string(req.QuoteKind), req.QuoteId, label); err != nil {
		return nil, err
	}
	return SetQuoteSentiment204Response{}, nil
}

func (s *Server) GetTagTrends(ctx context.Context, req GetTagTrendsRequestObject) (GetTagTrendsResponseObject, error) {
	if err := s.insightsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	weeks := 0
	if req.Params.Weeks != nil {
		weeks = *req.Params.Weeks
	}
	trs, err := s.Insights.Trends(ctx, t, weeks)
	if err != nil {
		return nil, err
	}
	tags := make([]map[string]any, 0, len(trs))
	for _, tr := range trs {
		ws := make([]map[string]any, 0, len(tr.Weeks))
		for _, w := range tr.Weeks {
			ws = append(ws, map[string]any{"week": w.Week.Format("2006-01-02"), "count": w.N})
		}
		tags = append(tags, map[string]any{"id": tr.Tag.ID, "name": tr.Tag.Name, "color": tr.Tag.Color, "total": tr.Total, "byFeeling": tr.ByLabel, "weeks": ws})
	}
	return shape[GetTagTrends200JSONResponse](map[string]any{"tags": tags}), nil
}

func (s *Server) GetSentimentStatus(ctx context.Context, req GetSentimentStatusRequestObject) (GetSentimentStatusResponseObject, error) {
	if err := s.insightsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	pending, err := s.Insights.Pending(ctx, t)
	if err != nil {
		return nil, err
	}
	a, err := s.Insights.Agreement(ctx, t)
	if err != nil {
		return nil, err
	}
	pairs := make([]map[string]any, 0, len(a.Pairs))
	for _, p := range a.Pairs {
		pairs = append(pairs, map[string]any{"human": p.Human, "model": p.Model, "count": p.N})
	}
	return shape[GetSentimentStatus200JSONResponse](map[string]any{
		"pending": pending, "humanLabelled": a.HumanLabelled, "compared": a.Compared, "agreed": a.Agreed,
		"accuracy": a.Accuracy, "target": a.Target, "enough": a.Enough, "meetsTarget": a.MeetsTarget, "pairs": pairs,
	}), nil
}

func (s *Server) ClassifySentiment(ctx context.Context, req ClassifySentimentRequestObject) (ClassifySentimentResponseObject, error) {
	if err := s.insightsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	n, err := s.Insights.Classify(ctx, t)
	if err != nil {
		return nil, err
	}
	return ClassifySentiment202JSONResponse{Pending: n}, nil
}

func (s *Server) GetSentimentSample(ctx context.Context, req GetSentimentSampleRequestObject) (GetSentimentSampleResponseObject, error) {
	if err := s.insightsReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	seed, n := "", 0
	if req.Params.Seed != nil {
		seed = *req.Params.Seed
	}
	if req.Params.Limit != nil {
		n = *req.Params.Limit
	}
	rows, done, err := s.Insights.LabelSample(ctx, t, n, seed)
	if err != nil {
		return nil, err
	}
	qs := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		qs = append(qs, map[string]any{"kind": r.Kind, "id": r.ID, "text": r.Text})
	}
	return shape[GetSentimentSample200JSONResponse](map[string]any{"labelled": done, "quotes": qs}), nil
}

// SearchQuotesByMeaning finds quotes by what they mean. With no embedding service it answers ready=false, so
// the screen can say so plainly instead of failing.
func (s *Server) SearchQuotesByMeaning(ctx context.Context, req SearchQuotesByMeaningRequestObject) (SearchQuotesByMeaningResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	hits := []map[string]any{}
	if s.Match == nil || !s.Match.Ready() {
		return shape[SearchQuotesByMeaning200JSONResponse](map[string]any{"ready": false, "pending": 0, "hits": hits}), nil
	}
	limit := 20
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	pending, err := s.Match.Pending(ctx, t)
	if err != nil {
		return nil, err
	}
	if pending > 0 {
		// quotes are indexed in the background the first time anyone searches by meaning
		if err := s.Match.RequestIndex(ctx, t); err != nil {
			return nil, err
		}
	}
	found, err := s.Match.SearchQuotes(ctx, t, req.Params.Q, limit)
	if errors.Is(err, ai.ErrBudgetExceeded) {
		return nil, &APIError{http.StatusTooManyRequests, "ai_allowance_used", "Today's AI allowance for this workspace is used up. Searching by meaning works again when it renews."}
	}
	if err != nil {
		return nil, err
	}
	for _, h := range found {
		hits = append(hits, map[string]any{"kind": h.Kind, "id": h.ID, "text": h.Text, "sourceItemId": h.SourceID, "sourceTitle": h.SourceTitle, "sourceKind": h.SourceKind, "at": h.At, "score": h.Score})
	}
	return shape[SearchQuotesByMeaning200JSONResponse](map[string]any{"ready": true, "pending": pending, "hits": hits}), nil
}
