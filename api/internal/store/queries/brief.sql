-- name: UpsertBriefPending :one
INSERT INTO brief (workspace_id, request_id, state, requested_by) VALUES ($1, $2, 'pending', $3)
ON CONFLICT (request_id) DO UPDATE SET state = 'pending', failure_reason = NULL, requested_by = EXCLUDED.requested_by, updated_at = now()
RETURNING *;

-- name: GetBrief :one
SELECT * FROM brief WHERE workspace_id = $1 AND request_id = $2;

-- name: CompleteBrief :exec
UPDATE brief SET state = 'ready', claim = $3, disproof = $4, quote_evidence_ids = $5, evidence_fingerprint = $6, low_evidence = $7,
  prompt_version = $8, provider = $9, model = $10, failure_reason = NULL, generated_at = now(), updated_at = now()
WHERE workspace_id = $1 AND request_id = $2;

-- name: FailBrief :exec
UPDATE brief SET state = 'failed', failure_reason = $3, updated_at = now() WHERE workspace_id = $1 AND request_id = $2;

-- name: CountBriefsSince :one
SELECT count(*)::int FROM brief WHERE workspace_id = $1 AND updated_at >= $2;

-- name: ListRequestAccounts :many
SELECT a.id, a.name, a.revenue, count(DISTINCT e.person_id)::int AS people_count
FROM evidence e
JOIN person p ON p.workspace_id = e.workspace_id AND p.id = e.person_id
JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
WHERE e.workspace_id = $1 AND e.request_id = $2
GROUP BY a.id, a.name, a.revenue
ORDER BY a.revenue DESC NULLS LAST, a.name
LIMIT 10;

-- name: EvidenceWindowStats :one
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE created_at >= sqlc.arg(since)::timestamptz)::int AS recent,
       count(*) FILTER (WHERE person_id IS NULL)::int AS unidentified,
       coalesce(min(created_at), 'epoch'::timestamptz)::timestamptz AS first_at, coalesce(max(created_at), 'epoch'::timestamptz)::timestamptz AS newest_at -- epoch only when total = 0
FROM evidence WHERE workspace_id = $1 AND request_id = $2;
