package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/client"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrBadSignature = errors.New("billing: signature does not verify")
	ErrNotFound     = errors.New("billing: not found")
)

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ErrNotEntitled says the workspace's plan does not include something. It is shown to people as a plain
// "your plan does not include X" with a way to upgrade.
type ErrNotEntitled struct {
	Feature string
	Plan    string
}

func (e ErrNotEntitled) Error() string {
	return fmt.Sprintf("your %s plan does not include %s", e.Plan, e.Feature)
}

type Feature string

const (
	FeatureRecordings   Feature = "recordings"
	FeaturePublicPages  Feature = "the public website form, roadmap and votes"
	FeatureDigest       Feature = "the weekly digest"
	FeatureIntegrations Feature = "connections to Slack and your issue tracker"
	FeatureAPIKeys      Feature = "API keys"
	FeatureSurveys      Feature = "surveys"
)

// Service works out entitlements and handles payments. With no Stripe client billing is off, and every
// workspace may use everything (this is how development and self-hosting run).
type Service struct {
	Pool          *pgxpool.Pool
	Stripe        *client.API
	Plans         PlanSet
	WebURL        string // the web app's public address, for returning from checkout
	WebhookSecret string
	GraceDays     int // days a failed payment keeps the plan; 0 means 7
	Now           func() time.Time
}

func (s *Service) Enabled() bool { return s != nil && s.Stripe != nil }

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) grace() time.Duration {
	d := s.GraceDays
	if d <= 0 {
		d = 7
	}
	return time.Duration(d) * 24 * time.Hour
}

func system(ws uuid.UUID) store.Tenant {
	return store.Tenant{WorkspaceID: ws, UserID: uuid.Nil, Role: store.RoleMember}
}

// Account is a workspace's billing state, as stored.
type Account struct {
	PlanID          string
	Status          string
	CancelAtEnd     bool
	PeriodEnd       *time.Time
	PastDueSince    *time.Time
	HasCustomer     bool
	HasSubscription bool
}

func toAccount(r dbgen.BillingAccount) Account {
	a := Account{PlanID: r.PlanID, Status: r.Status, CancelAtEnd: r.CancelAtPeriodEnd, HasCustomer: r.StripeCustomerID.Valid, HasSubscription: r.StripeSubscriptionID.Valid}
	if r.CurrentPeriodEnd.Valid {
		t := r.CurrentPeriodEnd.Time
		a.PeriodEnd = &t
	}
	if r.PastDueSince.Valid {
		t := r.PastDueSince.Time
		a.PastDueSince = &t
	}
	return a
}

func (s *Service) account(ctx context.Context, ws uuid.UUID) (Account, error) {
	a := Account{PlanID: "free", Status: "none"}
	err := store.WithTenant(ctx, s.Pool, system(ws), func(q *dbgen.Queries) error {
		r, err := q.GetBillingAccount(ctx, ws)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		a = toAccount(r)
		return err
	})
	return a, err
}

// effective is the plan a workspace actually gets right now. A subscription that is active or trialing gets
// its plan; one whose payment failed keeps it for the grace period and then falls back to free; anything
// else (cancelled, unpaid, never started) is free.
func (s *Service) effective(a Account) Plan {
	free := s.Plans.Free()
	pl, ok := s.Plans.Get(a.PlanID)
	if !ok {
		return free
	}
	switch a.Status {
	case "active", "trialing":
		return pl
	case "past_due":
		if a.PastDueSince == nil || s.now().Before(a.PastDueSince.Add(s.grace())) {
			return pl
		}
	}
	return free
}

// Plan is the plan a workspace has right now, and its state.
func (s *Service) Plan(ctx context.Context, ws uuid.UUID) (Plan, Account, error) {
	if !s.Enabled() {
		return Plan{ID: "unlimited", Name: "Unlimited", Entitlements: Entitlements{AIBudgetUSD: 1000, Recordings: true, APIKeys: 10, PublicPages: true, Digest: true, Integrations: true}}, Account{PlanID: "unlimited", Status: "none"}, nil
	}
	a, err := s.account(ctx, ws)
	if err != nil {
		return Plan{}, a, err
	}
	return s.effective(a), a, nil
}

