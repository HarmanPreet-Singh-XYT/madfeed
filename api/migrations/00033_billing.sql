-- +goose Up
-- Billing. One row per workspace says which plan it is on and what its subscription (kept in Stripe) is
-- doing. What a workspace may use is worked out from this row, so a payment provider's notification only
-- has to update it.
CREATE TABLE billing_account (
  workspace_id           uuid PRIMARY KEY REFERENCES workspace (id) ON DELETE CASCADE,
  stripe_customer_id     text UNIQUE CHECK (stripe_customer_id IS NULL OR char_length(stripe_customer_id) <= 100),
  stripe_subscription_id text CHECK (stripe_subscription_id IS NULL OR char_length(stripe_subscription_id) <= 100),
  plan_id                text NOT NULL DEFAULT 'free' CHECK (char_length(plan_id) BETWEEN 1 AND 40),
  status                 text NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')),
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  current_period_end     timestamptz,
  past_due_since         timestamptz,
  last_event_at          timestamptz NOT NULL DEFAULT 'epoch',
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- What happened, in words an admin can read: shown on the billing page.
CREATE TABLE billing_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL CHECK (kind IN ('subscribed', 'changed', 'canceled', 'payment_failed', 'payment_recovered', 'refund', 'unknown_price')),
  summary      text NOT NULL CHECK (char_length(summary) <= 200)
);
CREATE INDEX billing_event_ws_idx ON billing_event (workspace_id, at DESC);

ALTER TABLE billing_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_account FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_account USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON billing_event USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON billing_account, billing_event FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_account, billing_event TO app_backend;

-- The payment provider sends each notification possibly more than once. This table remembers the ids
-- already handled; it holds no tenant data and nothing but the function below may touch it.
CREATE TABLE stripe_event (
  id          text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stripe_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_event FORCE ROW LEVEL SECURITY;
REVOKE ALL ON stripe_event FROM PUBLIC;

-- True the first time an id is seen, false after. Runs in the caller's transaction, so recording the id
-- and acting on the notification commit together or not at all.
-- +goose StatementBegin
CREATE FUNCTION stripe_event_first(p_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  IF random() < 0.02 THEN
    DELETE FROM stripe_event WHERE received_at < now() - interval '45 days';
  END IF;
  INSERT INTO stripe_event (id) VALUES (p_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION stripe_event_first(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stripe_event_first(text) TO app_backend;

-- A notification names a customer, not a workspace.
-- +goose StatementBegin
CREATE FUNCTION billing_workspace_for_customer(p_customer text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace_id FROM billing_account WHERE stripe_customer_id = p_customer
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION billing_workspace_for_customer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_workspace_for_customer(text) TO app_backend;

-- The reconciliation job asks Stripe about subscriptions that have not been confirmed lately, to catch a
-- notification that never arrived.
-- +goose StatementBegin
CREATE FUNCTION billing_accounts_to_reconcile() RETURNS TABLE (workspace_id uuid, subscription_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace_id, stripe_subscription_id FROM billing_account
  WHERE stripe_subscription_id IS NOT NULL AND status <> 'canceled' AND updated_at < now() - interval '10 minutes'
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION billing_accounts_to_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_accounts_to_reconcile() TO app_backend;

-- +goose Down
DROP FUNCTION billing_accounts_to_reconcile();
DROP FUNCTION billing_workspace_for_customer(text);
DROP FUNCTION stripe_event_first(text);
DROP TABLE stripe_event;
DROP TABLE billing_event;
DROP TABLE billing_account;
