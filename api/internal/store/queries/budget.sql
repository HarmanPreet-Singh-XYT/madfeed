-- name: GetAISpend :one
SELECT coalesce((SELECT sum(cost_usd) FROM ai_event WHERE workspace_id = $1 AND created_at > now() - interval '24 hours'), 0)::float8 AS spent,
       coalesce((SELECT ai_daily_budget_usd::float8 FROM workspace WHERE id = $1), -1)::float8 AS limit_usd;

-- name: InsertNotice :exec
INSERT INTO notice (workspace_id, kind, message) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, kind, created_on) DO NOTHING;

-- name: ListRecentNotices :many
SELECT * FROM notice WHERE workspace_id = $1 AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 5;
