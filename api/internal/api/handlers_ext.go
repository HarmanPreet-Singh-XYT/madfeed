package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/ai"
	"product/api/internal/apikey"
	"product/api/internal/auth"
	"product/api/internal/callimport"
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
	var statusFilter, tagFilter uuid.NullUUID
	if req.Params.StatusId != nil {
		statusFilter = uuid.NullUUID{UUID: *req.Params.StatusId, Valid: true}
		detail += " status filter"
	}
	if req.Params.TagId != nil {
		tagFilter = uuid.NullUUID{UUID: *req.Params.TagId, Valid: true}
		detail += " tag filter"
	}
	var v pgtype.Numeric
	_ = v.Scan("9999999999999999")
	out := ExtListRequests200JSONResponse{Requests: []ExtRequestSummary{}}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rs, err := q.ListRequestSummariesByValue(ctx, dbgen.ListRequestSummariesByValueParams{WorkspaceID: t.WorkspaceID, BeforeValue: v, BeforeID: uuid.Max, PageSize: int32(limit), Search: search, StatusID: statusFilter, TagID: tagFilter})
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
	pi, err := extNote(in.Name, req.Body.Text, req.Body.Source, req.Body.Title, req.Body.Url, req.Body.ExternalId, req.Body.Email)
	if err != nil {
		return nil, err
	}
	res, err := s.Intake.IngestPaste(ctx, t, pi)
	s.note(ctx, in, "submit", "", err)
	if err != nil {
		return nil, err
	}
	return ExtSubmitFeedback202JSONResponse{Received: true, Duplicate: &res.Duplicate}, nil
}

// extNote builds what is stored for a note or transcript sent in by another tool: where it came from, a link back,
// the other tool's id (so a retry stores nothing new) and, if a person with that email exists, whose it is.
func extNote(keyName, text string, source, title, link, externalID, email *string) (intake.PasteInput, error) {
	val := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	label := "API: " + keyName
	if v := val(source); v != "" {
		label = v
	}
	if v := val(title); v != "" {
		label += ": " + v
	}
	pi := intake.PasteInput{Title: label, Text: text, Kind: "api", OriginURL: val(link)}
	if v := val(externalID); v != "" {
		pi.ExternalID = val(source) + "|" + v
	}
	if e := strings.ToLower(val(email)); e != "" {
		if !strings.Contains(e, "@") || len(e) > 320 || strings.ContainsAny(e, " \r\n\t") {
			return pi, badRequest("that email address does not look right")
		}
		pi.SubmitterEmail, pi.LinkEmail = e, e
	}
	return pi, nil
}

// ExtSubmitTranscript adds a call transcript from another tool. It is read like any pasted conversation.
func (s *Server) ExtSubmitTranscript(ctx context.Context, req ExtSubmitTranscriptRequestObject) (ExtSubmitTranscriptResponseObject, error) {
	if s.Intake == nil {
		return nil, errNotConfigured
	}
	in, _, err := extAccess(ctx, apikey.ScopeSubmit)
	if err != nil {
		return nil, err
	}
	b := req.Body
	var text, used string
	var turns int
	switch {
	case b.Turns != nil && len(*b.Turns) > 0 && (b.Transcript == nil || *b.Transcript == ""):
		ts := make([]callimport.Turn, 0, len(*b.Turns))
		for _, t := range *b.Turns {
			sp := ""
			if t.Speaker != nil {
				sp = *t.Speaker
			}
			ts = append(ts, callimport.Turn{Speaker: sp, Text: t.Text})
		}
		text, turns = callimport.Render(ts)
		used = "turns"
		if turns == 0 {
			return nil, badRequest("the turns contain no words")
		}
	case b.Transcript != nil && *b.Transcript != "" && (b.Turns == nil || len(*b.Turns) == 0):
		f := "auto"
		if b.Format != nil {
			f = string(*b.Format)
		}
		var perr error
		if text, turns, used, perr = callimport.Parse(*b.Transcript, f); perr != nil {
			return nil, badRequest(perr.Error())
		}
	default:
		return nil, badRequest("send either `transcript` or `turns`")
	}
	if s.Limiter != nil {
		if d := s.Limiter.Allow(ctx, "ext-submit", in.ID.String(), ExtSubmitPerDay, 86400); !d.Allowed {
			err := intake.ErrQuota("this key has added its daily limit of notes; try again tomorrow")
			s.note(ctx, in, "submit", "refused: daily limit", err)
			return nil, err
		}
	}
	t := store.Tenant{WorkspaceID: in.WorkspaceID, UserID: in.ID, Role: store.RoleMember}
	pi, err := extNote(in.Name, text, b.Source, b.Title, b.Url, b.ExternalId, b.Email)
	if err != nil {
		return nil, err
	}
	res, err := s.Intake.IngestPaste(ctx, t, pi)
	s.note(ctx, in, "submit", "transcript", err)
	if err != nil {
		return nil, err
	}
	return ExtSubmitTranscript202JSONResponse{Received: true, Duplicate: res.Duplicate, Turns: turns, Format: used}, nil
}

