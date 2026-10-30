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
-- The newest non-note message gives the row preview, whether the last word was
-- the customer's, and whether this person has seen it yet.
SELECT c.*,
       coalesce(left(l.body, 160), '')::text AS preview,
       coalesce(l.direction, '')::text AS last_direction,
       coalesce(l.seq, 0)::int AS last_seq,
       (coalesce(l.seq, 0) > coalesce(r.last_read_seq, 0))::boolean AS unread
FROM conversation c
LEFT JOIN LATERAL (
  SELECT m.body, m.direction, m.seq
  FROM conversation_message m
  WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.direction <> 'note'
  ORDER BY m.seq DESC
  LIMIT 1
) l ON true
LEFT JOIN conversation_read r ON r.workspace_id = c.workspace_id AND r.conversation_id = c.id AND r.user_id = sqlc.arg(me)::uuid
WHERE c.workspace_id = $1
  AND (sqlc.arg(state)::text = '' OR c.state = sqlc.arg(state))
  AND (sqlc.arg(mine)::boolean = false OR c.assignee = sqlc.arg(me)::uuid)
  AND (sqlc.arg(unassigned)::boolean = false OR c.assignee IS NULL)
  AND (sqlc.arg(channel)::text = '' OR c.channel = sqlc.arg(channel))
  AND (sqlc.narg(assignee_id)::uuid IS NULL OR c.assignee = sqlc.narg(assignee_id))
  AND (sqlc.narg(person_id)::uuid IS NULL OR c.person_id = sqlc.narg(person_id))
  AND (NOT sqlc.arg(unread_only)::boolean OR coalesce(l.seq, 0) > coalesce(r.last_read_seq, 0))
  AND (sqlc.arg(search)::text = ''
       OR c.customer_name ILIKE '%' || sqlc.arg(search)::text || '%'
       OR c.customer_email ILIKE '%' || sqlc.arg(search)::text || '%'
       OR c.subject ILIKE '%' || sqlc.arg(search)::text || '%'
       OR l.body ILIKE '%' || sqlc.arg(search)::text || '%')
  AND (sqlc.narg(after_at)::timestamptz IS NULL OR (c.last_message_at, c.id) < (sqlc.narg(after_at)::timestamptz, sqlc.narg(after_id)::uuid))
ORDER BY c.last_message_at DESC, c.id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: ConversationCounts :one
-- What the queue tabs show. Same filters as the list, so a number never
-- disagrees with the rows it labels.
WITH c AS (
  SELECT conv.state, conv.assignee,
         (coalesce(l.seq, 0) > coalesce(r.last_read_seq, 0)) AS unread
  FROM conversation conv
  LEFT JOIN LATERAL (
    SELECT m.seq FROM conversation_message m
    WHERE m.workspace_id = conv.workspace_id AND m.conversation_id = conv.id AND m.direction <> 'note'
    ORDER BY m.seq DESC LIMIT 1
  ) l ON true
  LEFT JOIN conversation_read r ON r.workspace_id = conv.workspace_id AND r.conversation_id = conv.id AND r.user_id = sqlc.arg(me)::uuid
  WHERE conv.workspace_id = sqlc.arg(workspace_id)::uuid
    AND (sqlc.arg(channel)::text = '' OR conv.channel = sqlc.arg(channel))
    AND (sqlc.narg(assignee_id)::uuid IS NULL OR conv.assignee = sqlc.narg(assignee_id))
)
SELECT
  count(*) FILTER (WHERE state = 'open')::int AS open,
  count(*) FILTER (WHERE state = 'open' AND assignee = sqlc.arg(me)::uuid)::int AS mine,
  count(*) FILTER (WHERE state = 'open' AND assignee IS NULL)::int AS unassigned,
  count(*) FILTER (WHERE state = 'closed')::int AS closed,
  count(*) FILTER (WHERE state = 'open' AND unread)::int AS unread
FROM c;

-- name: MarkConversationRead :exec
-- Remember how far this person has read, never moving backwards.
INSERT INTO conversation_read (workspace_id, conversation_id, user_id, last_read_seq)
SELECT sqlc.arg(workspace_id)::uuid, sqlc.arg(conversation_id)::uuid, sqlc.arg(user_id)::uuid, coalesce(max(m.seq), 0)
FROM conversation_message m
WHERE m.workspace_id = sqlc.arg(workspace_id)::uuid AND m.conversation_id = sqlc.arg(conversation_id)::uuid
ON CONFLICT (workspace_id, conversation_id, user_id) DO UPDATE
SET last_read_seq = GREATEST(conversation_read.last_read_seq, EXCLUDED.last_read_seq), updated_at = now();

-- name: BulkAssignConversations :execrows
UPDATE conversation SET assignee = sqlc.narg(assignee)::uuid
WHERE workspace_id = sqlc.arg(workspace_id)::uuid AND id = ANY (sqlc.arg(ids)::uuid[]) AND state = 'open'
  AND (sqlc.narg(owner)::uuid IS NULL OR assignee = sqlc.narg(owner)::uuid);

-- name: BulkSetConversationState :execrows
UPDATE conversation SET state = sqlc.arg(state)::text
WHERE workspace_id = sqlc.arg(workspace_id)::uuid AND id = ANY (sqlc.arg(ids)::uuid[]);

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
