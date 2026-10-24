-- name: CreateAPIKey :one
INSERT INTO api_key (workspace_id, name, prefix, key_hash, created_by, scopes, expires_at, allowed_cidrs, oauth_grant_id)
VALUES ($1, $2, $3, $4, $5, $6, sqlc.narg(expires_at), $7, sqlc.narg(oauth_grant_id)) RETURNING id, created_at;

-- name: ListAPIKeys :many
SELECT id, name, prefix, created_at, last_used_at, revoked_at, scopes, expires_at, allowed_cidrs FROM api_key WHERE workspace_id = $1 AND oauth_grant_id IS NULL ORDER BY created_at DESC, id LIMIT 50;

-- name: CountActiveAPIKeys :one
SELECT count(*)::int FROM api_key WHERE workspace_id = $1 AND oauth_grant_id IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());

-- name: RevokeAPIKey :execrows
UPDATE api_key SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL;

-- name: InsertKeyEvent :exec
INSERT INTO api_key_event (workspace_id, key_id, action, detail, ok) VALUES ($1, $2, $3, $4, $5);

-- name: ListKeyEvents :many
SELECT at, action, detail, ok FROM api_key_event WHERE workspace_id = $1 AND key_id = $2 ORDER BY at DESC, id LIMIT 50;

-- name: PurgeKeyEvents :exec
DELETE FROM api_key_event WHERE workspace_id = $1 AND at < now() - interval '30 days';

-- name: KeyExists :one
SELECT EXISTS (SELECT 1 FROM api_key WHERE workspace_id = $1 AND id = $2) AS ok;
