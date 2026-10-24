package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"product/api/internal/billing"
	"product/api/internal/media"
	"product/api/internal/research"
	"product/api/internal/store"
)

func (s *Server) mediaTenant(ctx context.Context, ws uuid.UUID) (store.Tenant, error) {
	if s.Media == nil {
		return store.Tenant{}, errNotConfigured
	}
	return s.tenant(ctx, ws)
}

func mediaOut(u media.Upload) Media {
	out := Media{Id: u.ID, Filename: u.Filename, MimeType: u.MimeType, SizeBytes: u.SizeBytes, ReceivedBytes: u.ReceivedBytes,
		ChunkBytes: u.ChunkBytes, State: MediaState(u.State), CreatedAt: u.CreatedAt, SourceItemId: u.SourceItemID, PersonId: u.PersonID}
	if u.FailureReason != "" {
		out.FailureReason = &u.FailureReason
	}
	if u.State == "done" {
		d := u.DurationMS
		out.DurationMs = &d
	}
	return out
}

func (s *Server) StartUpload(ctx context.Context, req StartUploadRequestObject) (StartUploadResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Tell us the file name, type and size.")
	}
	if err := s.entitled(ctx, t.WorkspaceID, billing.FeatureRecordings); err != nil {
		return nil, err
	}
	u, err := s.Media.Start(ctx, t, req.Body.Filename, req.Body.MimeType, req.Body.SizeBytes, req.Body.PersonId)
	if err != nil {
		return nil, err
	}
	return StartUpload201JSONResponse(mediaOut(u)), nil
}

func (s *Server) ListMedia(ctx context.Context, req ListMediaRequestObject) (ListMediaResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Media.List(ctx, t)
	if err != nil {
		return nil, err
	}
	out := make([]Media, 0, len(rows))
	for _, r := range rows {
		out = append(out, mediaOut(r))
	}
	return ListMedia200JSONResponse{Media: out}, nil
}

func (s *Server) GetMedia(ctx context.Context, req GetMediaRequestObject) (GetMediaResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	u, err := s.Media.Get(ctx, t, req.MediaId)
	if err != nil {
		return nil, err
	}
	return GetMedia200JSONResponse(mediaOut(u)), nil
}

func (s *Server) DeleteMedia(ctx context.Context, req DeleteMediaRequestObject) (DeleteMediaResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Media.Delete(ctx, t, req.MediaId); err != nil {
		return nil, err
	}
	return DeleteMedia204Response{}, nil
}

func (s *Server) UploadChunk(ctx context.Context, req UploadChunkRequestObject) (UploadChunkResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("The chunk is empty.")
	}
	u, err := s.Media.Append(ctx, t, req.MediaId, req.Params.Offset, req.Body)
	if errors.Is(err, media.ErrOffset) {
		return nil, &APIError{http.StatusConflict, "wrong_position", fmt.Sprintf("That piece does not start where the server expects (it has %d bytes). Ask for the upload's state and continue from there.", u.ReceivedBytes)}
	}
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return nil, &APIError{http.StatusRequestEntityTooLarge, "chunk_too_large", "That piece is larger than allowed. Send smaller pieces."}
		}
		return nil, err
	}
	return UploadChunk200JSONResponse(mediaOut(u)), nil
}

func (s *Server) CompleteUpload(ctx context.Context, req CompleteUploadRequestObject) (CompleteUploadResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	u, err := s.Media.Complete(ctx, t, req.MediaId)
	if err != nil {
		return nil, err
	}
	return CompleteUpload200JSONResponse(mediaOut(u)), nil
}

// parseRange reads a single "bytes=a-b" range. ok=false means "ignore the header and send everything";
// valid=false means the range cannot be satisfied.
func parseRange(h string, size int64) (start, length int64, ok, valid bool) {
	if h == "" || !strings.HasPrefix(h, "bytes=") || strings.Contains(h, ",") {
		return 0, size, false, true
	}
	a, b, found := strings.Cut(strings.TrimPrefix(h, "bytes="), "-")
	if !found {
		return 0, size, false, true
	}
	switch {
	case a == "": // the last n bytes
		n, err := strconv.ParseInt(b, 10, 64)
		if err != nil || n <= 0 {
			return 0, 0, true, false
		}
		if n > size {
			n = size
		}
		return size - n, n, true, true
	default:
		st, err := strconv.ParseInt(a, 10, 64)
		if err != nil || st < 0 || st >= size {
			return 0, 0, true, false
		}
		end := size - 1
		if b != "" {
			e, err := strconv.ParseInt(b, 10, 64)
			if err != nil || e < st {
				return 0, 0, true, false
			}
			if e < end {
				end = e
			}
		}
		return st, end - st + 1, true, true
	}
}

type limitedCloser struct {
	io.Reader
	c io.Closer
}

func (l limitedCloser) Close() error { return l.c.Close() }

