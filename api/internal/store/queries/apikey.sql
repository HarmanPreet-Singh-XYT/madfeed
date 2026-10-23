-- name: CreateAPIKey :one
INSERT INTO api_key (workspace_id, name, prefix, key_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at;

-- name: ListAPIKeys :many
SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_key WHERE workspace_id = $1 ORDER BY created_at DESC, id LIMIT 50;

-- name: CountActiveAPIKeys :one
SELECT count(*)::int FROM api_key WHERE workspace_id = $1 AND revoked_at IS NULL;

-- name: RevokeAPIKey :execrows
UPDATE api_key SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL;
