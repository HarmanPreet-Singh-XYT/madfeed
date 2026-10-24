package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/apikey"
	"product/api/internal/auth"
	"product/api/internal/intake"
	"product/api/internal/promptguard"
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
	out := ApiKey{Id: k.ID, Name: k.Name, Prefix: k.Prefix, CreatedAt: k.CreatedAt, LastUsedAt: k.LastUsedAt, ExpiresAt: k.ExpiresAt, Revoked: k.Revoked}
	scopes := make([]ApiKeyScopes, 0, len(k.Scopes))
	for _, sc := range k.Scopes {
		scopes = append(scopes, ApiKeyScopes(sc))
	}
	out.Scopes = &scopes
	cidrs := append([]string{}, k.AllowedCIDRs...)
	out.AllowedCidrs = &cidrs
	return out
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
	if s.Billing != nil && s.Billing.Enabled() {
		active := 0
		if ks, lerr := s.APIKeys.List(ctx, t); lerr == nil {
			for _, k := range ks {
				if !k.Revoked {
					active++
				}
			}
		}
		if err := s.keyAllowance(ctx, t.WorkspaceID, active); err != nil {
			return nil, err
		}
	}
	var o apikey.Options
	if req.Body.Scopes != nil {
		for _, sc := range *req.Body.Scopes {
			o.Scopes = append(o.Scopes, string(sc))
		}
	}
	if req.Body.ExpiresInDays != nil {
		o.ExpiresInDays = *req.Body.ExpiresInDays
	}
	if req.Body.AllowedCidrs != nil {
		o.AllowedCIDRs = *req.Body.AllowedCidrs
	}
	k, secret, err := s.APIKeys.Create(ctx, t, req.Body.Name, o)
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

func (s *Server) ListApiKeyEvents(ctx context.Context, req ListApiKeyEventsRequestObject) (ListApiKeyEventsResponseObject, error) {
	if err := s.keysReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	evs, err := s.APIKeys.Events(ctx, t, req.KeyId)
	if err != nil {
		return nil, err
	}
	type ev = struct {
		Action ListApiKeyEvents200JSONResponseBodyEventsAction `json:"action"`
		At     time.Time                                       `json:"at"`
		Detail string                                          `json:"detail"`
		Ok     bool                                            `json:"ok"`
	}
	out := ListApiKeyEvents200JSONResponse{Events: make([]ev, 0, len(evs))}
	for _, e := range evs {
		out.Events = append(out.Events, ev{Action: ListApiKeyEvents200JSONResponseBodyEventsAction(e.Action), At: e.At, Detail: e.Detail, Ok: e.OK})
	}
	return out, nil
}

// ---- using a key ----

type extKeyCtx struct{}

// ExtPerMinute is how many requests one key may make a minute; ExtSubmitPerDay how many notes it may add.
const (
	ExtPerMinute    = 120
	ExtSubmitPerDay = 500
)

var errScope = &APIError{http.StatusForbidden, "scope_missing", "This key is not allowed to do that."}

// authenticateExt guards /v1/ext/*: it accepts an API key and nothing else (a signed-in user's token
// is refused here, and a key is refused everywhere else). A key that is revoked, expired or used from
// an address it is not allowed from looks exactly like a wrong key.
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
			info, err := s.APIKeys.Authenticate(r.Context(), raw, ratelimit.RealIP(r, s.Limits.TrustedHops))
			if err != nil {
				writeError(w, r, errUnauthorized)
				return
			}
			if s.Limiter != nil {
				if d := s.Limiter.Allow(r.Context(), "ext", info.ID.String(), ExtPerMinute, 60); !d.Allowed {
					ratelimit.Reject(w, d)
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), extKeyCtx{}, info)))
		})
	}
}

// extAccess is the key behind this request, checked for the permission the route needs. The key acts as
// a viewer of its workspace (or a member who can only add notes to the review queue).
func extAccess(ctx context.Context, scope string) (apikey.Info, store.Tenant, error) {
	in, ok := ctx.Value(extKeyCtx{}).(apikey.Info)
	if !ok {
		return apikey.Info{}, store.Tenant{}, errUnauthorized
	}
	if !in.Has(scope) {
		return in, store.Tenant{}, errScope
	}
	return in, store.Tenant{WorkspaceID: in.WorkspaceID, UserID: in.ID, Role: store.RoleViewer}, nil
}

func (s *Server) note(ctx context.Context, in apikey.Info, action, detail string, err error) {
	if s.APIKeys != nil && in.ID != uuid.Nil {
		s.APIKeys.Record(ctx, in, action, detail, err == nil)
	}
}

