package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// MaxWebhookBody is the largest notification accepted.
const MaxWebhookBody = 512 << 10

// subState is what we keep of a subscription, whether it came from a notification or from asking Stripe.
type subState struct {
	ID          string
	Customer    string
	Status      string // our statuses
	PriceID     string
	CancelAtEnd bool
	PeriodEnd   int64
	Deleted     bool
}

func ourStatus(stripeStatus string) string {
	switch stripeStatus {
	case "trialing", "active", "past_due", "unpaid", "incomplete", "canceled":
		return stripeStatus
	case "incomplete_expired", "paused":
		return "canceled"
	}
	return "canceled"
}

type rawSub struct {
	ID                string `json:"id"`
	Customer          string `json:"customer"`
	Status            string `json:"status"`
	CancelAtPeriodEnd bool   `json:"cancel_at_period_end"`
	CurrentPeriodEnd  int64  `json:"current_period_end"`
	Items             struct {
		Data []struct {
			Price struct {
				ID string `json:"id"`
			} `json:"price"`
			CurrentPeriodEnd int64 `json:"current_period_end"`
		} `json:"data"`
	} `json:"items"`
}

func (r rawSub) state(deleted bool) subState {
	st := subState{ID: r.ID, Customer: r.Customer, Status: ourStatus(r.Status), CancelAtEnd: r.CancelAtPeriodEnd, PeriodEnd: r.CurrentPeriodEnd, Deleted: deleted}
	if deleted {
		st.Status = "canceled"
	}
	if len(r.Items.Data) > 0 {
		st.PriceID = r.Items.Data[0].Price.ID
		if st.PeriodEnd == 0 { // newer API versions keep the period on the item
			st.PeriodEnd = r.Items.Data[0].CurrentPeriodEnd
		}
	}
	return st
}

// Webhook handles one notification from Stripe. The signature is checked on the exact bytes received, a
// notification more than five minutes old is refused, and each notification is acted on once. Out-of-order
// delivery is handled: one older than what is already recorded is ignored. A notification for a customer
// we do not know is acknowledged and dropped.
func (s *Service) Webhook(ctx context.Context, payload []byte, signature string) error {
	if !s.Enabled() || s.WebhookSecret == "" || len(payload) > MaxWebhookBody {
		return ErrBadSignature
	}
	if !timestampNotAhead(signature, s.now()) {
		return ErrBadSignature // the SDK refuses old notifications; one dated well ahead is as wrong
	}
	ev, err := webhook.ConstructEventWithOptions(payload, signature, s.WebhookSecret, webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		return ErrBadSignature
	}
	raw := ev.Data.Raw
	created := time.Unix(ev.Created, 0)
	switch ev.Type {
	case "checkout.session.completed":
		var cs struct {
			Customer          string `json:"customer"`
			Subscription      string `json:"subscription"`
			ClientReferenceID string `json:"client_reference_id"`
		}
		if json.Unmarshal(raw, &cs) != nil {
			return ErrInvalid("not an event")
		}
		ws, err := uuid.Parse(cs.ClientReferenceID)
		if err != nil || cs.Customer == "" {
			return nil
		}
		return s.in(ctx, ws, ev.ID, func(q *dbgen.Queries) error {
			acc, err := q.GetBillingAccountForUpdate(ctx, ws)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil // we never made a billing account for this workspace
			}
			if err != nil {
				return err
			}
			if acc.StripeCustomerID.Valid && acc.StripeCustomerID.String != cs.Customer {
				return nil // a payment for someone else's customer: not ours to attach
			}
			if cs.Subscription != "" && !acc.StripeSubscriptionID.Valid {
				return q.SetBillingSubscription(ctx, dbgen.SetBillingSubscriptionParams{
					WorkspaceID: ws, StripeSubscriptionID: pgtype.Text{String: cs.Subscription, Valid: true}, PlanID: acc.PlanID, Status: acc.Status,
					CancelAtPeriodEnd: acc.CancelAtPeriodEnd, CurrentPeriodEnd: acc.CurrentPeriodEnd, PastDueSince: acc.PastDueSince, LastEventAt: acc.LastEventAt,
				})
			}
			return nil
		})
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		var rs rawSub
		if json.Unmarshal(raw, &rs) != nil || rs.Customer == "" {
			return ErrInvalid("not an event")
		}
		return s.forCustomer(ctx, rs.Customer, ev.ID, func(ws uuid.UUID, q *dbgen.Queries) error {
			return s.applySub(ctx, q, ws, rs.state(ev.Type == "customer.subscription.deleted"), created, false)
		})
	case "invoice.payment_failed", "invoice.paid", "invoice.payment_succeeded":
		var inv struct {
			Customer string `json:"customer"`
		}
		if json.Unmarshal(raw, &inv) != nil || inv.Customer == "" {
			return ErrInvalid("not an event")
		}
		failed := ev.Type == "invoice.payment_failed"
		return s.forCustomer(ctx, inv.Customer, ev.ID, func(ws uuid.UUID, q *dbgen.Queries) error {
			acc, err := q.GetBillingAccountForUpdate(ctx, ws)
			if err != nil {
				return err
			}
			if created.Before(acc.LastEventAt) {
				return nil
			}
			switch {
			case failed && (acc.Status == "active" || acc.Status == "trialing" || acc.Status == "past_due"):
				since := acc.PastDueSince
				if !since.Valid {
					since = pgtype.Timestamptz{Time: created, Valid: true}
				}
				if acc.Status != "past_due" {
					_ = q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "payment_failed", Summary: fmt.Sprintf("A payment failed. Update your card to keep the %s plan: it stays on for %d days.", s.planName(acc.PlanID), int(s.grace().Hours()/24))})
				}
				return s.write(ctx, q, ws, acc, acc.PlanID, "past_due", acc.CancelAtPeriodEnd, acc.CurrentPeriodEnd, since, created)
			case !failed && acc.Status == "past_due":
				_ = q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "payment_recovered", Summary: "The payment went through. Your plan is back to normal."})
				return s.write(ctx, q, ws, acc, acc.PlanID, "active", acc.CancelAtPeriodEnd, acc.CurrentPeriodEnd, pgtype.Timestamptz{}, created)
			}
			return nil
		})
	case "charge.refunded":
		var ch struct {
			Customer       string `json:"customer"`
			AmountRefunded int64  `json:"amount_refunded"`
			Currency       string `json:"currency"`
		}
		if json.Unmarshal(raw, &ch) != nil || ch.Customer == "" {
			return ErrInvalid("not an event")
		}
		return s.forCustomer(ctx, ch.Customer, ev.ID, func(ws uuid.UUID, q *dbgen.Queries) error {
			// A refund records what happened; whether the plan ends is the subscription's business.
			return q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "refund", Summary: fmt.Sprintf("A refund of %s was issued.", money(ch.AmountRefunded, ch.Currency))})
		})
	}
	return nil
}

