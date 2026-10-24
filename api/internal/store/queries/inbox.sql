-- name: GetInboxSetting :one
SELECT * FROM inbox_setting WHERE workspace_id = $1;

-- name: UpsertInboxSetting :one
INSERT INTO inbox_setting (workspace_id, chat_enabled, email_enabled, origins, greeting, widget_epoch, inbound_epoch)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (workspace_id) DO UPDATE SET chat_enabled = EXCLUDED.chat_enabled, email_enabled = EXCLUDED.email_enabled, origins = EXCLUDED.origins,
  greeting = EXCLUDED.greeting, widget_epoch = EXCLUDED.widget_epoch, inbound_epoch = EXCLUDED.inbound_epoch, updated_at = now()
RETURNING *;

-- name: InsertConversation :one
INSERT INTO conversation (workspace_id, channel, subject, customer_name, customer_email, person_id, visitor_key, ref)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: GetConversation :one
SELECT * FROM conversation WHERE workspace_id = $1 AND id = $2;

-- name: GetConversationForUpdate :one
SELECT * FROM conversation WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: GetConversationByVisitor :one
SELECT * FROM conversation WHERE workspace_id = $1 AND visitor_key = $2;

-- name: GetConversationByRef :one
SELECT * FROM conversation WHERE workspace_id = $1 AND ref = $2 AND channel = 'email';

-- name: ListConversations :many
SELECT c.*, coalesce((SELECT left(m.body, 160) FROM conversation_message m WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.direction <> 'note' ORDER BY m.seq DESC LIMIT 1), '')::text AS preview
FROM conversation c
WHERE c.workspace_id = $1
  AND (sqlc.arg(state)::text = '' OR c.state = sqlc.arg(state))
  AND (sqlc.arg(mine)::boolean = false OR c.assignee = sqlc.arg(me)::uuid)
  AND (sqlc.arg(unassigned)::boolean = false OR c.assignee IS NULL)
  AND (sqlc.narg(after_at)::timestamptz IS NULL OR (c.last_message_at, c.id) < (sqlc.narg(after_at)::timestamptz, sqlc.narg(after_id)::uuid))
ORDER BY c.last_message_at DESC, c.id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: SetConversationState :execrows
UPDATE conversation SET state = $3 WHERE workspace_id = $1 AND id = $2 AND state <> $3;

-- name: SetConversationAssignee :execrows
UPDATE conversation SET assignee = $3 WHERE workspace_id = $1 AND id = $2;

-- name: AttachConversationPerson :exec
UPDATE conversation SET person_id = $3 WHERE workspace_id = $1 AND id = $2 AND person_id IS NULL;

-- name: TouchConversation :exec
UPDATE conversation SET message_count = message_count + 1, last_message_at = now(),
  state = CASE WHEN sqlc.arg(reopen)::boolean THEN 'open' ELSE state END
WHERE workspace_id = $1 AND id = $2;

-- name: DeleteConversation :execrows
DELETE FROM conversation WHERE workspace_id = $1 AND id = $2;

-- name: ConversationIDsForPerson :many
SELECT id FROM conversation WHERE workspace_id = $1 AND (person_id = $2 OR (customer_email IS NOT NULL AND customer_email = sqlc.arg(email)::text));

