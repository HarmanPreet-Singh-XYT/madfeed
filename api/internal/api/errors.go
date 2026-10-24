package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"

	"product/api/internal/ai"
	"product/api/internal/apikey"
	"product/api/internal/audience"
	"product/api/internal/audit"
	"product/api/internal/billing"
	"product/api/internal/digest"
	"product/api/internal/directory"
	"product/api/internal/findings"
	"product/api/internal/httpx"
	"product/api/internal/inbox"
	"product/api/internal/insights"
	"product/api/internal/intake"
	"product/api/internal/integrations"
	"product/api/internal/media"
	"product/api/internal/oauth"
	"product/api/internal/outreach"
	"product/api/internal/publicsite"
	"product/api/internal/release"
	"product/api/internal/research"
	"product/api/internal/review"
	"product/api/internal/store"
	"product/api/internal/survey"
	"product/api/internal/views"
	"product/api/internal/workflow"
	"product/api/internal/workspaces"
)

// APIError is an error with a status and a message that is safe to show.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

var (
	errUnauthorized  = &APIError{http.StatusUnauthorized, "unauthorized", "Please sign in again."}
	errForbidden     = &APIError{http.StatusForbidden, "forbidden", "Your role in this workspace does not allow that."}
	errNotFound      = &APIError{http.StatusNotFound, "not_found", "That could not be found."}
	errConflict      = &APIError{http.StatusConflict, "conflict", "That suggestion has already been handled."}
	errLinked        = &APIError{http.StatusConflict, "already_linked", "That quote is already evidence on this request."}
	errNotConfigured = &APIError{http.StatusServiceUnavailable, "not_configured", "This service is not fully configured yet."}
	errInternal      = &APIError{http.StatusInternalServerError, "internal", "Something went wrong on our side. Please try again."}
)

func badRequest(msg string) *APIError {
	return &APIError{http.StatusBadRequest, "invalid_request", msg}
}

