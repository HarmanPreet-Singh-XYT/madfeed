-- name: GetBillingAccount :one
SELECT * FROM billing_account WHERE workspace_id = $1;

-- name: EnsureBillingAccount :exec
INSERT INTO billing_account (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING;

-- name: GetBillingAccountForUpdate :one
SELECT * FROM billing_account WHERE workspace_id = $1 FOR UPDATE;

-- name: SetBillingCustomer :exec
UPDATE billing_account SET stripe_customer_id = $2, updated_at = now() WHERE workspace_id = $1;

-- name: SetBillingSubscription :exec
UPDATE billing_account
SET stripe_subscription_id = $2, plan_id = $3, status = $4, cancel_at_period_end = $5, current_period_end = sqlc.narg(current_period_end),
    past_due_since = sqlc.narg(past_due_since), last_event_at = $6, updated_at = now()
WHERE workspace_id = $1;

-- name: TouchBillingAccount :exec
UPDATE billing_account SET updated_at = now() WHERE workspace_id = $1;

-- name: InsertBillingEvent :exec
INSERT INTO billing_event (workspace_id, kind, summary) VALUES ($1, $2, $3);

-- name: ListBillingEvents :many
SELECT at, kind, summary FROM billing_event WHERE workspace_id = $1 ORDER BY at DESC, id LIMIT 20;

-- name: CountPeopleAndMembers :one
SELECT (SELECT count(*) FROM person p WHERE p.workspace_id = $1)::int AS people, (SELECT count(*) FROM member m WHERE m.workspace_id = $1)::int AS members;