func (s *Server) ExtListRequests(ctx context.Context, req ExtListRequestsRequestObject) (ExtListRequestsResponseObject, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	in, t, err := extAccess(ctx, apikey.ScopeRequests)
	if err != nil {
		return nil, err
	}
	limit := 20
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	var search pgtype.Text
	detail := ""
	if req.Params.Q != nil {
		if q := views.CleanSearch(*req.Params.Q); q != "" {
			search = pgtype.Text{String: views.LikePattern(q), Valid: true}
			detail = "search: " + q
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
	s.note(ctx, in, "list", detail, err)
	return out, err
}

func (s *Server) ExtGetRequest(ctx context.Context, req ExtGetRequestRequestObject) (ExtGetRequestResponseObject, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	in, t, err := extAccess(ctx, apikey.ScopeRequests)
	if err != nil {
		return nil, err
	}
	withQuotes := in.Has(apikey.ScopeQuotes)
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
		tags, err := q.ListTagsForRequest(ctx, dbgen.ListTagsForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
		if err != nil {
			return err
		}
		out = ExtRequest{
			Id: r.ID, Title: r.Title, QuotesIncluded: withQuotes,
			Status:   StatusRef{Id: st.ID, Name: st.Name, Bucket: StatusRefBucket(st.Bucket)},
			Impact:   impactOf(im.EvidenceCount, im.PeopleCount, im.AccountCount, im.AccountsWithValue, im.TotalValue, im.NewestEvidenceAt),
			Evidence: []ExtEvidence{}, Tags: make([]TagRef, 0, len(tags)),
		}
		if withQuotes {
			evs, err := q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: r.ID})
			if err != nil {
				return err
			}
			for _, e := range evs {
				flagged, _ := promptguard.Suspicious(e.QuoteText)
				out.Evidence = append(out.Evidence, ExtEvidence{Id: e.ID, SourceItemId: e.SourceItemID, Quote: e.QuoteText, SpanStart: int(e.SpanStart), SpanEnd: int(e.SpanEnd), Flagged: flagged})
			}
		}
		for _, tg := range tags {
			out.Tags = append(out.Tags, TagRef{Id: tg.ID, Name: tg.Name, Color: tg.Color})
		}
		return nil
	})
	s.note(ctx, in, "get", req.RequestId.String(), err)
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
	in, t, err := extAccess(ctx, apikey.ScopeAsk)
	if err != nil {
		return nil, err
	}
	a, err := s.QA.Ask(ctx, t, req.Body.Question)
	s.note(ctx, in, "ask", req.Body.Question, err)
	if err != nil {
		return nil, err
	}
	out := ExtAsk200JSONResponse{Outcome: ExtAnswerOutcome(a.Outcome), Text: a.Text, Reason: a.Reason, Citations: make([]ExtCitation, 0, len(a.Citations))}
	for _, c := range a.Citations {
		flagged, _ := promptguard.Suspicious(c.Quote)
		out.ContainsFlaggedQuotes = out.ContainsFlaggedQuotes || flagged
		out.Citations = append(out.Citations, ExtCitation{Number: c.Number, Kind: ExtCitationKind(c.Kind), Id: c.ID, SourceItemId: c.SourceItemID, SpanStart: c.SpanStart, SpanEnd: c.SpanEnd, Quote: c.Quote, Flagged: flagged})
	}
	return out, nil
}

// ExtSubmitFeedback adds a note to the review queue. It goes through the same redaction, size limits and
// daily allowance as any pasted conversation, and nothing comes of it until a person accepts a suggestion.
func (s *Server) ExtSubmitFeedback(ctx context.Context, req ExtSubmitFeedbackRequestObject) (ExtSubmitFeedbackResponseObject, error) {
	if s.Intake == nil {
		return nil, errNotConfigured
	}
	in, _, err := extAccess(ctx, apikey.ScopeSubmit)
	if err != nil {
		return nil, err
	}
	if s.Limiter != nil {
		if d := s.Limiter.Allow(ctx, "ext-submit", in.ID.String(), ExtSubmitPerDay, 86400); !d.Allowed {
			err := intake.ErrQuota("this key has added its daily limit of notes; try again tomorrow")
			s.note(ctx, in, "submit", "refused: daily limit", err)
			return nil, err
		}
	}
	t := store.Tenant{WorkspaceID: in.WorkspaceID, UserID: in.ID, Role: store.RoleMember}
	b := req.Body
	label := "API: " + in.Name
	if b.Source != nil && strings.TrimSpace(*b.Source) != "" {
		label = strings.TrimSpace(*b.Source)
	}
	if b.Title != nil && strings.TrimSpace(*b.Title) != "" {
		label += ": " + strings.TrimSpace(*b.Title)
	}
	pi := intake.PasteInput{Title: label, Text: b.Text, Kind: "api"}
	if b.Url != nil {
		pi.OriginURL = *b.Url
	}
	if b.ExternalId != nil && *b.ExternalId != "" {
		src := ""
		if b.Source != nil {
			src = strings.TrimSpace(*b.Source)
		}
		pi.ExternalID = src + "|" + *b.ExternalId
	}
	if b.Email != nil && strings.TrimSpace(*b.Email) != "" {
		e := strings.ToLower(strings.TrimSpace(*b.Email))
		if !strings.Contains(e, "@") || len(e) > 320 || strings.ContainsAny(e, " \r\n\t") {
			return nil, badRequest("that email address does not look right")
		}
		pi.SubmitterEmail, pi.LinkEmail = e, e
	}
	res, err := s.Intake.IngestPaste(ctx, t, pi)
	s.note(ctx, in, "submit", "", err)
	if err != nil {
		return nil, err
	}
	return ExtSubmitFeedback202JSONResponse{Received: true, Duplicate: &res.Duplicate}, nil
}
