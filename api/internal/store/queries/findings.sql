-- name: InsertFindingDoc :one
INSERT INTO finding_doc (workspace_id, title, created_by) VALUES ($1, $2, $3) RETURNING *;

-- name: GetFindingDoc :one
SELECT * FROM finding_doc WHERE workspace_id = $1 AND id = $2;

-- name: GetFindingDocForUpdate :one
SELECT * FROM finding_doc WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE;

-- name: ListFindingDocs :many
SELECT d.*, (SELECT count(*) FROM finding_block b WHERE b.workspace_id = d.workspace_id AND b.doc_id = d.id)::int AS blocks
FROM finding_doc d
WHERE d.workspace_id = $1
  AND (d.deleted_at IS NOT NULL) = sqlc.arg(deleted_only)::bool
  AND (sqlc.arg(q)::text = ''
       OR lower(d.title) LIKE '%' || lower(sqlc.arg(q)::text) || '%'
       OR EXISTS (
         SELECT 1 FROM finding_block b
         LEFT JOIN evidence e ON e.workspace_id = b.workspace_id AND e.id = b.evidence_id
         LEFT JOIN highlight h ON h.workspace_id = b.workspace_id AND h.id = b.highlight_id
         WHERE b.workspace_id = d.workspace_id AND b.doc_id = d.id
           AND (lower(b.body) LIKE '%' || lower(sqlc.arg(q)::text) || '%'
                OR lower(coalesce(e.quote_text, h.quote_text, '')) LIKE '%' || lower(sqlc.arg(q)::text) || '%')
       ))
ORDER BY d.updated_at DESC, d.id LIMIT sqlc.arg(page_size)::int;

-- name: UpdateFindingTitle :execrows
UPDATE finding_doc SET title = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;

-- name: TouchFindingDoc :exec
UPDATE finding_doc SET updated_at = now() WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;

-- name: DeleteFindingDoc :execrows
-- A deleted document is restorable and its public link stops at once.
UPDATE finding_doc SET deleted_at = now(), state = 'draft', share_epoch = share_epoch + 1, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;

-- name: RestoreFindingDoc :execrows
UPDATE finding_doc SET deleted_at = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NOT NULL;

-- name: PublishFindingDoc :execrows
UPDATE finding_doc SET state = 'published', published_by = coalesce(published_by, $3), published_at = coalesce(published_at, now()),
  share_expires_at = $4, share_password_hash = $5, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;

-- name: UnpublishFindingDoc :one
-- Ends the public link at once: raising the number makes every earlier link fail its signature check.
UPDATE finding_doc SET state = 'draft', share_epoch = share_epoch + 1, share_expires_at = NULL, share_password_hash = NULL, updated_at = now()
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

-- name: InsertFindingVersion :one
INSERT INTO finding_doc_version (workspace_id, doc_id, title, blocks, created_by)
VALUES ($1, $2, $3, $4, $5) RETURNING id;

-- name: LastFindingVersionAt :one
SELECT coalesce(max(created_at), to_timestamp(0))::timestamptz AS last_at
FROM finding_doc_version WHERE workspace_id = $1 AND doc_id = $2;

-- name: ListFindingVersions :many
SELECT id, title, created_at, jsonb_array_length(blocks)::int AS blocks
FROM finding_doc_version WHERE workspace_id = $1 AND doc_id = $2
ORDER BY created_at DESC, id DESC LIMIT 50;

-- name: GetFindingVersion :one
SELECT title, blocks FROM finding_doc_version WHERE workspace_id = $1 AND doc_id = $2 AND id = $3;

-- name: PruneFindingVersions :exec
DELETE FROM finding_doc_version v
WHERE v.workspace_id = $1 AND v.doc_id = $2
  AND v.id NOT IN (
    SELECT id FROM finding_doc_version WHERE workspace_id = $1 AND doc_id = $2
    ORDER BY created_at DESC, id DESC LIMIT 50
  );
