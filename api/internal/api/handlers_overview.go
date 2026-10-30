package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/overview"
)

func (s *Server) GetOverview(ctx context.Context, req GetOverviewRequestObject) (GetOverviewResponseObject, error) {
	if s.Overview == nil {
		return nil, errNotConfigured
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	days := 30
	if req.Params.Days != nil {
		days = int(*req.Params.Days)
	}
	c, err := s.Overview.Counts(ctx, t)
	if err != nil {
		return nil, err
	}
	points, err := s.Overview.Series(ctx, t, days)
	if err != nil {
		return nil, err
	}
	series := make([]OverviewSeriesPoint, 0, len(points))
	for _, p := range points {
		series = append(series, OverviewSeriesPoint{
			Day: openapi_types.Date{Time: p.Day}, Requests: p.Requests, Quotes: p.Quotes, Messages: p.Messages,
		})
	}
	items, err := s.Overview.Activity(ctx, t, 12)
	if err != nil {
		return nil, err
	}
	activity := activityPayload(items)
	return GetOverview200JSONResponse{
		Activity:    activity,
		Days:        days,
		Series:      series,
		GeneratedAt: time.Now().UTC(),
		Counts: OverviewCounts{
			OpenRequests: c.OpenRequests, ShippedRequests: c.ShippedRequests,
			People: c.People, Accounts: c.Accounts, Quotes: c.Quotes,
			SuggestionsWaiting: c.Suggestions, MessagesWaiting: c.Messages,
			Findings: c.Findings, SurveysOpen: c.SurveysOpen, ReleasesPublished: c.Releases,
			RequestsLast7d: c.RequestsLast7d, QuotesLast7d: c.QuotesLast7d, PeopleLast7d: c.PeopleLast7d,
		},
	}, nil
}

func activityPayload(items []overview.Activity) []OverviewActivity {
	out := make([]OverviewActivity, 0, len(items))
	for _, a := range items {
		item := OverviewActivity{
			Kind: OverviewActivityKind(a.Kind), Id: a.ID, Title: a.Title, Detail: a.Detail, At: a.At,
		}
		if a.ParentID != nil {
			item.ParentId = a.ParentID
		}
		if a.ParentKind != "" {
			k := OverviewActivityParentKind(a.ParentKind)
			item.ParentKind = &k
		}
		out = append(out, item)
	}
	return out
}

func encodeActivityCursor(c *overview.ActivityCursor) string {
	if c == nil {
		return ""
	}
	raw, _ := json.Marshal(map[string]any{"at": c.At.UTC(), "id": c.ID})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeActivityCursor(value *string) (*overview.ActivityCursor, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(*value)
	if err != nil {
		return nil, badRequest("That page cursor is not valid.")
	}
	var payload struct {
		At time.Time `json:"at"`
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.At.IsZero() || payload.ID == uuid.Nil {
		return nil, badRequest("That page cursor is not valid.")
	}
	return &overview.ActivityCursor{At: payload.At, ID: payload.ID}, nil
}

func (s *Server) ListWorkspaceActivity(ctx context.Context, req ListWorkspaceActivityRequestObject) (ListWorkspaceActivityResponseObject, error) {
	if s.Overview == nil {
		return nil, errNotConfigured
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	kind := ""
	if req.Params.Kind != nil {
		kind = string(*req.Params.Kind)
	}
	limit := 20
	if req.Params.Limit != nil {
		limit = int(*req.Params.Limit)
	}
	before, err := decodeActivityCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	items, next, err := s.Overview.ActivityPage(ctx, t, kind, before, limit)
	if err != nil {
		return nil, err
	}
	out := ListWorkspaceActivity200JSONResponse{Items: activityPayload(items)}
	if next != nil {
		cursor := encodeActivityCursor(next)
		out.NextCursor = &cursor
	}
	return out, nil
}
