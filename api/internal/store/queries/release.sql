-- name: CreateNote :one
INSERT INTO release_note (workspace_id, title, body, type, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateNote :execrows
UPDATE release_note SET title = $3, body = $4, type = $5, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: GetNote :one
SELECT * FROM release_note WHERE workspace_id = $1 AND id = $2;

-- name: ListNotes :many
SELECT * FROM release_note
WHERE workspace_id = $1
  AND (created_at, id) < (sqlc.arg(before_created_at)::timestamptz, sqlc.arg(before_id)::uuid)
  AND (sqlc.narg(state)::text IS NULL OR state = sqlc.narg(state)::text)
  AND (sqlc.narg(q)::text IS NULL OR position(lower(sqlc.narg(q)::text) in lower(title)) > 0)
  AND (sqlc.narg(type)::text IS NULL OR type = sqlc.narg(type)::text)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: CountNotes :one
SELECT
  count(*)::int AS total,
  count(*) FILTER (WHERE state = 'draft')::int AS drafts,
  count(*) FILTER (WHERE state = 'scheduled')::int AS scheduled,
  count(*) FILTER (WHERE state = 'published')::int AS published,
  count(*) FILTER (WHERE state = 'unpublished')::int AS unpublished
FROM release_note WHERE workspace_id = $1;

-- name: DeleteDraftNote :execrows
DELETE FROM release_note WHERE workspace_id = $1 AND id = $2 AND state = 'draft';

-- name: PutNoteCover :exec
INSERT INTO release_note_cover (workspace_id, release_note_id, content_type, size, data, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (workspace_id, release_note_id) DO UPDATE
SET content_type = EXCLUDED.content_type, size = EXCLUDED.size, data = EXCLUDED.data, updated_at = now();

-- name: TouchNoteCover :execrows
UPDATE release_note SET cover_updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: GetNoteCover :one
SELECT content_type, data, updated_at FROM release_note_cover WHERE workspace_id = $1 AND release_note_id = $2;

-- name: DeleteNoteCover :execrows
DELETE FROM release_note_cover WHERE workspace_id = $1 AND release_note_id = $2;

-- name: ClearNoteCoverTime :execrows
UPDATE release_note SET cover_updated_at = NULL WHERE workspace_id = $1 AND id = $2;

-- name: PublishNote :execrows
UPDATE release_note SET state = 'published', published_at = now(), scheduled_for = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state IN ('draft', 'scheduled', 'unpublished');

-- name: ScheduleNote :execrows
UPDATE release_note SET state = 'scheduled', scheduled_for = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state IN ('draft', 'scheduled', 'unpublished');

-- name: UnscheduleNote :execrows
UPDATE release_note SET state = 'draft', scheduled_for = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state = 'scheduled';

-- name: UnpublishNote :execrows
UPDATE release_note SET state = 'unpublished', updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state IN ('published', 'scheduled');

-- name: ClearNoteRequests :exec
DELETE FROM release_note_request WHERE workspace_id = $1 AND release_note_id = $2;

-- name: LinkNoteRequest :exec
INSERT INTO release_note_request (workspace_id, release_note_id, request_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: ListNoteRequests :many
SELECT r.id, r.title FROM release_note_request l JOIN request r ON r.workspace_id = l.workspace_id AND r.id = l.request_id
WHERE l.workspace_id = $1 AND l.release_note_id = $2 ORDER BY r.title, r.id;

-- name: ListNotesForRequest :many
SELECT n.id, n.title, n.state, n.published_at, n.scheduled_for
FROM release_note_request l JOIN release_note n ON n.workspace_id = l.workspace_id AND n.id = l.release_note_id
WHERE l.workspace_id = $1 AND l.request_id = $2 ORDER BY n.updated_at DESC, n.id;

-- name: PublicListNotes :many
SELECT id, title, body, type, cover_updated_at, coalesce(published_at, scheduled_for)::timestamptz AS shown_at
FROM release_note
WHERE workspace_id = $1 AND (state = 'published' OR (state = 'scheduled' AND scheduled_for <= now()))
ORDER BY coalesce(published_at, scheduled_for) DESC, id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: PublicGetNote :one
SELECT id, title, body, type, cover_updated_at, coalesce(published_at, scheduled_for)::timestamptz AS shown_at
FROM release_note
WHERE workspace_id = $1 AND id = $2 AND (state = 'published' OR (state = 'scheduled' AND scheduled_for <= now()));

-- name: PublicGetNoteCover :one
SELECT c.content_type, c.data, c.updated_at
FROM release_note_cover c
JOIN release_note n ON n.workspace_id = c.workspace_id AND n.id = c.release_note_id
WHERE c.workspace_id = $1 AND c.release_note_id = $2
  AND (n.state = 'published' OR (n.state = 'scheduled' AND n.scheduled_for <= now()));

-- name: GetWorkspaceName :one
SELECT name FROM workspace WHERE id = $1;