// Check refuses a feature the plan does not include.
func (s *Service) Check(ctx context.Context, ws uuid.UUID, f Feature) error {
	if !s.Enabled() {
		return nil
	}
	pl, _, err := s.Plan(ctx, ws)
	if err != nil {
		return err
	}
	e := pl.Entitlements
	ok := true
	switch f {
	case FeatureRecordings:
		ok = e.Recordings
	case FeaturePublicPages:
		ok = e.PublicPages
	case FeatureDigest:
		ok = e.Digest
	case FeatureIntegrations:
		ok = e.Integrations
	case FeatureAPIKeys:
		ok = e.APIKeys > 0
	case FeatureSurveys:
		ok = e.Surveys
	}
	if !ok {
		return ErrNotEntitled{Feature: string(f), Plan: pl.Name}
	}
	return nil
}

// APIKeyLimit is how many active API keys the plan allows.
func (s *Service) APIKeyLimit(ctx context.Context, ws uuid.UUID) (int, string, error) {
	pl, _, err := s.Plan(ctx, ws)
	return pl.Entitlements.APIKeys, pl.Name, err
}

// ---- what the billing page shows ----

type PlanView struct {
	ID, Name, PriceText string
	ForSale             bool
	Entitlements        Entitlements
}

type EventView struct {
	At      time.Time
	Kind    string
	Summary string
}

type Info struct {
	Enabled       bool
	Plan          PlanView
	Status        string
	CancelAtEnd   bool
	PeriodEnd     *time.Time
	PastDueSince  *time.Time
	GraceEndsAt   *time.Time
	CanManage     bool // a payment account exists, so the billing portal can be opened
	Plans         []PlanView
	Events        []EventView
	ActiveAPIKeys int
}

func view(p Plan) PlanView {
	return PlanView{ID: p.ID, Name: p.Name, PriceText: p.PriceText, ForSale: p.StripePriceID != "", Entitlements: p.Entitlements}
}

// Info (admins only) is the billing page.
func (s *Service) Info(ctx context.Context, t store.Tenant) (Info, error) {
	if t.Role != store.RoleAdmin {
		return Info{}, store.ErrForbidden
	}
	pl, a, err := s.Plan(ctx, t.WorkspaceID)
	if err != nil {
		return Info{}, err
	}
	out := Info{Enabled: s.Enabled(), Plan: view(pl), Status: a.Status, CancelAtEnd: a.CancelAtEnd, PeriodEnd: a.PeriodEnd, PastDueSince: a.PastDueSince, CanManage: a.HasCustomer}
	if a.PastDueSince != nil && a.Status == "past_due" {
		g := a.PastDueSince.Add(s.grace())
		out.GraceEndsAt = &g
	}
	for _, p := range s.Plans.Plans {
		out.Plans = append(out.Plans, view(p))
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		evs, err := q.ListBillingEvents(ctx, t.WorkspaceID)
		for _, e := range evs {
			out.Events = append(out.Events, EventView{At: e.At, Kind: e.Kind, Summary: e.Summary})
		}
		if err != nil {
			return err
		}
		n, err := q.CountActiveAPIKeys(ctx, t.WorkspaceID)
		out.ActiveAPIKeys = int(n)
		return err
	})
	return out, err
}

// ---- starting and managing a subscription ----