func money(minor int64, currency string) string {
	return fmt.Sprintf("%d.%02d %s", minor/100, minor%100, upper(currency))
}

func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}

func (s *Service) planName(id string) string {
	if p, ok := s.Plans.Get(id); ok {
		return p.Name
	}
	return "paid"
}

// in runs fn in the workspace's transaction after recording the notification id; a notification already
// handled does nothing.
func (s *Service) in(ctx context.Context, ws uuid.UUID, eventID string, fn func(q *dbgen.Queries) error) error {
	return store.WithTenantTx(ctx, s.Pool, system(ws), func(tx pgx.Tx, q *dbgen.Queries) error {
		var first bool
		if err := tx.QueryRow(ctx, `SELECT stripe_event_first($1)`, eventID).Scan(&first); err != nil {
			return err
		}
		if !first {
			return nil
		}
		return fn(q)
	})
}

func (s *Service) forCustomer(ctx context.Context, customer, eventID string, fn func(ws uuid.UUID, q *dbgen.Queries) error) error {
	var ws uuid.NullUUID
	if err := s.Pool.QueryRow(ctx, `SELECT billing_workspace_for_customer($1)`, customer).Scan(&ws); err != nil {
		return err
	}
	if !ws.Valid {
		return nil // a customer we do not know
	}
	return s.in(ctx, ws.UUID, eventID, func(q *dbgen.Queries) error { return fn(ws.UUID, q) })
}

// write stores the account's state.
func (s *Service) write(ctx context.Context, q *dbgen.Queries, ws uuid.UUID, old dbgen.BillingAccount, planID, status string, cancelAtEnd bool, periodEnd, pastDue pgtype.Timestamptz, at time.Time) error {
	return q.SetBillingSubscription(ctx, dbgen.SetBillingSubscriptionParams{
		WorkspaceID: ws, StripeSubscriptionID: old.StripeSubscriptionID, PlanID: planID, Status: status, CancelAtPeriodEnd: cancelAtEnd,
		CurrentPeriodEnd: periodEnd, PastDueSince: pastDue, LastEventAt: at,
	})
}

