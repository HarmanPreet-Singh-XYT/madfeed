package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/portability"
	"product/api/internal/quality"
	"product/api/internal/store"
)

func qualityCounts(c quality.Counts) QualityCounts {
	return QualityCounts{Accepted: c.Accepted, AcceptedEdited: c.AcceptedEdited, Dismissed: c.Dismissed, StillOpen: c.StillOpen}
}

func qualityRates(r quality.Rates) QualityRates {
	conv := func(f *float64) *float32 {
		if f == nil {
			return nil
		}
		v := float32(*f)
		return &v
	}
	return QualityRates{Accepted: conv(r.Accepted), AcceptedAsIs: conv(r.AcceptedAsIs), EditedOfAccepted: conv(r.EditedOfAccepted), Dismissed: conv(r.Dismissed)}
}

func (s *Server) GetQuality(ctx context.Context, req GetQualityRequestObject) (GetQualityResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if s.Quality == nil {
		return nil, errNotConfigured
	}
	days := 30
	if req.Params.Days != nil {
		days = *req.Params.Days
	}
	v, err := s.Quality.Get(ctx, t, days)
	if err != nil {
		return nil, err
	}
	out := GetQuality200JSONResponse{
		Days: v.Days, EnoughData: v.EnoughData, MinDecided: quality.MinDecided,
		Total:    QualityGroup{Counts: qualityCounts(v.Total), Rates: qualityRates(v.Rates)},
		Previous: QualityGroup{Counts: qualityCounts(v.Previous), Rates: qualityRates(v.PreviousRates)},
		BySource: make([]QualitySource, 0, len(v.BySource)), ByWeek: make([]QualityWeek, 0, len(v.ByWeek)), Ai: make([]AICost, 0, len(v.AI)),
	}
	for _, b := range v.BySource {
		out.BySource = append(out.BySource, QualitySource{Kind: b.Kind, Counts: qualityCounts(b.Counts), Rates: qualityRates(b.Rates)})
	}
	for _, w := range v.ByWeek {
		out.ByWeek = append(out.ByWeek, QualityWeek{WeekStart: w.WeekStart, Counts: qualityCounts(w.Counts), Rates: qualityRates(w.Rates)})
	}
	out.PublicSignals = make([]struct {
		Count   int    `json:"count"`
		Verdict string `json:"verdict"`
	}, 0, len(v.PublicSignals))
	for _, s := range v.PublicSignals {
		out.PublicSignals = append(out.PublicSignals, struct {
			Count   int    `json:"count"`
			Verdict string `json:"verdict"`
		}{Count: s.Count, Verdict: s.Verdict})
	}
	out.AlreadyPossible = make([]struct {
		Id    openapi_types.UUID `json:"id"`
		Title string             `json:"title"`
		Urls  []string           `json:"urls"`
	}, 0, len(v.AlreadyPossible))
	for _, a := range v.AlreadyPossible {
		out.AlreadyPossible = append(out.AlreadyPossible, struct {
			Id    openapi_types.UUID `json:"id"`
			Title string             `json:"title"`
			Urls  []string           `json:"urls"`
		}{Id: uuid.MustParse(a.ID), Title: a.Title, Urls: a.URLs})
	}
	for _, a := range v.AI {
		out.Ai = append(out.Ai, AICost{Task: a.Task, Provider: a.Provider, Model: a.Model, Calls: a.Calls, Errors: a.Errors, CostUsd: a.CostUSD, InputTokens: a.InputTokens, OutputTokens: a.OutputTokens})
	}
	return out, nil
}

// exportStream writes the export as the response body. Authorisation happens
// before this is returned, so a refusal is still a normal JSON error.
type exportStream struct {
	run func(w http.ResponseWriter) error
}

func (e exportStream) VisitExportWorkspaceResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="workspace-export.json"`)
	return e.run(w)
}

func (s *Server) ExportWorkspace(ctx context.Context, req ExportWorkspaceRequestObject) (ExportWorkspaceResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if s.Portability == nil {
		return nil, errNotConfigured
	}
	if !t.Can(store.PermManage) {
		return nil, errForbidden
	}
	return exportStream{run: func(w http.ResponseWriter) error {
		err := s.Portability.Export(ctx, t, w)
		if errors.Is(err, portability.ErrNotAdmin) {
			return errForbidden
		}
		return err
	}}, nil
}
