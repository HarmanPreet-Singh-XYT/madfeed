-- name: ExportAccountsPage :many
SELECT * FROM account WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportPeoplePage :many
SELECT * FROM person WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportSourcesPage :many
SELECT * FROM source_item WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportStatusesPage :many
SELECT * FROM status WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportNotesPage :many
SELECT n.*, coalesce(array_agg(l.request_id ORDER BY l.request_id) FILTER (WHERE l.request_id IS NOT NULL), '{}')::uuid[] AS request_ids
FROM release_note n LEFT JOIN release_note_request l ON l.workspace_id = n.workspace_id AND l.release_note_id = n.id
WHERE n.workspace_id = $1 AND n.id > $2
GROUP BY n.id ORDER BY n.id LIMIT sqlc.arg(page_size)::int;

-- name: ExportRequestsPage :many
SELECT r.*, coalesce(array_agg(rt.tag_id ORDER BY rt.tag_id) FILTER (WHERE rt.tag_id IS NOT NULL), '{}')::uuid[] AS tag_ids
FROM request r LEFT JOIN request_tag rt ON rt.workspace_id = r.workspace_id AND rt.request_id = r.id
WHERE r.workspace_id = $1 AND r.id > $2
GROUP BY r.id ORDER BY r.id LIMIT sqlc.arg(page_size)::int;

-- name: ExportTagsPage :many
SELECT * FROM tag WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: ExportHighlightsPage :many
SELECT h.*, coalesce(array_agg(ht.tag_id ORDER BY ht.tag_id) FILTER (WHERE ht.tag_id IS NOT NULL), '{}')::uuid[] AS tag_ids
FROM highlight h LEFT JOIN highlight_tag ht ON ht.workspace_id = h.workspace_id AND ht.highlight_id = h.id
WHERE h.workspace_id = $1 AND h.id > $2
GROUP BY h.id ORDER BY h.id LIMIT sqlc.arg(page_size)::int;

-- name: ExportEvidencePage :many
SELECT * FROM evidence WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT sqlc.arg(page_size)::int;

-- name: WorkspaceIsEmpty :one
SELECT NOT (EXISTS (SELECT 1 FROM account a WHERE a.workspace_id = $1) OR EXISTS (SELECT 1 FROM person p WHERE p.workspace_id = $1)
         OR EXISTS (SELECT 1 FROM source_item s WHERE s.workspace_id = $1) OR EXISTS (SELECT 1 FROM request r WHERE r.workspace_id = $1)
         OR EXISTS (SELECT 1 FROM release_note n WHERE n.workspace_id = $1) OR EXISTS (SELECT 1 FROM suppression x WHERE x.workspace_id = $1) OR EXISTS (SELECT 1 FROM tag t WHERE t.workspace_id = $1) OR EXISTS (SELECT 1 FROM highlight h WHERE h.workspace_id = $1)) AS empty;

-- name: ExportSuppressionsPage :many
SELECT * FROM suppression WHERE workspace_id = $1 AND email > $2 ORDER BY email LIMIT sqlc.arg(page_size)::int;

-- name: DeleteAllStatuses :exec
DELETE FROM status WHERE workspace_id = $1;
