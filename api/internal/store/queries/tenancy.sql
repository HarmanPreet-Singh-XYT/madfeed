-- name: CreateWorkspace :one
INSERT INTO workspace (id, name) VALUES ($1, $2) RETURNING *;

-- name: AddMember :exec
INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, $3);

-- name: GetMemberRole :one
SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2;

-- name: ListMyWorkspaces :many
SELECT w.id AS workspace_id, w.name, m.role
FROM member m JOIN workspace w ON w.id = m.workspace_id
WHERE m.user_id = $1
ORDER BY m.created_at, w.id;

-- name: CreateRequest :one
INSERT INTO request (workspace_id, title) VALUES ($1, $2) RETURNING *;

-- name: GetRequest :one
SELECT * FROM request WHERE workspace_id = $1 AND id = $2;

-- name: ListRequests :many
-- Keyset pagination: pass the last (created_at, id) of the previous page, or
-- now()+1 day and the max uuid for the first page.
SELECT * FROM request
WHERE workspace_id = $1
  AND (created_at, id) < (sqlc.arg(before_created_at)::timestamptz, sqlc.arg(before_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: UpdateRequestTitle :execrows
UPDATE request SET title = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: DeleteRequest :execrows
DELETE FROM request WHERE workspace_id = $1 AND id = $2;

-- name: SetRequestPublicSignal :execrows
UPDATE request SET public_signal = $3::jsonb WHERE workspace_id = $1 AND id = $2;
