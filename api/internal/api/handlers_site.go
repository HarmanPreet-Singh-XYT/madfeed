package api

import (
	"context"
	"net/http"
	"strings"

	"product/api/internal/publicsite"
)

type originKey struct{}

var errOrigin = &APIError{http.StatusForbidden, "origin_not_allowed", "This page is not allowed to send feedback here."}

// siteCORS lets a browser on an allowed site post to the feedback form and nobody
// else's: the answer to the browser's preflight and the cross-site header are given
// only when the page's origin is on the workspace's list. The origin is also handed
// to the handler, which checks it again (a non-browser client can omit the header).
func siteCORS(svc *publicsite.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slug, ok := feedbackSlug(r.URL.Path)
			if !ok || svc == nil {
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			allowed := origin != "" && svc.OriginAllowed(r.Context(), slug, origin)
			if allowed {
				w.Header().Add("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			if r.Method == http.MethodOptions {
				if allowed {
					w.Header().Set("Access-Control-Allow-Methods", "POST")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
					w.Header().Set("Access-Control-Max-Age", "600")
					w.WriteHeader(http.StatusNoContent)
				} else {
					writeError(w, r, errOrigin)
				}
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), originKey{}, origin)))
		})
	}
}

func feedbackSlug(path string) (string, bool) {
	rest, ok := strings.CutPrefix(path, "/v1/public/sites/")
	if !ok {
		return "", false
	}
	slug, tail, ok := strings.Cut(rest, "/")
	if !ok || tail != "feedback" || slug == "" {
		return "", false
	}
	return slug, true
}

func (s *Server) siteReady() error {
	if s.Site == nil {
		return errNotConfigured
	}
	return nil
}

func formSettingsBody(st publicsite.Settings) FeedbackFormSettings {
	out := FeedbackFormSettings{Enabled: st.Enabled, Origins: st.Origins, HasPublicAddress: st.PublicSlug != ""}
	if st.Key != "" {
		out.Key = &st.Key
	}
	if st.PublicSlug != "" {
		out.PublicSlug = &st.PublicSlug
	}
	return out
}

func (s *Server) GetFeedbackForm(ctx context.Context, req GetFeedbackFormRequestObject) (GetFeedbackFormResponseObject, error) {
	if err := s.siteReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	st, err := s.Site.GetSettings(ctx, t)
	if err != nil {
		return nil, err
	}
	return GetFeedbackForm200JSONResponse(formSettingsBody(st)), nil
}

func (s *Server) UpdateFeedbackForm(ctx context.Context, req UpdateFeedbackFormRequestObject) (UpdateFeedbackFormResponseObject, error) {
	if err := s.siteReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rotate := req.Body.RotateKey != nil && *req.Body.RotateKey
	st, err := s.Site.UpdateSettings(ctx, t, req.Body.Enabled, req.Body.Origins, rotate)
	if err != nil {
		return nil, err
	}
	return UpdateFeedbackForm200JSONResponse(formSettingsBody(st)), nil
}

func (s *Server) ForgetFormSubmitter(ctx context.Context, req ForgetFormSubmitterRequestObject) (ForgetFormSubmitterResponseObject, error) {
	if err := s.siteReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	n, err := s.Site.ForgetSubmitter(ctx, t, req.Body.Email)
	if err != nil {
		return nil, err
	}
	return ForgetFormSubmitter200JSONResponse{Removed: n}, nil
}

func (s *Server) SetRequestPublic(ctx context.Context, req SetRequestPublicRequestObject) (SetRequestPublicResponseObject, error) {
	if err := s.siteReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	summary := ""
	if req.Body.Summary != nil {
		summary = *req.Body.Summary
	}
	if err := s.Site.SetRequestPublic(ctx, t, req.RequestId, req.Body.Public, summary); err != nil {
		return nil, err
	}
	return SetRequestPublic204Response{}, nil
}

func (s *Server) SubmitFeedback(ctx context.Context, req SubmitFeedbackRequestObject) (SubmitFeedbackResponseObject, error) {
	if err := s.siteReady(); err != nil {
		return nil, err
	}
	origin, _ := ctx.Value(originKey{}).(string)
	email := ""
	if req.Body.Email != nil {
		email = *req.Body.Email
	}
	err := s.Site.Submit(ctx, publicsite.Submission{Slug: req.Slug, Key: req.Body.Key, Origin: origin, Text: req.Body.Text, Email: email})
	if err != nil {
		return nil, err
	}
	return SubmitFeedback202JSONResponse{Received: true}, nil
}

func (s *Server) GetPublicRoadmap(ctx context.Context, req GetPublicRoadmapRequestObject) (GetPublicRoadmapResponseObject, error) {
	if err := s.siteReady(); err != nil {
		return nil, err
	}
	rm, err := s.Site.PublicRoadmap(ctx, req.Slug)
	if err != nil {
		return nil, err
	}
	out := GetPublicRoadmap200JSONResponse{WorkspaceName: rm.WorkspaceName, Items: make([]PublicRoadmapItem, 0, len(rm.Items))}
	for _, it := range rm.Items {
		out.Items = append(out.Items, PublicRoadmapItem{Id: it.ID, Title: it.Title, Summary: it.Summary, Status: it.Status, Bucket: PublicRoadmapItemBucket(it.Bucket)})
	}
	return out, nil
}