func (s *Server) ExtListStatuses(ctx context.Context, _ ExtListStatusesRequestObject) (ExtListStatusesResponseObject, error) {
	if s.Workflow == nil {
		return nil, errNotConfigured
	}
	in, t, err := extAccess(ctx, apikey.ScopeRequests)
	if err != nil {
		return nil, err
	}
	rows, err := s.Workflow.List(ctx, t)
	s.note(ctx, in, "list", "statuses", err)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]any{"id": r.ID, "name": r.Name, "bucket": r.Bucket})
	}
	return shape[ExtListStatuses200JSONResponse](map[string]any{"statuses": out}), nil
}

func (s *Server) ExtListTags(ctx context.Context, _ ExtListTagsRequestObject) (ExtListTagsResponseObject, error) {
	if s.Research == nil {
		return nil, errNotConfigured
	}
	in, t, err := extAccess(ctx, apikey.ScopeRequests)
	if err != nil {
		return nil, err
	}
	rows, err := s.Research.ListTags(ctx, t, false)
	s.note(ctx, in, "list", "tags", err)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]any{"id": r.ID, "name": r.Name, "definition": r.Definition, "requestCount": r.RequestCount})
	}
	return shape[ExtListTags200JSONResponse](map[string]any{"tags": out}), nil
}

// ExtListReleaseNotes lists the notes that are public right now. They are the company's own words and already
// readable by anyone on the public page.
func (s *Server) ExtListReleaseNotes(ctx context.Context, req ExtListReleaseNotesRequestObject) (ExtListReleaseNotesResponseObject, error) {
	if s.Release == nil {
		return nil, errNotConfigured
	}
	in, t, err := extAccess(ctx, apikey.ScopeRequests)
	if err != nil {
		return nil, err
	}
	limit := 20
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	out := make([]map[string]any, 0, limit)
	var before = time.Now().AddDate(1, 0, 0)
	beforeID := uuid.Max
	for page := 0; page < 5 && len(out) < limit; page++ { // notes that are not live are skipped; look a few pages deep
		notes, err := s.Release.List(ctx, t, before, beforeID, 100)
		if err != nil {
			s.note(ctx, in, "list", "release notes", err)
			return nil, err
		}
		for _, n := range notes {
			if n.LiveNow && len(out) < limit {
				m := map[string]any{"id": n.ID, "title": n.Title, "body": n.Body}
				if n.PublishedAt != nil {
					m["publishedAt"] = n.PublishedAt
				}
				out = append(out, m)
			}
		}
		if len(notes) < 100 {
			break
		}
		last := notes[len(notes)-1]
		before, beforeID = last.CreatedAt, last.ID
	}
	s.note(ctx, in, "list", "release notes", nil)
	return shape[ExtListReleaseNotes200JSONResponse](map[string]any{"notes": out}), nil
}

// ExtSearchQuotes finds quotes by meaning, for a key allowed to read quotes. Quotes that look like instructions
// aimed at an AI are flagged so the assistant side can withhold them.
func (s *Server) ExtSearchQuotes(ctx context.Context, req ExtSearchQuotesRequestObject) (ExtSearchQuotesResponseObject, error) {
	in, t, err := extAccess(ctx, apikey.ScopeQuotes)
	if err != nil {
		return nil, err
	}
	hits := []map[string]any{}
	if s.Match == nil || !s.Match.Ready() {
		return shape[ExtSearchQuotes200JSONResponse](map[string]any{"ready": false, "hits": hits}), nil
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
		if err := s.Match.RequestIndex(ctx, t); err != nil {
			return nil, err
		}
	}
	found, err := s.Match.SearchQuotes(ctx, t, req.Params.Q, limit)
	s.note(ctx, in, "search", "quotes by meaning", err)
	if errors.Is(err, ai.ErrBudgetExceeded) {
		return nil, &APIError{http.StatusTooManyRequests, "ai_allowance_used", "Today's AI allowance for this workspace is used up. Searching by meaning works again when it renews."}
	}
	if err != nil {
		return nil, err
	}
	for _, h := range found {
		flagged, _ := promptguard.Suspicious(h.Text)
		hits = append(hits, map[string]any{"kind": h.Kind, "quote": h.Text, "sourceItemId": h.SourceID, "sourceTitle": h.SourceTitle, "score": h.Score, "flagged": flagged})
	}
	return shape[ExtSearchQuotes200JSONResponse](map[string]any{"ready": true, "indexing": pending > 0, "hits": hits}), nil
}
