-- name: ListStatuses :many
SELECT * FROM status WHERE workspace_id = $1 ORDER BY position, id;

-- name: GetStatus :one
SELECT * FROM status WHERE workspace_id = $1 AND id = $2;

-- name: CreateStatus :one
INSERT INTO status (workspace_id, name, bucket, position)
VALUES ($1, $2, $3, coalesce((SELECT max(position) + 1 FROM status WHERE workspace_id = $1), 0))
RETURNING *;

-- name: RenameStatus :execrows
UPDATE status SET name = $3 WHERE workspace_id = $1 AND id = $2;

-- name: GetRequestForStatusChange :one
SELECT r.id, r.title, r.status_id, s.bucket AS bucket
FROM request r JOIN status s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
WHERE r.workspace_id = $1 AND r.id = $2
FOR UPDATE OF r;

-- name: SetRequestStatus :exec
UPDATE request SET status_id = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: ListRequesters :many
SELECT p.id, p.name, p.email, p.account_id, array_agg(e.id ORDER BY e.created_at, e.id)::uuid[] AS evidence_ids
FROM evidence e JOIN person p ON p.workspace_id = e.workspace_id AND p.id = e.person_id
WHERE e.workspace_id = $1 AND e.request_id = $2
GROUP BY p.id, p.name, p.email, p.account_id
ORDER BY p.id;

-- name: CountAnonymousEvidence :one
SELECT count(*)::int FROM evidence WHERE workspace_id = $1 AND request_id = $2 AND person_id IS NULL;

-- name: InsertBatch :one
INSERT INTO outreach_batch (workspace_id, request_id, release_note_id, created_by) VALUES ($1, $2, $3, $4)
ON CONFLICT (request_id) WHERE state IN ('drafting', 'review', 'approved') DO NOTHING
RETURNING *;

-- name: GetOpenBatchForRequest :one
SELECT * FROM outreach_batch WHERE workspace_id = $1 AND request_id = $2 AND state IN ('drafting', 'review', 'approved');

-- name: GetBatch :one
SELECT * FROM outreach_batch WHERE workspace_id = $1 AND id = $2;

-- name: GetBatchForUpdate :one
SELECT * FROM outreach_batch WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: ListBatches :many
SELECT b.*, r.title AS request_title,
       (SELECT count(*) FROM outreach_message m WHERE m.workspace_id = b.workspace_id AND m.batch_id = b.id)::int AS message_count
FROM outreach_batch b JOIN request r ON r.workspace_id = b.workspace_id AND r.id = b.request_id
WHERE b.workspace_id = $1 AND b.state = ANY (sqlc.arg(states)::text[])
ORDER BY b.created_at DESC, b.id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: SetBatchState :exec
UPDATE outreach_batch SET state = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: ApproveBatch :exec
UPDATE outreach_batch SET state = 'approved', approved_by = $3, approved_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: InsertMessage :one
INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email, evidence_ids, state)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (request_id, person_id) DO NOTHING
RETURNING id;

-- name: GetMessage :one
SELECT * FROM outreach_message WHERE workspace_id = $1 AND id = $2;

-- name: GetMessageForUpdate :one
SELECT * FROM outreach_message WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: ListBatchMessages :many
SELECT m.*, p.name AS person_name, a.name AS account_name
FROM outreach_message m
JOIN person p ON p.workspace_id = m.workspace_id AND p.id = m.person_id
LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
WHERE m.workspace_id = $1 AND m.batch_id = $2
ORDER BY lower(coalesce(a.name, '~')), lower(p.name), m.id;

-- name: SetMessageDraft :exec
UPDATE outreach_message SET state = 'draft', subject = $3, body = $4, generated_subject = $3, generated_body = $4, drafted_by = $5, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state = 'drafting';

-- name: SetMessageSuppressed :exec
UPDATE outreach_message SET state = 'suppressed', updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state IN ('drafting', 'draft', 'approved', 'sending');

-- name: EditMessage :execrows
UPDATE outreach_message SET subject = $3, body = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'draft';

-- name: ExcludeMessage :execrows
UPDATE outreach_message SET state = 'excluded', updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'draft';

-- name: IncludeMessage :execrows
UPDATE outreach_message SET state = 'draft', updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'excluded';