-- name: InsertConversationMessage :one
INSERT INTO conversation_message (workspace_id, conversation_id, seq, direction, body, author_id, state, external_id)
VALUES ($1, $2, (SELECT coalesce(max(seq), 0) + 1 FROM conversation_message WHERE conversation_id = $2), $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetMessageByExternalID :one
SELECT * FROM conversation_message WHERE workspace_id = $1 AND external_id = $2;

-- name: ListConversationMessages :many
SELECT * FROM conversation_message WHERE workspace_id = $1 AND conversation_id = $2 AND seq > $3 ORDER BY seq LIMIT 500;

-- name: ListVisibleChatMessages :many
-- What a chat visitor sees: their own messages and the team's sent replies; never a note.
SELECT id, seq, direction, body, created_at FROM conversation_message
WHERE workspace_id = $1 AND conversation_id = $2 AND seq > $3 AND (direction = 'in' OR (direction = 'out' AND state = 'sent')) ORDER BY seq LIMIT 200;

-- name: LastMessageID :one
SELECT coalesce((SELECT id FROM conversation_message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid)::uuid;

-- name: GetConversationMessage :one
SELECT * FROM conversation_message WHERE workspace_id = $1 AND id = $2;

-- name: CountVisitorMessagesSince :one
SELECT count(*)::int FROM conversation_message WHERE workspace_id = $1 AND conversation_id = $2 AND direction = 'in' AND created_at >= $3;

-- name: CountNewConversationsSince :one
SELECT count(*)::int FROM conversation WHERE workspace_id = $1 AND channel = 'chat' AND created_at >= $2;

-- name: ClaimReplyForSend :one
-- A reply a person queued; claimed once. A claim left 'sending' by a worker that died is taken again after ten minutes.
UPDATE conversation_message SET state = 'sending', attempts = attempts + 1, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND direction = 'out' AND author_id IS NOT NULL
  AND (state = 'queued' OR (state = 'sending' AND updated_at < now() - interval '10 minutes'))
RETURNING *;

-- name: MarkReplySent :exec
UPDATE conversation_message SET state = 'sent', provider_message_id = $3, last_error = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: ReleaseReplyForRetry :exec
UPDATE conversation_message SET state = 'queued', last_error = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'sending';

-- name: MarkReplyFailed :exec
UPDATE conversation_message SET state = 'failed', last_error = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: RequeueFailedReply :execrows
UPDATE conversation_message SET state = 'queued', last_error = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'failed' AND direction = 'out';

-- name: InsertConversationLink :exec
INSERT INTO conversation_link (workspace_id, conversation_id, message_id, source_item_id, created_by) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (message_id) DO NOTHING;

-- name: ListConversationCards :many
-- For each message sent on as feedback: where it stands in the review queue, and the requests its evidence
-- supports, with their current status. This is read live, so the card in the conversation always shows the
-- status as it is now.
SELECT l.message_id, l.source_item_id, s.processing_state,
  (SELECT count(*) FROM proposal p WHERE p.workspace_id = l.workspace_id AND p.source_item_id = l.source_item_id AND p.state = 'suggested')::int AS waiting,
  r.id AS request_id, r.title AS request_title, st.name AS status_name, st.bucket AS status_bucket
FROM conversation_link l
JOIN source_item s ON s.workspace_id = l.workspace_id AND s.id = l.source_item_id
LEFT JOIN LATERAL (SELECT DISTINCT e.request_id FROM evidence e WHERE e.workspace_id = l.workspace_id AND e.source_item_id = l.source_item_id) ev ON true
LEFT JOIN request r ON r.workspace_id = l.workspace_id AND r.id = ev.request_id
LEFT JOIN status st ON st.workspace_id = r.workspace_id AND st.id = r.status_id
WHERE l.workspace_id = $1 AND l.conversation_id = $2
ORDER BY l.created_at, r.title;

-- name: FindPersonByEmail :one
SELECT id FROM person WHERE workspace_id = $1 AND lower(email) = $2 LIMIT 1;

-- name: ListConversationAttachments :many
SELECT id, message_id, name, content_type, size FROM conversation_attachment
WHERE workspace_id = $1 AND conversation_id = $2 AND message_id IS NOT NULL
ORDER BY created_at, id;

-- name: GetConversationAttachment :one
SELECT a.id, a.name, a.content_type, a.size, a.data, a.conversation_id, m.direction
FROM conversation_attachment a JOIN conversation_message m ON m.workspace_id = a.workspace_id AND m.id = a.message_id
WHERE a.workspace_id = $1 AND a.id = $2 AND a.message_id IS NOT NULL;
