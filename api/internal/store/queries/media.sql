-- name: InsertMedia :one
INSERT INTO media (workspace_id, uploaded_by, person_id, filename, mime_type, size_bytes, storage_key, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: GetMedia :one
SELECT * FROM media WHERE workspace_id = $1 AND id = $2;

-- name: GetMediaForUpdate :one
SELECT * FROM media WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: ListMedia :many
SELECT * FROM media WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT sqlc.arg(page_size)::int;

-- name: SetMediaReceived :exec
UPDATE media SET received_bytes = $3, expires_at = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'uploading';

-- name: SetMediaUploaded :exec
UPDATE media SET state = 'uploaded', expires_at = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'uploading';

-- name: SetMediaState :exec
UPDATE media SET state = $3, failure_reason = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: SetMediaDone :exec
UPDATE media SET state = 'done', failure_reason = NULL, source_item_id = $3, duration_ms = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: DeleteMedia :execrows
DELETE FROM media WHERE workspace_id = $1 AND id = $2;

-- name: SumMediaBytesSince :one
SELECT coalesce(sum(size_bytes), 0)::bigint FROM media WHERE workspace_id = $1 AND created_at >= $2;

-- name: ListMediaForSource :many
SELECT * FROM media WHERE workspace_id = $1 AND source_item_id = $2;

-- name: ListMediaForPerson :many
SELECT m.* FROM media m JOIN source_item s ON s.workspace_id = m.workspace_id AND s.id = m.source_item_id
WHERE m.workspace_id = $1 AND s.person_id = $2;

-- name: InsertSegment :exec
INSERT INTO segment (workspace_id, source_item_id, ordinal, start_ms, end_ms, speaker, span_start, span_end)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListSegments :many
SELECT * FROM segment WHERE workspace_id = $1 AND source_item_id = $2 ORDER BY ordinal;

-- name: GetMediaBySource :one
SELECT * FROM media WHERE workspace_id = $1 AND source_item_id = $2;

-- name: DeleteSourceItem :execrows
DELETE FROM source_item WHERE workspace_id = $1 AND id = $2;

-- name: ListSourceIDsForPerson :many
SELECT id FROM source_item WHERE workspace_id = $1 AND person_id = $2;

-- name: InsertRecordingSource :one
INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, person_id, created_by, redactions)
VALUES ($1, 'recording', $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: InsertHighlightProposal :execrows
INSERT INTO highlight_proposal (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, tag_ids, confidence)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (source_item_id, span_start, span_end) DO NOTHING;

-- name: ListHighlightProposals :many
SELECT * FROM highlight_proposal WHERE workspace_id = $1 AND source_item_id = $2 AND state = 'suggested' ORDER BY span_start, id;

-- name: GetHighlightProposalForUpdate :one
SELECT * FROM highlight_proposal WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: SetHighlightProposalState :exec
UPDATE highlight_proposal SET state = $3, decided_by = $4, edited = $5 WHERE workspace_id = $1 AND id = $2;

-- name: CountSuggestedForSource :one
SELECT count(*)::int FROM highlight_proposal WHERE workspace_id = $1 AND source_item_id = $2;

-- name: StartsOfSegments :many
SELECT h.id AS highlight_id, coalesce((SELECT sg.start_ms FROM segment sg WHERE sg.source_item_id = h.source_item_id AND sg.span_start <= h.span_start ORDER BY sg.span_start DESC LIMIT 1), -1)::int AS start_ms
FROM highlight h WHERE h.workspace_id = $1 AND h.id = ANY (sqlc.arg(ids)::uuid[]);

-- name: DeleteEvidenceForPerson :exec
DELETE FROM evidence WHERE workspace_id = $1 AND person_id = $2;

-- name: DeleteMessagesForPerson :exec
DELETE FROM outreach_message WHERE workspace_id = $1 AND person_id = $2;

-- name: DeletePersonRow :execrows
DELETE FROM person WHERE workspace_id = $1 AND id = $2;