-- name: ApproveDraftMessages :many
UPDATE outreach_message SET state = 'approved', approved_by = $3, approved_at = now(), updated_at = now()
WHERE workspace_id = $1 AND batch_id = $2 AND state = 'draft' AND char_length(trim(body)) > 0 AND char_length(trim(subject)) > 0
RETURNING id;

-- name: ClaimMessageForSend :one
UPDATE outreach_message SET state = 'sending', attempts = attempts + 1, updated_at = now()
WHERE workspace_id = $1 AND id = $2
  AND (state = 'approved' OR (state = 'sending' AND updated_at < now() - interval '5 minutes'))
RETURNING *;

-- name: MarkMessageSent :exec
UPDATE outreach_message SET state = 'sent', sent_at = now(), provider_message_id = $3, last_error_class = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state = 'sending';

-- name: ReleaseMessageForRetry :exec
UPDATE outreach_message SET state = 'approved', last_error_class = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'sending';

-- name: MarkMessageFailed :exec
UPDATE outreach_message SET state = 'failed', last_error_class = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'sending';

-- name: RetryFailedMessage :execrows
UPDATE outreach_message SET state = 'approved', last_error_class = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'failed';

-- name: CountBatchMessagesByState :many
SELECT state, count(*)::int AS n FROM outreach_message WHERE workspace_id = $1 AND batch_id = $2 GROUP BY state;

-- name: ListEvidenceByIDs :many
SELECT * FROM evidence WHERE workspace_id = $1 AND id = ANY (sqlc.arg(ids)::uuid[]) ORDER BY created_at, id;

-- name: IsSuppressed :one
SELECT EXISTS (SELECT 1 FROM suppression WHERE workspace_id = $1 AND email = $2) AS suppressed;

-- name: UpsertSuppression :exec
INSERT INTO suppression (workspace_id, email, reason) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, email) DO NOTHING;

-- name: ListInformedForRequest :many
SELECT m.person_id, p.name AS person_name, m.sent_at
FROM outreach_message m JOIN person p ON p.workspace_id = m.workspace_id AND p.id = m.person_id
WHERE m.workspace_id = $1 AND m.request_id = $2 AND m.state = 'sent'
ORDER BY m.sent_at, m.id;

-- name: GetWorkspaceSettings :one
SELECT id, name, public_slug, sender_name FROM workspace WHERE id = $1;

-- name: UpdateWorkspaceSettings :execrows
UPDATE workspace SET public_slug = $2, sender_name = $3, updated_at = now() WHERE id = $1;

-- name: ListWorkspaceNamesForGuard :many
SELECT lower(p.name)::text AS n FROM person p WHERE p.workspace_id = $1
UNION
SELECT lower(a.name)::text FROM account a WHERE a.workspace_id = $1;

-- name: SuppressPendingMessagesForEmail :many
UPDATE outreach_message SET state = 'suppressed', updated_at = now()
WHERE workspace_id = $1 AND to_email = $2 AND state IN ('drafting', 'draft', 'approved')
RETURNING batch_id;

-- name: ExcludeOpenMessagesInBatch :exec
UPDATE outreach_message SET state = 'excluded', updated_at = now()
WHERE workspace_id = $1 AND batch_id = $2 AND state IN ('drafting', 'draft', 'approved');

-- name: GetLinkedNoteForRequest :one
SELECT n.id, n.title FROM release_note n JOIN release_note_request l ON l.workspace_id = n.workspace_id AND l.release_note_id = n.id
WHERE n.workspace_id = $1 AND l.request_id = $2 AND n.state IN ('draft', 'scheduled', 'published')
ORDER BY n.updated_at DESC LIMIT 1;

-- name: GetNoteTitle :one
SELECT title FROM release_note WHERE workspace_id = $1 AND id = $2;

-- name: GetPersonBasics :one
SELECT p.id, p.name, p.email, p.account_id, a.name AS account_name
FROM person p LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
WHERE p.workspace_id = $1 AND p.id = $2;

-- name: DeleteUnsentMessagesInBatch :exec
DELETE FROM outreach_message WHERE workspace_id = $1 AND batch_id = $2 AND state NOT IN ('sending', 'sent');
