package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/apikey"
	"product/api/internal/auth"
	"product/api/internal/ratelimit"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/views"
)

// ---- managing keys (admins, signed in) ----

func (s *Server) keysReady() error {
	if s.APIKeys == nil {
		return errNotConfigured
	}
	return nil
}

func apiKeyBody(k apikey.Key) ApiKey {
	return ApiKey{Id: k.ID, Name: k.Name, Prefix: k.Prefix, CreatedAt: k.CreatedAt, LastUsedAt: k.LastUsedAt, Revoked: k.Revoked}
}

func (s *Server) ListApiKeys(ctx context.Context, req ListApiKeysRequestObject) (ListApiKeysResponseObject, error) {
	if err := s.keysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	ks, err := s.APIKeys.List(ctx, t)
	if err != nil {
		return nil, err
	}
	out := ListApiKeys200JSONResponse{Keys: make([]ApiKey, 0, len(ks))}
	for _, k := range ks {
		out.Keys = append(out.Keys, apiKeyBody(k))
	}
	return out, nil
}

func (s *Server) CreateApiKey(ctx context.Context, req CreateApiKeyRequestObject) (CreateApiKeyResponseObject, error) {
	if err := s.keysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	k, secret, err := s.APIKeys.Create(ctx, t, req.Body.Name)
	if err != nil {
		return nil, err
	}
	return CreateApiKey201JSONResponse{Key: apiKeyBody(k), Secret: secret}, nil
}

func (s *Server) RevokeApiKey(ctx context.Context, req RevokeApiKeyRequestObject) (RevokeApiKeyResponseObject, error) {
	if err := s.keysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if err := s.APIKeys.Revoke(ctx, t, req.KeyId); err != nil {
		return nil, err
	}
	return RevokeApiKey204Response{}, nil
}

// ---- using a key (read-only) ----

type extKey struct{ ID, WorkspaceID uuid.UUID }
type extKeyCtx struct{}

// ExtPerMinute is how many requests one key may make a minute.
const ExtPerMinute = 120

// authenticateExt guards /v1/ext/*: it accepts an API key and nothing else (a signed-in user's token
// is refused here, and a key is refused everywhere else). The key becomes a viewer of its workspace.
func authenticateExt(s *Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/v1/ext/") {
				next.ServeHTTP(w, r)
				return
			}
			raw, ok := auth.BearerToken(r)
			if !ok || s.APIKeys == nil {
				writeError(w, r, errUnauthorized)
				return
			}
			kid, ws, err := s.APIKeys.Authenticate(r.Context(), raw)
			if err != nil {
				writeError(w, r, errUnauthorized)
				return
			}
			if s.Limiter != nil {
				if d := s.Limiter.Allow(r.Context(), "ext", kid.String(), ExtPerMinute, 60); !d.Allowed {
					ratelimit.Reject(w, d)
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), extKeyCtx{}, extKey{ID: kid, WorkspaceID: ws})))
		})
	}
}

// extTenant is the key's place in its workspace: a viewer, who can read and ask but change nothing.
func extTenant(ctx context.Context) (store.Tenant, error) {
	k, ok := ctx.Value(extKeyCtx{}).(extKey)
	if !ok {
		return store.Tenant{}, errUnauthorized
	}
	return store.Tenant{WorkspaceID: k.WorkspaceID, UserID: k.ID, Role: store.RoleViewer}, nil
}

func (s *Server) ExtListRequests(ctx context.Context, req ExtListRequestsRequestObject) (ExtListRequestsResponseObject, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	t, err := extTenant(ctx)
	if err != nil {
		return nil, err
	}
	limit := 20
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	var search pgtype.Text
	if req.Params.Q != nil {
		if q := views.CleanSearch(*req.Params.Q); q != "" {
			search = pgtype.Text{String: views.LikePattern(q), Valid: true}
		}
	}
	var v pgtype.Numeric
	_ = v.Scan("9999999999999999")
	out := ExtListRequests200JSONResponse{Requests: []ExtRequestSummary{}}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rs, err := q.ListRequestSummariesByValue(ctx, dbgen.ListRequestSummariesByValueParams{WorkspaceID: t.WorkspaceID, BeforeValue: v, BeforeID: uuid.Max, PageSize: int32(limit), Search: search})
		for _, r := range rs {
			out.Requests = append(out.Requests, ExtRequestSummary{
				Id: r.ID, Title: r.Title,
				Impact: impactOf(r.EvidenceCount, r.PeopleCount, r.AccountCount, r.AccountsWithValue, r.TotalValue, r.NewestEvidenceAt),
				Status: StatusRef{Id: r.StatusID, Name: r.StatusName, Bucket: StatusRefBucket(r.StatusBucket)},
			})
		}
		return err
	})
	return out, err
}

func (s *Server) ExtGetRequest(ctx context.Context, req ExtGetRequestRequestObject) (ExtGetRequestResponseObject, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	t, err := extTenant(ctx)
	if err != nil {
		return nil, err
	}
	var out ExtRequest
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: req.RequestId})
		if err != nil {
			return err // no such request in this workspace: a plain not found
		}
		im, err := q.GetRequestImpact(ctx, dbgen.GetRequestImpactParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		st, err := q.GetStatus(ctx, dbgen.GetStatusParams{WorkspaceID: t.WorkspaceID, ID: r.StatusID})
		if err != nil {
			return err
		}
		evs, err := q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		tags, err := q.ListTagsForRequest(ctx, dbgen.ListTagsForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		out = ExtRequest{
			Id: r.ID, Title: r.Title,
			Status:   StatusRef{Id: st.ID, Name: st.Name, Bucket: StatusRefBucket(st.Bucket)},
			Impact:   impactOf(im.EvidenceCount, im.PeopleCount, im.AccountCount, im.AccountsWithValue, im.TotalValue, im.NewestEvidenceAt),
			Evidence: make([]Evidence, 0, len(evs)), Tags: make([]TagRef, 0, len(tags)),
		}
		for _, e := range evs {
			ev := Evidence{Id: e.ID, SourceItemId: e.SourceItemID, Quote: e.QuoteText, SpanStart: int(e.SpanStart), SpanEnd: int(e.SpanEnd), CreatedAt: e.CreatedAt}
			out.Evidence = append(out.Evidence, ev)
		}
		for _, tg := range tags {
			out.Tags = append(out.Tags, TagRef{Id: tg.ID, Name: tg.Name, Color: tg.Color})
		}
		return nil
	})
	if err == pgx.ErrNoRows {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	return ExtGetRequest200JSONResponse(out), nil
}

func (s *Server) ExtAsk(ctx context.Context, req ExtAskRequestObject) (ExtAskResponseObject, error) {
	if s.Research == nil || s.QA == nil {
		return nil, errNotConfigured
	}
	t, err := extTenant(ctx)
	if err != nil {
		return nil, err
	}
	a, err := s.QA.Ask(ctx, t, req.Body.Question)
	if err != nil {
		return nil, err
	}
	return ExtAsk200JSONResponse(answerOut(a)), nil
}
