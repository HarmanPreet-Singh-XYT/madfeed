-- name: ListViews :many
SELECT * FROM saved_view WHERE workspace_id = $1 ORDER BY lower(name), id;

-- name: InsertView :one
INSERT INTO saved_view (workspace_id, name, status_id, tag_id, search, sort, created_by)
VALUES ($1, btrim($2), $3, $4, $5, $6, $7) RETURNING *;

-- name: GetView :one
SELECT * FROM saved_view WHERE workspace_id = $1 AND id = $2;

-- name: DeleteView :execrows
DELETE FROM saved_view WHERE workspace_id = $1 AND id = $2;
