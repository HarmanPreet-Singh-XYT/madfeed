-- name: ListQuoteViews :many
SELECT * FROM quote_view WHERE workspace_id = $1 ORDER BY lower(name), id;

-- name: InsertQuoteView :one
INSERT INTO quote_view (workspace_id, name, kind, tag_id, sentiment, source_kind, search, meaning, days, sort, person_id, account_id, created_by)
VALUES ($1, btrim($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *;

-- name: GetQuoteView :one
SELECT * FROM quote_view WHERE workspace_id = $1 AND id = $2;

-- name: UpdateQuoteViewName :one
UPDATE quote_view SET name = btrim($3) WHERE workspace_id = $1 AND id = $2 RETURNING *;

-- name: DeleteQuoteView :execrows
DELETE FROM quote_view WHERE workspace_id = $1 AND id = $2;
