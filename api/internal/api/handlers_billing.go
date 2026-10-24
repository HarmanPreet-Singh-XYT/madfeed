package api

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"product/api/internal/apikey"
	"product/api/internal/billing"
)

// entitled refuses something the workspace's plan does not include. With no payment provider set up
// (development, self-hosting) everything is included.
func (s *Server) entitled(ctx context.Context, ws uuid.UUID, f billing.Feature) error {
	if s.Billing == nil {
		return nil
	}
	return s.Billing.Check(ctx, ws, f)
}

// keyAllowance refuses a new API key beyond what the plan includes.
func (s *Server) keyAllowance(ctx context.Context, ws uuid.UUID, active int) error {
	if s.Billing == nil || !s.Billing.Enabled() {
		return nil
	}
	limit, plan, err := s.Billing.APIKeyLimit(ctx, ws)
	if err != nil {
		return err
	}
	if limit == 0 {
		return billing.ErrNotEntitled{Feature: string(billing.FeatureAPIKeys), Plan: plan}
	}
	if active >= limit {
		return billing.ErrNotEntitled{Feature: "more API keys than " + itoa(limit), Plan: plan}
	}
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

var _ = apikey.MaxActive

func (s *Server) billingReady() error {
	if s.Billing == nil {
		return errNotConfigured
	}
	return nil
}

func planViewOut(v billing.PlanView) PlanView {
	return PlanView{Id: v.ID, Name: v.Name, PriceText: v.PriceText, ForSale: v.ForSale, Entitlements: PlanEntitlements{
		AiBudgetUsd: float32(v.Entitlements.AIBudgetUSD), Recordings: v.Entitlements.Recordings, ApiKeys: v.Entitlements.APIKeys,
		PublicPages: v.Entitlements.PublicPages, Digest: v.Entitlements.Digest, Integrations: v.Entitlements.Integrations,
	}}
}

func (s *Server) GetBilling(ctx context.Context, req GetBillingRequestObject) (GetBillingResponseObject, error) {
	if err := s.billingReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	in, err := s.Billing.Info(ctx, t)
	if err != nil {
		return nil, err
	}
	out := GetBilling200JSONResponse{
		Enabled: in.Enabled, Plan: planViewOut(in.Plan), Status: BillingInfoStatus(in.Status), CancelAtPeriodEnd: in.CancelAtEnd,
		PeriodEnd: in.PeriodEnd, PastDueSince: in.PastDueSince, GraceEndsAt: in.GraceEndsAt, CanManage: in.CanManage, ActiveApiKeys: in.ActiveAPIKeys,
		Plans: make([]PlanView, 0, len(in.Plans)),
	}
	type ev = struct {
		At      time.Time             `json:"at"`
		Kind    BillingInfoEventsKind `json:"kind"`
		Summary string                `json:"summary"`
	}
	out.Events = make([]ev, 0, len(in.Events))
	for _, p := range in.Plans {
		out.Plans = append(out.Plans, planViewOut(p))
	}
	for _, e := range in.Events {
		out.Events = append(out.Events, ev{At: e.At, Kind: BillingInfoEventsKind(e.Kind), Summary: e.Summary})
	}
	return out, nil
}

func (s *Server) StartCheckout(ctx context.Context, req StartCheckoutRequestObject) (StartCheckoutResponseObject, error) {
	if err := s.billingReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	u, err := s.Billing.Checkout(ctx, t, req.Body.PlanId)
	if err != nil {
		return nil, err
	}
	return StartCheckout200JSONResponse{Url: u}, nil
}

func (s *Server) OpenBillingPortal(ctx context.Context, req OpenBillingPortalRequestObject) (OpenBillingPortalResponseObject, error) {
	if err := s.billingReady(); err != nil {
		return nil, err
	}
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	u, err := s.Billing.Portal(ctx, t)
	if err != nil {
		return nil, err
	}
	return OpenBillingPortal200JSONResponse{Url: u}, nil
}

// stripeWebhook receives Stripe's notifications, outside the sign-in layer (Stripe has no account here). The
// signature is checked on the exact bytes received.
func (s *Server) stripeWebhook() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.Billing == nil || !s.Billing.Enabled() {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, billing.MaxWebhookBody+1))
		if err != nil {
			writeError(w, r, &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: "That is larger than allowed."})
			return
		}
		err = s.Billing.Webhook(r.Context(), body, r.Header.Get("Stripe-Signature"))
		switch {
		case err == nil:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"received":true}`))
		case isErr(err, billing.ErrBadSignature):
			writeError(w, r, errUnauthorized)
		default:
			if _, ok := err.(billing.ErrInvalid); ok {
				writeError(w, r, badRequest("Not a valid event."))
				return
			}
			writeError(w, r, err) // a real failure: a 500 makes Stripe send it again
		}
	})
}
