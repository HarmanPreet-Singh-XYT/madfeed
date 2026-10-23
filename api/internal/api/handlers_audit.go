package api

import (
	"context"
	"encoding/json"

	"product/api/internal/audit"
)

func (s *Server) ListAuditSamples(ctx context.Context, req ListAuditSamplesRequestObject) (ListAuditSamplesResponseObject, error) {
	if s.Audit == nil {
		return nil, errNotConfigured
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	items, sum, err := s.Audit.List(ctx, t)
	if err != nil {
		return nil, err
	}
	type quote struct {
		Text         string `json:"text"`
		SourceItemID string `json:"sourceItemId"`
		SpanStart    int    `json:"spanStart"`
		SpanEnd      int    `json:"spanEnd"`
	}
	type item struct {
		ID        string  `json:"id"`
		Kind      string  `json:"kind"`
		SampledAt string  `json:"sampledAt"`
		Heading   string  `json:"heading"`
		Text      string  `json:"text"`
		Quotes    []quote `json:"quotes"`
		Gone      bool    `json:"gone"`
		Verdict   *string `json:"verdict,omitempty"`
		Note      *string `json:"note,omitempty"`
	}
	out := struct {
		Items     []item `json:"items"`
		Reviewed  int    `json:"reviewed"`
		Supported int    `json:"supported"`
		Waiting   int    `json:"waiting"`
	}{Items: make([]item, 0, len(items)), Reviewed: sum.Reviewed, Supported: sum.Supported, Waiting: sum.Waiting}
	for _, it := range items {
		qs := make([]quote, 0, len(it.Quotes))
		for _, q := range it.Quotes {
			qs = append(qs, quote{Text: q.Text, SourceItemID: q.SourceItemID.String(), SpanStart: q.SpanStart, SpanEnd: q.SpanEnd})
		}
		o := item{ID: it.ID.String(), Kind: it.Kind, SampledAt: it.Sampled.UTC().Format("2006-01-02T15:04:05Z07:00"), Heading: it.Heading, Text: it.Text, Quotes: qs, Gone: it.Gone}
		if it.Verdict != "" {
			v, n := it.Verdict, it.Note
			o.Verdict, o.Note = &v, &n
		}
		out.Items = append(out.Items, o)
	}
	var resp ListAuditSamples200JSONResponse
	b, _ := json.Marshal(out)
	if err := json.Unmarshal(b, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func (s *Server) ReviewAuditSample(ctx context.Context, req ReviewAuditSampleRequestObject) (ReviewAuditSampleResponseObject, error) {
	if s.Audit == nil {
		return nil, errNotConfigured
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A verdict is required.")
	}
	note := ""
	if req.Body.Note != nil {
		note = *req.Body.Note
	}
	if err := s.Audit.Review(ctx, t, req.SampleId, string(req.Body.Verdict), note); err != nil {
		return nil, err
	}
	return ReviewAuditSample204Response{}, nil
}

var _ = audit.PerWeek
