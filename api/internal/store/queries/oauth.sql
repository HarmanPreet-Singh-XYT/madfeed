-- name: InsertOAuthClient :exec
INSERT INTO oauth_client (client_id, name, redirect_uris) VALUES ($1, $2, $3);

-- name: GetOAuthClient :one
SELECT * FROM oauth_client WHERE client_id = $1;

-- name: CountOAuthClients :one
SELECT count(*)::int FROM oauth_client;

-- name: PurgeOAuthClients :exec
DELETE FROM oauth_client c WHERE c.created_at < now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM oauth_grant g WHERE g.client_id = c.client_id);

-- name: InsertOAuthCode :exec
INSERT INTO oauth_code (code_hash, workspace_id, client_id, user_id, scopes, redirect_uri, code_challenge, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: CountOAuthGrants :one
SELECT count(*)::int FROM oauth_grant WHERE workspace_id = $1 AND revoked_at IS NULL;

-- name: InsertOAuthGrant :one
INSERT INTO oauth_grant (workspace_id, client_id, client_name, approved_by, scopes, refresh_hash, refresh_expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;

-- name: GetOAuthGrantForUpdate :one
SELECT * FROM oauth_grant WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: RotateOAuthGrant :exec
UPDATE oauth_grant
SET previous_refresh_hash = refresh_hash, refresh_hash = $3, refresh_expires_at = $4, key_id = $5, last_used_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: SetOAuthGrantKey :exec
UPDATE oauth_grant SET key_id = $3, last_used_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: RevokeOAuthGrant :execrows
UPDATE oauth_grant SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL;

-- name: ListOAuthGrants :many
SELECT id, client_name, scopes, created_at, last_used_at FROM oauth_grant WHERE workspace_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC, id LIMIT 50;

-- name: RevokeKeysOfGrant :exec
UPDATE api_key SET revoked_at = now() WHERE workspace_id = $1 AND oauth_grant_id = $2 AND revoked_at IS NULL;

-- name: RevokeKeysOfGrantExcept :exec
UPDATE api_key SET revoked_at = now() WHERE workspace_id = $1 AND oauth_grant_id = $2 AND id <> $3 AND revoked_at IS NULL;
