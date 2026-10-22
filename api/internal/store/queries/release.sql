-- name: CreateNote :one
INSERT INTO release_note (workspace_id, title, body, created_by) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdateNote :execrows
UPDATE release_note SET title = $3, body = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: GetNote :one
SELECT * FROM release_note WHERE workspace_id = $1 AND id = $2;

-- name: ListNotes :many
SELECT * FROM release_note
WHERE workspace_id = $1 AND (created_at, id) < (sqlc.arg(before_created_at)::timestamptz, sqlc.arg(before_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: PublishNote :execrows
UPDATE release_note SET state = 'published', published_at = now(), scheduled_for = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state IN ('draft', 'scheduled', 'unpublished');

-- name: ScheduleNote :execrows
UPDATE release_note SET state = 'scheduled', scheduled_for = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state IN ('draft', 'scheduled', 'unpublished');

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
SELECT id, title, body, coalesce(published_at, scheduled_for)::timestamptz AS shown_at
FROM release_note
WHERE workspace_id = $1 AND (state = 'published' OR (state = 'scheduled' AND scheduled_for <= now()))
ORDER BY coalesce(published_at, scheduled_for) DESC, id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: PublicGetNote :one
SELECT id, title, body, coalesce(published_at, scheduled_for)::timestamptz AS shown_at
FROM release_note
WHERE workspace_id = $1 AND id = $2 AND (state = 'published' OR (state = 'scheduled' AND scheduled_for <= now()));

-- name: GetWorkspaceName :one
SELECT name FROM workspace WHERE id = $1;