func (s *Service) customerFor(ctx context.Context, t store.Tenant) (string, error) {
	var id string
	err := store.WithTenantTx(ctx, s.Pool, t, func(_ pgx.Tx, q *dbgen.Queries) error {
		if err := q.EnsureBillingAccount(ctx, t.WorkspaceID); err != nil {
			return err
		}
		acc, err := q.GetBillingAccountForUpdate(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		if acc.StripeCustomerID.Valid {
			id = acc.StripeCustomerID.String
			return nil
		}
		name, err := q.GetWorkspaceName(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		p := &stripe.CustomerParams{Name: stripe.String(clip(name, 200)), Metadata: map[string]string{"workspace_id": t.WorkspaceID.String()}}
		p.SetIdempotencyKey("customer-" + t.WorkspaceID.String())
		p.Context = ctx
		c, err := s.Stripe.Customers.New(p)
		if err != nil {
			slog.Warn("billing: could not create a customer", "workspace_id", t.WorkspaceID, "error", stripeErr(err))
			return fmt.Errorf("could not reach the payment service")
		}
		id = c.ID
		return q.SetBillingCustomer(ctx, dbgen.SetBillingCustomerParams{WorkspaceID: t.WorkspaceID, StripeCustomerID: pgtype.Text{String: c.ID, Valid: true}})
	})
	return id, err
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Checkout (admins only) returns the page where the person pays for a plan. A workspace that already has a
// subscription changes plan in the billing portal instead, so it can never pay twice.
func (s *Service) Checkout(ctx context.Context, t store.Tenant, planID string) (string, error) {
	if t.Role != store.RoleAdmin {
		return "", store.ErrForbidden
	}
	if !s.Enabled() {
		return "", ErrInvalid("billing is not set up on this server")
	}
	pl, ok := s.Plans.Get(planID)
	if !ok || pl.StripePriceID == "" {
		return "", ErrInvalid("that plan is not for sale")
	}
	a, err := s.account(ctx, t.WorkspaceID)
	if err != nil {
		return "", err
	}
	if a.Status == "active" || a.Status == "trialing" || a.Status == "past_due" {
		return "", ErrInvalid("this workspace already has a subscription; use Manage billing to change or cancel it")
	}
	cust, err := s.customerFor(ctx, t)
	if err != nil {
		return "", err
	}
	web := strings.TrimRight(s.WebURL, "/") + "/w/" + t.WorkspaceID.String() + "/settings"
	p := &stripe.CheckoutSessionParams{
		Mode:              stripe.String("subscription"),
		Customer:          stripe.String(cust),
		ClientReferenceID: stripe.String(t.WorkspaceID.String()),
		LineItems:         []*stripe.CheckoutSessionLineItemParams{{Price: stripe.String(pl.StripePriceID), Quantity: stripe.Int64(1)}},
		SuccessURL:        stripe.String(web + "?billing=success"),
		CancelURL:         stripe.String(web + "?billing=cancelled"),
		SubscriptionData:  &stripe.CheckoutSessionSubscriptionDataParams{Metadata: map[string]string{"workspace_id": t.WorkspaceID.String()}},
	}
	p.SetIdempotencyKey(fmt.Sprintf("checkout-%s-%s-%d", t.WorkspaceID, pl.ID, s.now().Unix()/600))
	p.Context = ctx
	sess, err := s.Stripe.CheckoutSessions.New(p)
	if err != nil || sess.URL == "" {
		slog.Warn("billing: could not start a checkout", "workspace_id", t.WorkspaceID, "error", stripeErr(err))
		return "", fmt.Errorf("could not reach the payment service")
	}
	return sess.URL, nil
}

// Portal (admins only) returns the page where the person changes plan, updates the card, reads invoices or cancels.
func (s *Service) Portal(ctx context.Context, t store.Tenant) (string, error) {
	if t.Role != store.RoleAdmin {
		return "", store.ErrForbidden
	}
	if !s.Enabled() {
		return "", ErrInvalid("billing is not set up on this server")
	}
	a, err := s.account(ctx, t.WorkspaceID)
	if err != nil {
		return "", err
	}
	if !a.HasCustomer {
		return "", ErrInvalid("there is no billing account yet; choose a plan first")
	}
	var cust string
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetBillingAccount(ctx, t.WorkspaceID)
		cust = r.StripeCustomerID.String
		return err
	}); err != nil {
		return "", err
	}
	p := &stripe.BillingPortalSessionParams{Customer: stripe.String(cust), ReturnURL: stripe.String(strings.TrimRight(s.WebURL, "/") + "/w/" + t.WorkspaceID.String() + "/settings")}
	p.Context = ctx
	sess, err := s.Stripe.BillingPortalSessions.New(p)
	if err != nil || sess.URL == "" {
		slog.Warn("billing: could not open the portal", "workspace_id", t.WorkspaceID, "error", stripeErr(err))
		return "", fmt.Errorf("could not reach the payment service")
	}
	return sess.URL, nil
}

// stripeErr is what to log about a failed call: the kind and code Stripe gave, never the request.
func stripeErr(err error) string {
	var se *stripe.Error
	if errors.As(err, &se) {
		return fmt.Sprintf("%s %s (http %d)", se.Type, se.Code, se.HTTPStatusCode)
	}
	if err == nil {
		return "empty answer"
	}
	return "network or protocol error"
}