// applySub brings the account in line with a subscription. force skips the "older than what we know" test
// (used when the state was just read from Stripe).
func (s *Service) applySub(ctx context.Context, q *dbgen.Queries, ws uuid.UUID, st subState, at time.Time, force bool) error {
	acc, err := q.GetBillingAccountForUpdate(ctx, ws)
	if err != nil {
		return err
	}
	if !force && at.Before(acc.LastEventAt) {
		return nil
	}
	plan, known := s.Plans.ByPrice(st.PriceID)
	planID := plan.ID
	if !known {
		planID = "free"
		if st.PriceID != "" && (st.Status == "active" || st.Status == "trialing") {
			_ = q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "unknown_price", Summary: "The subscription uses a price that is not one of the plans here, so the Free plan applies. Contact support."})
		}
	}
	paying := st.Status == "active" || st.Status == "trialing" || st.Status == "past_due"
	if !paying {
		planID = "free"
	}
	var periodEnd pgtype.Timestamptz
	if st.PeriodEnd > 0 {
		periodEnd = pgtype.Timestamptz{Time: time.Unix(st.PeriodEnd, 0), Valid: true}
	}
	pastDue := pgtype.Timestamptz{}
	if st.Status == "past_due" {
		pastDue = acc.PastDueSince
		if !pastDue.Valid {
			pastDue = pgtype.Timestamptz{Time: at, Valid: true}
		}
	}
	switch {
	case acc.PlanID == "free" && planID != "free":
		_ = q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "subscribed", Summary: "Subscribed to the " + s.planName(planID) + " plan."})
	case acc.PlanID != "free" && planID == "free":
		_ = q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "canceled", Summary: "The subscription ended. The Free plan applies; nothing was deleted."})
	case acc.PlanID != planID:
		_ = q.InsertBillingEvent(ctx, dbgen.InsertBillingEventParams{WorkspaceID: ws, Kind: "changed", Summary: "Changed from the " + s.planName(acc.PlanID) + " plan to the " + s.planName(planID) + " plan."})
	}
	sub := st.ID
	if sub == "" {
		sub = acc.StripeSubscriptionID.String
	}
	old := acc
	old.StripeSubscriptionID = pgtype.Text{String: sub, Valid: sub != ""}
	if st.Deleted || st.Status == "canceled" {
		old.StripeSubscriptionID = pgtype.Text{String: sub, Valid: sub != ""}
	}
	return s.write(ctx, q, ws, old, planID, st.Status, st.CancelAtEnd && paying, periodEnd, pastDue, at)
}

// ---- catching what the notifications missed ----

// Reconcile asks Stripe about subscriptions that have not been confirmed for a while and corrects any that
// drifted (a notification that never arrived). (The end of a failed payment's grace period needs no job: what a
// workspace may use is worked out from the stored state and the clock whenever it is asked.)
func (s *Service) Reconcile(ctx context.Context, log *slog.Logger) {
	if !s.Enabled() {
		return
	}
	rows, err := s.Pool.Query(ctx, `SELECT workspace_id, subscription_id FROM billing_accounts_to_reconcile()`)
	if err != nil {
		return
	}
	type item struct {
		ws  uuid.UUID
		sub string
	}
	var todo []item
	for rows.Next() {
		var it item
		if rows.Scan(&it.ws, &it.sub) == nil {
			todo = append(todo, it)
		}
	}
	rows.Close()
	for _, it := range todo {
		st, ok := s.fetchSub(ctx, it.sub)
		err := store.WithTenantTx(ctx, s.Pool, system(it.ws), func(_ pgx.Tx, q *dbgen.Queries) error {
			if !ok {
				return q.TouchBillingAccount(ctx, it.ws)
			}
			var cust string
			if r, e := q.GetBillingAccount(ctx, it.ws); e == nil {
				cust = r.StripeCustomerID.String
			}
			if st.Customer != "" && cust != "" && st.Customer != cust {
				return q.TouchBillingAccount(ctx, it.ws) // not this workspace's subscription: leave it alone
			}
			if e := s.applySub(ctx, q, it.ws, st, s.now(), true); e != nil {
				return e
			}
			return q.TouchBillingAccount(ctx, it.ws)
		})
		if err != nil && log != nil {
			log.Warn("billing reconcile failed", "workspace_id", it.ws)
		}
	}
}

func (s *Service) fetchSub(ctx context.Context, id string) (subState, bool) {
	p := &stripe.SubscriptionParams{}
	p.Context = ctx
	sub, err := s.Stripe.Subscriptions.Get(id, p)
	if err != nil {
		var se *stripe.Error
		if errors.As(err, &se) && se.HTTPStatusCode == 404 { // the subscription is gone
			return subState{ID: id, Status: "canceled", Deleted: true}, true
		}
		return subState{}, false
	}
	st := subState{ID: sub.ID, Status: ourStatus(string(sub.Status)), CancelAtEnd: sub.CancelAtPeriodEnd}
	if sub.Customer != nil {
		st.Customer = sub.Customer.ID
	}
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		if sub.Items.Data[0].Price != nil {
			st.PriceID = sub.Items.Data[0].Price.ID
		}
		st.PeriodEnd = sub.Items.Data[0].CurrentPeriodEnd
	}
	return st, true
}

// Loop runs the reconciliation now and then until ctx ends.
func (s *Service) Loop(ctx context.Context, every time.Duration, log *slog.Logger) {
	if every <= 0 {
		every = 5 * time.Minute
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		s.Reconcile(ctx, log)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// timestampNotAhead reads the t= part of Stripe's signature header and says whether it is no more than five
// minutes ahead of our clock.
func timestampNotAhead(header string, now time.Time) bool {
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || k != "t" {
			continue
		}
		n, err := strconv.ParseInt(v, 10, 64)
		return err == nil && time.Unix(n, 0).Before(now.Add(5*time.Minute))
	}
	return false
}
