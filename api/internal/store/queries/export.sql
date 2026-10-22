-- name: ExportAccountsPage :many
SELECT * FROM account WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportPeoplePage :many
SELECT * FROM person WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportSourcesPage :many
SELECT * FROM source_item WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportRequestsPage :many
SELECT * FROM request WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportEvidencePage :many
SELECT * FROM evidence WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: WorkspaceIsEmpty :one
SELECT NOT (EXISTS (SELECT 1 FROM account a WHERE a.workspace_id = $1) OR EXISTS (SELECT 1 FROM person p WHERE p.workspace_id = $1)
         OR EXISTS (SELECT 1 FROM source_item s WHERE s.workspace_id = $1) OR EXISTS (SELECT 1 FROM request r WHERE r.workspace_id = $1)) AS empty;
