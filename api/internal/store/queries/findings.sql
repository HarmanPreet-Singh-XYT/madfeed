-- name: InsertFindingDoc :one
INSERT INTO finding_doc (workspace_id, title, created_by) VALUES ($1, $2, $3) RETURNING *;

-- name: GetFindingDoc :one
SELECT * FROM finding_doc WHERE workspace_id = $1 AND id = $2;

-- name: GetFindingDocForUpdate :one
SELECT * FROM finding_doc WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: ListFindingDocs :many
SELECT d.*, (SELECT count(*) FROM finding_block b WHERE b.workspace_id = d.workspace_id AND b.doc_id = d.id)::int AS blocks
FROM finding_doc d WHERE d.workspace_id = $1 ORDER BY d.updated_at DESC, d.id LIMIT $2;

-- name: UpdateFindingTitle :execrows
UPDATE finding_doc SET title = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: TouchFindingDoc :exec
UPDATE finding_doc SET updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: DeleteFindingDoc :execrows
DELETE FROM finding_doc WHERE workspace_id = $1 AND id = $2;

-- name: PublishFindingDoc :execrows
UPDATE finding_doc SET state = 'published', published_by = $3, published_at = now(), updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state = 'draft';

-- name: UnpublishFindingDoc :one
-- Ends the public link at once: raising the number makes every earlier link fail its signature check.
UPDATE finding_doc SET state = 'draft', share_epoch = share_epoch + 1, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state = 'published' RETURNING share_epoch;

-- name: ListFindingBlocks :many
-- A card shows the stored quote as it is now; a deleted quote leaves an empty pointer (shown as removed).
SELECT b.id, b.ordinal, b.kind, b.body, b.quote_kind, b.evidence_id, b.highlight_id,
  coalesce(e.quote_text, h.quote_text, '')::text AS quote_text,
  coalesce(se.title, sh.title, '')::text AS source_title,
  coalesce(e.source_item_id, h.source_item_id) AS source_item_id,
  coalesce(r.title, '')::text AS request_title
FROM finding_block b
LEFT JOIN evidence e ON e.workspace_id = b.workspace_id AND e.id = b.evidence_id
LEFT JOIN highlight h ON h.workspace_id = b.workspace_id AND h.id = b.highlight_id
LEFT JOIN source_item se ON se.workspace_id = b.workspace_id AND se.id = e.source_item_id
LEFT JOIN source_item sh ON sh.workspace_id = b.workspace_id AND sh.id = h.source_item_id
LEFT JOIN request r ON r.workspace_id = e.workspace_id AND r.id = e.request_id
WHERE b.workspace_id = $1 AND b.doc_id = $2 ORDER BY b.ordinal;

-- name: GetFindingBlockRef :one
SELECT quote_kind, evidence_id, highlight_id FROM finding_block WHERE workspace_id = $1 AND doc_id = $2 AND id = $3 AND kind = 'quote';

-- name: DeleteFindingBlocks :exec
DELETE FROM finding_block WHERE workspace_id = $1 AND doc_id = $2;

-- name: InsertFindingBlock :exec
INSERT INTO finding_block (workspace_id, doc_id, ordinal, kind, body, quote_kind, evidence_id, highlight_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: NextFindingBlockOrdinal :one
SELECT coalesce(max(ordinal) + 1, 0)::int FROM finding_block WHERE workspace_id = $1 AND doc_id = $2;
