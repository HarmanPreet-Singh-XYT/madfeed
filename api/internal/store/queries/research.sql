-- name: ListTags :many
SELECT t.*,
       (SELECT count(*) FROM highlight_tag h WHERE h.workspace_id = t.workspace_id AND h.tag_id = t.id)::int AS highlight_count,
       (SELECT count(*) FROM request_tag r WHERE r.workspace_id = t.workspace_id AND r.tag_id = t.id)::int AS request_count,
       coalesce((SELECT m.id FROM tag_merge m WHERE m.workspace_id = t.workspace_id AND m.source_tag_id = t.id AND m.undone_at IS NULL ORDER BY m.merged_at DESC LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid)::uuid AS undo_merge_id
FROM tag t
WHERE t.workspace_id = $1 AND (sqlc.arg(include_archived)::bool OR (t.archived_at IS NULL))
ORDER BY (t.archived_at IS NOT NULL), lower(t.name), t.id;

-- name: GetTag :one
SELECT * FROM tag WHERE workspace_id = $1 AND id = $2;

-- name: GetTagForUpdate :one
SELECT * FROM tag WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: InsertTag :one
INSERT INTO tag (workspace_id, name, definition, color, origin, created_by)
VALUES ($1, btrim($2), $3, $4, $5, $6) RETURNING *;

-- name: UpdateTag :execrows
UPDATE tag SET name = btrim($3), definition = $4, color = $5, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL;

-- name: ArchiveTag :execrows
UPDATE tag SET archived_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL;

-- name: RestoreTag :execrows
UPDATE tag SET archived_at = NULL, merged_into = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND archived_at IS NOT NULL;

-- name: MarkTagMerged :exec
UPDATE tag SET archived_at = now(), merged_into = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: MoveHighlightTags :many
-- Re-point highlights from one tag to another; a highlight already carrying
-- the target keeps one row. Returns the highlights that were moved.
WITH moved AS (
  DELETE FROM highlight_tag AS d WHERE d.workspace_id = $1 AND d.tag_id = $2 RETURNING d.highlight_id
), ins AS (
  INSERT INTO highlight_tag (workspace_id, highlight_id, tag_id)
  SELECT $1, highlight_id, $3 FROM moved ON CONFLICT DO NOTHING
)
SELECT highlight_id FROM moved;

-- name: MoveRequestTags :many
WITH moved AS (
  DELETE FROM request_tag AS d WHERE d.workspace_id = $1 AND d.tag_id = $2 RETURNING d.request_id
), ins AS (
  INSERT INTO request_tag (workspace_id, request_id, tag_id)
  SELECT $1, request_id, $3 FROM moved ON CONFLICT DO NOTHING
)
SELECT request_id FROM moved;

-- name: InsertTagMerge :one
INSERT INTO tag_merge (workspace_id, source_tag_id, target_tag_id, highlight_ids, request_ids, kept_highlight_ids, kept_request_ids, merged_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: HighlightsWithBothTags :many
SELECT a.highlight_id FROM highlight_tag a JOIN highlight_tag b ON b.workspace_id = a.workspace_id AND b.highlight_id = a.highlight_id
WHERE a.workspace_id = $1 AND a.tag_id = $2 AND b.tag_id = $3;

-- name: RequestsWithBothTags :many
SELECT a.request_id FROM request_tag a JOIN request_tag b ON b.workspace_id = a.workspace_id AND b.request_id = a.request_id
WHERE a.workspace_id = $1 AND a.tag_id = $2 AND b.tag_id = $3;

-- name: GetTagMergeForUpdate :one
SELECT * FROM tag_merge WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: MarkTagMergeUndone :exec
UPDATE tag_merge SET undone_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: RemoveTagFromHighlights :exec
DELETE FROM highlight_tag WHERE workspace_id = $1 AND tag_id = $2 AND highlight_id = ANY (sqlc.arg(highlight_ids)::uuid[]);

-- name: AddTagToHighlights :exec
INSERT INTO highlight_tag (workspace_id, highlight_id, tag_id)
SELECT $1, x, $2 FROM unnest(sqlc.arg(highlight_ids)::uuid[]) AS x ON CONFLICT DO NOTHING;

-- name: RemoveTagFromRequests :exec
DELETE FROM request_tag WHERE workspace_id = $1 AND tag_id = $2 AND request_id = ANY (sqlc.arg(request_ids)::uuid[]);

-- name: AddTagToRequests :exec
INSERT INTO request_tag (workspace_id, request_id, tag_id)
SELECT $1, x, $2 FROM unnest(sqlc.arg(request_ids)::uuid[]) AS x ON CONFLICT DO NOTHING;

-- name: LatestMergeForSource :one
SELECT * FROM tag_merge WHERE workspace_id = $1 AND source_tag_id = $2 AND undone_at IS NULL ORDER BY merged_at DESC LIMIT 1;

-- name: InsertHighlight :one
INSERT INTO highlight (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, note, author_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (source_item_id, span_start, span_end) DO NOTHING
RETURNING *;

-- name: GetHighlightBySpan :one
SELECT * FROM highlight WHERE workspace_id = $1 AND source_item_id = $2 AND span_start = $3 AND span_end = $4;

-- name: GetHighlight :one
SELECT * FROM highlight WHERE workspace_id = $1 AND id = $2;

-- name: DeleteHighlight :execrows
DELETE FROM highlight WHERE workspace_id = $1 AND id = $2;

-- name: UpdateHighlightNote :execrows
UPDATE highlight SET note = $3 WHERE workspace_id = $1 AND id = $2;

-- name: SetHighlightTag :exec
INSERT INTO highlight_tag (workspace_id, highlight_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: UnsetHighlightTag :exec
DELETE FROM highlight_tag WHERE workspace_id = $1 AND highlight_id = $2 AND tag_id = $3;

-- name: SetRequestTag :exec
INSERT INTO request_tag (workspace_id, request_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: UnsetRequestTag :exec
DELETE FROM request_tag WHERE workspace_id = $1 AND request_id = $2 AND tag_id = $3;

-- name: ListHighlights :many
-- Newest first, keyset-paginated. `matching` is the whole filtered set, so
-- total_count is the size of the filter and not of this page, even when the
-- page is empty. An empty tag_ids array means "any tag"; untagged asks for the
-- ones nobody has tagged yet.
WITH matching AS (
  SELECT h.*, s.title AS source_title,
         coalesce((SELECT sg.start_ms FROM segment sg WHERE sg.workspace_id = h.workspace_id AND sg.source_item_id = h.source_item_id AND sg.span_start <= h.span_start ORDER BY sg.span_start DESC LIMIT 1), -1)::int AS start_ms,
         (count(*) OVER ())::int AS total_count
  FROM highlight h JOIN source_item s ON s.workspace_id = h.workspace_id AND s.id = h.source_item_id
  WHERE h.workspace_id = sqlc.arg(workspace_id)
    AND (sqlc.narg(source_item_id)::uuid IS NULL OR h.source_item_id = sqlc.narg(source_item_id))
    AND (NOT sqlc.arg(untagged)::bool OR NOT EXISTS (
          SELECT 1 FROM highlight_tag t WHERE t.workspace_id = h.workspace_id AND t.highlight_id = h.id))
    AND (cardinality(sqlc.arg(tag_ids)::uuid[]) = 0 OR EXISTS (
          SELECT 1 FROM highlight_tag t WHERE t.workspace_id = h.workspace_id AND t.highlight_id = h.id
            AND t.tag_id = ANY (sqlc.arg(tag_ids)::uuid[])))
    AND (sqlc.narg(search)::text IS NULL OR to_tsvector('english', h.quote_text) @@ to_tsquery('english', sqlc.narg(search)::text))
)
SELECT * FROM matching
WHERE (sqlc.narg(after_created)::timestamptz IS NULL OR (created_at, id) < (sqlc.narg(after_created)::timestamptz, sqlc.narg(after_id)::uuid))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: CountHighlightsByIDs :one
SELECT count(*)::int FROM highlight WHERE workspace_id = $1 AND id = ANY (sqlc.arg(ids)::uuid[]);

-- name: AddTagsToHighlights :execrows
-- Tag a batch at once; a highlight that already has the tag keeps one row.
INSERT INTO highlight_tag (workspace_id, highlight_id, tag_id)
SELECT $1, h, t
FROM unnest(sqlc.arg(highlight_ids)::uuid[]) AS h
CROSS JOIN unnest(sqlc.arg(tag_ids)::uuid[]) AS t
ON CONFLICT DO NOTHING;

-- name: ListTagsForHighlights :many
SELECT ht.highlight_id, t.id, t.name, t.color
FROM highlight_tag ht JOIN tag t ON t.workspace_id = ht.workspace_id AND t.id = ht.tag_id
WHERE ht.workspace_id = $1 AND ht.highlight_id = ANY (sqlc.arg(highlight_ids)::uuid[])
ORDER BY lower(t.name);

-- name: ListTagsForRequest :many
SELECT t.id, t.name, t.color FROM request_tag rt JOIN tag t ON t.workspace_id = rt.workspace_id AND t.id = rt.tag_id
WHERE rt.workspace_id = $1 AND rt.request_id = $2 ORDER BY lower(t.name);

-- name: ListTagsForRequests :many
-- The tags of a page of requests in one go (a list shows them without a query per row).
SELECT rt.request_id, t.id, t.name, t.color
FROM request_tag rt JOIN tag t ON t.workspace_id = rt.workspace_id AND t.id = rt.tag_id
WHERE rt.workspace_id = $1 AND rt.request_id = ANY (sqlc.arg(request_ids)::uuid[])
ORDER BY lower(t.name);

-- name: FindChunkForOffset :one
SELECT * FROM chunk WHERE workspace_id = $1 AND source_item_id = $2 AND start_offset <= $3 AND end_offset > $3 ORDER BY ordinal LIMIT 1;

-- name: ListHighlightsForSource :many
SELECT * FROM highlight WHERE workspace_id = $1 AND source_item_id = $2 ORDER BY span_start, id;

-- name: SearchQuotes :many
-- Word search over every stored quote (evidence and highlights). The query
-- text is built in Go from letters and digits only, joined with " | ".
WITH q AS (SELECT to_tsquery('english', sqlc.arg(query)::text) AS tsq)
SELECT * FROM (
  SELECT 'evidence'::text AS kind, e.id, e.source_item_id, e.span_start, e.span_end, e.quote_text,
         ts_rank_cd(to_tsvector('english', e.quote_text), q.tsq)::float8 AS rank
  FROM evidence e, q
  WHERE e.workspace_id = $1 AND to_tsvector('english', e.quote_text) @@ q.tsq
  UNION ALL
  SELECT 'highlight'::text, h.id, h.source_item_id, h.span_start, h.span_end, h.quote_text,
         ts_rank_cd(to_tsvector('english', h.quote_text), q.tsq)::float8
  FROM highlight h, q
  WHERE h.workspace_id = $1 AND to_tsvector('english', h.quote_text) @@ q.tsq
) hits
ORDER BY rank DESC, kind, id
LIMIT sqlc.arg(max_hits)::int;

-- name: InsertAnswer :one
INSERT INTO qa_answer (workspace_id, asked_by, question, outcome, answer, reason, prompt_version, provider, model)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: InsertCitation :exec
INSERT INTO qa_citation (workspace_id, answer_id, ordinal, evidence_id, highlight_id) VALUES ($1, $2, $3, $4, $5);

-- name: GetAnswer :one
SELECT * FROM qa_answer WHERE workspace_id = $1 AND id = $2;

-- name: ListAnswers :many
SELECT * FROM qa_answer WHERE workspace_id = $1 AND asked_by = $2 ORDER BY created_at DESC, id DESC LIMIT sqlc.arg(page_size)::int;

-- name: ListCitations :many
SELECT c.ordinal, c.evidence_id, c.highlight_id,
       coalesce(e.source_item_id, h.source_item_id) AS source_item_id,
       coalesce(e.span_start, h.span_start) AS span_start,
       coalesce(e.span_end, h.span_end) AS span_end,
       coalesce(e.quote_text, h.quote_text) AS quote_text
FROM qa_citation c
LEFT JOIN evidence e ON e.workspace_id = c.workspace_id AND e.id = c.evidence_id
LEFT JOIN highlight h ON h.workspace_id = c.workspace_id AND h.id = c.highlight_id
WHERE c.workspace_id = $1 AND c.answer_id = $2
ORDER BY c.ordinal;

-- name: RateAnswer :execrows
UPDATE qa_answer SET rating = $4 WHERE workspace_id = $1 AND id = $2 AND asked_by = $3;

-- name: CountAnswersSince :one
SELECT count(*)::int FROM qa_answer WHERE workspace_id = $1 AND created_at >= $2;
