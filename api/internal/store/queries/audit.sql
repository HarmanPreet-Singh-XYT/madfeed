-- name: ListAuditSamples :many
SELECT * FROM audit_sample WHERE workspace_id = $1 ORDER BY (verdict IS NOT NULL), sampled_at DESC, id LIMIT sqlc.arg(page_size)::int;

-- name: GetAuditSampleForUpdate :one
SELECT * FROM audit_sample WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: ReviewAuditSample :exec
UPDATE audit_sample SET verdict = $3, note = $4, reviewed_by = $5, reviewed_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: AuditTotals :one
SELECT count(*) FILTER (WHERE verdict IS NOT NULL)::int AS reviewed,
       count(*) FILTER (WHERE verdict = 'supported')::int AS supported,
       count(*) FILTER (WHERE verdict IS NULL)::int AS waiting
FROM audit_sample WHERE workspace_id = $1 AND sampled_at > now() - interval '90 days';