func (s *Server) GetMediaFile(ctx context.Context, req GetMediaFileRequestObject) (GetMediaFileResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	obj, _, err := s.Media.Open(ctx, t, req.MediaId)
	if err != nil {
		return nil, err
	}
	size := obj.Size()
	hdr := ""
	if req.Params.Range != nil {
		hdr = *req.Params.Range
	}
	start, length, ranged, valid := parseRange(hdr, size)
	if !valid {
		_ = obj.Close()
		cr := fmt.Sprintf("bytes */%d", size)
		return GetMediaFile416Response{Headers: GetMediaFile416ResponseHeaders{ContentRange: &cr}}, nil
	}
	accept := "bytes"
	if !ranged {
		return GetMediaFile200ApplicationoctetStreamResponse{Body: obj, ContentLength: size, Headers: GetMediaFile200ResponseHeaders{AcceptRanges: &accept}}, nil
	}
	if _, err := obj.Seek(start, io.SeekStart); err != nil {
		_ = obj.Close()
		return nil, err
	}
	cr := fmt.Sprintf("bytes %d-%d/%d", start, start+length-1, size)
	return GetMediaFile206ApplicationoctetStreamResponse{Body: limitedCloser{io.LimitReader(obj, length), obj}, ContentLength: length,
		Headers: GetMediaFile206ResponseHeaders{AcceptRanges: &accept, ContentRange: &cr}}, nil
}

func (s *Server) GetTranscript(ctx context.Context, req GetTranscriptRequestObject) (GetTranscriptResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	id, segs, err := s.Media.Segments(ctx, t, req.SourceItemId)
	if err != nil {
		return nil, err
	}
	out := make([]Segment, 0, len(segs))
	for _, g := range segs {
		out = append(out, Segment{Ordinal: g.Ordinal, StartMs: g.StartMS, EndMs: g.EndMS, Speaker: g.Speaker, SpanStart: g.SpanStart, SpanEnd: g.SpanEnd})
	}
	return GetTranscript200JSONResponse{MediaId: id, Segments: out}, nil
}

func (s *Server) DeleteSource(ctx context.Context, req DeleteSourceRequestObject) (DeleteSourceResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Media.DeleteSource(ctx, t, req.SourceItemId); err != nil {
		return nil, err
	}
	return DeleteSource204Response{}, nil
}

func (s *Server) DeletePerson(ctx context.Context, req DeletePersonRequestObject) (DeletePersonResponseObject, error) {
	t, err := s.mediaTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Media.DeletePerson(ctx, t, req.PersonId); err != nil {
		return nil, err
	}
	return DeletePerson204Response{}, nil
}

// ---- highlight suggestions ----

func (s *Server) RequestHighlightSuggestions(ctx context.Context, req RequestHighlightSuggestionsRequestObject) (RequestHighlightSuggestionsResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Research.RequestSuggestions(ctx, t, req.SourceItemId); err != nil {
		return nil, err
	}
	return RequestHighlightSuggestions202Response{}, nil
}

func (s *Server) ListHighlightSuggestions(ctx context.Context, req ListHighlightSuggestionsRequestObject) (ListHighlightSuggestionsResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	rows, err := s.Research.ListSuggestions(ctx, t, req.SourceItemId)
	if err != nil {
		return nil, err
	}
	out := make([]HighlightSuggestion, 0, len(rows))
	for _, r := range rows {
		tags := make([]TagRef, 0, len(r.Tags))
		for _, tg := range r.Tags {
			tags = append(tags, TagRef{Id: tg.ID, Name: tg.Name, Color: tg.Color})
		}
		out = append(out, HighlightSuggestion{Id: r.ID, Quote: r.Quote, SpanStart: r.SpanStart, SpanEnd: r.SpanEnd, Confidence: float32(r.Confidence), Tags: tags})
	}
	return ListHighlightSuggestions200JSONResponse{Suggestions: out}, nil
}

func (s *Server) AcceptHighlightSuggestion(ctx context.Context, req AcceptHighlightSuggestionRequestObject) (AcceptHighlightSuggestionResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	var tagIDs []uuid.UUID
	if req.Body != nil && req.Body.TagIds != nil {
		tagIDs = *req.Body.TagIds
		if tagIDs == nil {
			tagIDs = []uuid.UUID{}
		}
	}
	h, err := s.Research.AcceptSuggestion(ctx, t, req.SuggestionId, tagIDs)
	if err != nil {
		return nil, err
	}
	return AcceptHighlightSuggestion201JSONResponse(highlightOut(h)), nil
}

func (s *Server) DismissHighlightSuggestion(ctx context.Context, req DismissHighlightSuggestionRequestObject) (DismissHighlightSuggestionResponseObject, error) {
	t, err := s.researchTenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.Research.DismissSuggestion(ctx, t, req.SuggestionId); err != nil {
		return nil, err
	}
	return DismissHighlightSuggestion204Response{}, nil
}

var _ = research.ErrNotFound