// toAPIError maps domain errors to responses. Unknown errors become a generic
// 500; their detail goes to the log with the request id, never to the client.
func toAPIError(err error) *APIError {
	var (
		api  *APIError
		inI  intake.ErrInvalid
		inR  review.ErrInvalid
		inW  workspaces.ErrInvalid
		inD  directory.ErrInvalid
		cfD  directory.ErrConflict
		oIn  outreach.ErrInvalid
		wIn  workflow.ErrInvalid
		wCf  workflow.ErrConflict
		rIn  release.ErrInvalid
		rCf  release.ErrConflict
		quot intake.ErrQuota
		rsIn research.ErrInvalid
		rsCf research.ErrConflict
		rsQt research.ErrQuota
		mdIn media.ErrInvalid
		mdCf media.ErrConflict
		mdQt media.ErrQuota
		vwIn views.ErrInvalid
		auIn audit.ErrInvalid
		auCf audit.ErrConflict
		vwCf views.ErrConflict
		psIn publicsite.ErrInvalid
		psQt publicsite.ErrQuota
		psVl publicsite.ErrVoteLimit
		dgIn digest.ErrInvalid
		akIn apikey.ErrInvalid
		itIn integrations.ErrInvalid
		blIn billing.ErrInvalid
		blEn billing.ErrNotEntitled
		oaIn oauth.ErrInvalid
		svIn survey.ErrInvalid
		svLm survey.ErrLimited
		auRl audience.ErrInvalid
		fdIn findings.ErrInvalid
		isIn insights.ErrInvalid
		ibIn inbox.ErrInvalid
		ibLm inbox.ErrLimited
	)
	switch {
	case errors.As(err, &api):
		return api
	case errors.Is(err, store.ErrForbidden):
		return errForbidden
	case errors.Is(err, outreach.ErrBadToken):
		return errNotFound
	case errors.Is(err, outreach.ErrStillDrafting):
		return &APIError{http.StatusConflict, "still_drafting", "Some messages are still being written. Try again in a moment."}
	case errors.Is(err, outreach.ErrNothingToSend):
		return &APIError{http.StatusConflict, "nothing_to_send", "There are no messages ready to send."}
	case errors.Is(err, outreach.ErrConflict):
		return &APIError{http.StatusConflict, "conflict", "That can't be done to this message or batch in its current state."}
	case errors.Is(err, store.ErrNotMember), errors.Is(err, review.ErrNotFound), errors.Is(err, directory.ErrNotFound), errors.Is(err, outreach.ErrNotFound), errors.Is(err, workflow.ErrNotFound), errors.Is(err, release.ErrNotFound), errors.Is(err, research.ErrNotFound), errors.Is(err, media.ErrNotFound), errors.Is(err, views.ErrNotFound), errors.Is(err, audit.ErrNotFound), errors.Is(err, pgx.ErrNoRows):
		return errNotFound
	case errors.Is(err, review.ErrConflict):
		return errConflict
	case errors.Is(err, review.ErrAlreadyLinked):
		return errLinked
	case errors.Is(err, research.ErrAIOff):
		return &APIError{http.StatusServiceUnavailable, "ai_off", "Questions are not switched on yet: no AI provider is set up."}
	case errors.Is(err, ai.ErrInvalidOutput):
		return &APIError{http.StatusBadGateway, "answer_rejected", "We could not produce a trustworthy answer to that. Try rephrasing the question."}
	case errors.Is(err, ai.ErrUnavailable), errors.Is(err, ai.ErrNoRoute), errors.Is(err, ai.ErrRefused):
		return &APIError{http.StatusServiceUnavailable, "ai_unavailable", "The assistant is not available right now. Please try again in a moment."}
	case errors.Is(err, publicsite.ErrOrigin):
		return errOrigin
	case errors.Is(err, publicsite.ErrNotFound):
		return errNotFound
	case errors.As(err, &psIn):
		return badRequest(psIn.Error())
	case errors.As(err, &blEn):
		return &APIError{http.StatusPaymentRequired, "plan_limit", "Your " + blEn.Plan + " plan does not include " + blEn.Feature + ". An admin can upgrade under Settings, Billing."}
	case errors.As(err, &blIn):
		return badRequest(blIn.Error())
	case errors.Is(err, integrations.ErrNotFound), errors.Is(err, integrations.ErrNotConnected):
		return errNotFound
	case errors.Is(err, integrations.ErrNeedsReconnect):
		return &APIError{http.StatusConflict, "needs_reconnect", "The connection no longer works. Connect it again; nothing collected so far is lost."}
	case errors.As(err, &itIn):
		return badRequest(itIn.Error())
	case errors.Is(err, inbox.ErrNotFound):
		return errNotFound
	case errors.Is(err, inbox.ErrStale):
		return &APIError{http.StatusConflict, "conversation_changed", "This conversation changed while you were looking at it. Read the new messages, then send again."}
	case errors.Is(err, inbox.ErrOrigin):
		return errOrigin
	case errors.Is(err, inbox.ErrBadSign):
		return errUnauthorized
	case errors.As(err, &ibLm):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", ibLm.Error()}
	case errors.As(err, &ibIn):
		return badRequest(ibIn.Error())
	case errors.Is(err, findings.ErrNotFound), errors.Is(err, findings.ErrBadLink), errors.Is(err, insights.ErrNotFound):
		return errNotFound
	case errors.Is(err, findings.ErrConflict):
		return &APIError{http.StatusConflict, "conflict", "A published document can't be edited. Take it down first, edit it, then publish it again."}
	case errors.Is(err, findings.ErrNotSure):
		return badRequest("Confirm that you have read the quotes and they are fine to share.")
	case errors.As(err, &fdIn):
		return badRequest(fdIn.Error())
	case errors.As(err, &isIn):
		return badRequest(isIn.Error())
	case errors.Is(err, survey.ErrNotFound), errors.Is(err, survey.ErrBadToken):
		return errNotFound
	case errors.Is(err, survey.ErrNotOpen):
		return &APIError{http.StatusConflict, "survey_closed", "This survey is closed and is not taking answers."}
	case errors.Is(err, survey.ErrNothingToSend):
		return &APIError{http.StatusConflict, "nothing_to_send", "There are no invitations waiting to be sent."}
	case errors.Is(err, survey.ErrConflict):
		return &APIError{http.StatusConflict, "conflict", "That can't be done to this survey in its current state."}
	case errors.As(err, &svLm):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", svLm.Error()}
	case errors.As(err, &svIn):
		return badRequest(svIn.Error())
	case errors.As(err, &auRl):
		return badRequest(auRl.Error())
	case errors.Is(err, oauth.ErrNotFound):
		return errNotFound
	case errors.As(err, &oaIn):
		return badRequest(oaIn.Error())
	case errors.Is(err, apikey.ErrNotFound):
		return errNotFound
	case errors.As(err, &akIn):
		return badRequest(akIn.Error())
	case errors.Is(err, digest.ErrBadToken):
		return errNotFound
	case errors.As(err, &dgIn):
		return badRequest(dgIn.Error())
	case errors.As(err, &psVl):
		return &APIError{http.StatusTooManyRequests, "vote_limit", psVl.Error()}
	case errors.As(err, &psQt):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", psQt.Error()}
	case errors.As(err, &auIn):
		return badRequest(auIn.Error())
	case errors.As(err, &auCf):
		return &APIError{http.StatusConflict, "conflict", auCf.Error()}
	case errors.As(err, &vwIn):
		return badRequest(vwIn.Error())
	case errors.As(err, &vwCf):
		return &APIError{http.StatusConflict, "already_exists", vwCf.Error()}
	case errors.As(err, &mdQt):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", mdQt.Error()}
	case errors.As(err, &mdIn):
		return badRequest(mdIn.Error())
	case errors.As(err, &mdCf):
		return &APIError{http.StatusConflict, "conflict", mdCf.Error()}
	case errors.As(err, &rsQt):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", rsQt.Error()}
	case errors.As(err, &rsIn):
		return badRequest(rsIn.Error())
	case errors.As(err, &rsCf):
		return &APIError{http.StatusConflict, "conflict", rsCf.Error()}
	case errors.As(err, &quot):
		return &APIError{http.StatusTooManyRequests, "quota_exceeded", quot.Error()}
	case errors.As(err, &inI):
		return badRequest(inI.Error())
	case errors.As(err, &inR):
		return badRequest(inR.Error())
	case errors.As(err, &inW):
		return badRequest(inW.Error())
	case errors.As(err, &inD):
		return badRequest(inD.Error())
	case errors.As(err, &cfD):
		return &APIError{http.StatusConflict, "already_exists", cfD.Error()}
	case errors.As(err, &oIn):
		return badRequest(oIn.Error())
	case errors.As(err, &wIn):
		return badRequest(wIn.Error())
	case errors.As(err, &rIn):
		return badRequest(rIn.Error())
	case errors.As(err, &wCf):
		return &APIError{http.StatusConflict, "already_exists", wCf.Error()}
	case errors.As(err, &rCf):
		return &APIError{http.StatusConflict, "conflict", rCf.Error()}
	}
	return nil
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	ae := toAPIError(err)
	rid := middleware.GetReqID(r.Context())
	if ae == nil {
		slog.Error("unhandled error", "request_id", rid, "method", r.Method, "path", httpx.SafePath(r.URL.Path), "error", err)
		ae = errInternal
	}
	if ae.Status == http.StatusUnauthorized && w.Header().Get("WWW-Authenticate") == "" {
		w.Header().Set("WWW-Authenticate", `Bearer realm="api"`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(ae.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": ae.Code, "message": ae.Message, "requestId": rid}})
}
