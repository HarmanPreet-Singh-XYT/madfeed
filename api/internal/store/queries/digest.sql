-- name: GetDigestSetting :one
SELECT * FROM digest_setting WHERE workspace_id = $1;

-- name: UpsertDigestSetting :exec
INSERT INTO digest_setting (workspace_id, enabled, weekday, hour_utc) VALUES ($1, $2, $3, $4)
ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, weekday = EXCLUDED.weekday, hour_utc = EXCLUDED.hour_utc, updated_at = now();

-- name: ListDigestRecipients :many
SELECT * FROM digest_recipient WHERE workspace_id = $1 ORDER BY email;

-- name: AddDigestRecipient :exec
INSERT INTO digest_recipient (workspace_id, email) VALUES ($1, $2) ON CONFLICT (workspace_id, email) DO NOTHING;

-- name: RemoveDigestRecipientsExcept :exec
DELETE FROM digest_recipient WHERE workspace_id = $1 AND NOT (email = ANY ($2::text[]));

-- name: GetDigestRecipient :one
SELECT * FROM digest_recipient WHERE workspace_id = $1 AND id = $2;

-- name: UnsubscribeDigestRecipient :execrows
UPDATE digest_recipient SET unsubscribed_at = coalesce(unsubscribed_at, now()) WHERE workspace_id = $1 AND id = $2;

-- name: ClaimDigestSend :one
-- Claims (week, person) for sending. Returns a row only if this caller may send: nothing exists yet, or an
-- earlier try failed (or died mid-send more than 15 minutes ago) and fewer than 3 tries were made.
INSERT INTO digest_send (workspace_id, period_start, recipient_id, state) VALUES ($1, $2, $3, 'sending')
ON CONFLICT (workspace_id, period_start, recipient_id) DO UPDATE
  SET state = 'sending', attempts = digest_send.attempts + 1, updated_at = now()
  WHERE digest_send.attempts < 3 AND (digest_send.state = 'failed' OR (digest_send.state = 'sending' AND digest_send.updated_at < now() - interval '15 minutes'))
RETURNING attempts;

-- name: FinishDigestSend :exec
UPDATE digest_send SET state = $4, provider_message_id = $5, updated_at = now() WHERE workspace_id = $1 AND period_start = $2 AND recipient_id = $3;

-- name: DigestCounts :one
SELECT
  (SELECT count(*) FROM source_item s WHERE s.workspace_id = sqlc.arg(ws)::uuid AND s.created_at >= sqlc.arg(since)::timestamptz)::int AS conversations,
  (SELECT count(*) FROM source_item s WHERE s.workspace_id = sqlc.arg(ws)::uuid AND s.created_at >= sqlc.arg(since)::timestamptz AND s.kind = 'form')::int AS form_submissions,
  (SELECT count(*) FROM request q WHERE q.workspace_id = sqlc.arg(ws)::uuid AND q.created_at >= sqlc.arg(since)::timestamptz)::int AS new_requests,
  (SELECT count(*) FROM proposal p WHERE p.workspace_id = sqlc.arg(ws)::uuid AND p.state = 'suggested')::int AS waiting_for_review,
  (SELECT count(*) FROM request_vote v WHERE v.workspace_id = sqlc.arg(ws)::uuid AND v.created_at >= sqlc.arg(since)::timestamptz)::int AS new_votes,
  (SELECT count(*) FROM outreach_message m WHERE m.workspace_id = sqlc.arg(ws)::uuid AND m.state = 'sent' AND m.sent_at >= sqlc.arg(since)::timestamptz)::int AS messages_sent;

-- name: DigestTopRequests :many
SELECT r.title, st.name AS status_name, i.evidence_count, i.people_count, i.total_value::float8 AS total_value
FROM request r JOIN request_impact i ON i.workspace_id = r.workspace_id AND i.request_id = r.id
JOIN status st ON st.workspace_id = r.workspace_id AND st.id = r.status_id
WHERE r.workspace_id = $1 AND st.bucket IN ('open', 'active')
ORDER BY i.total_value DESC, i.evidence_count DESC, r.id
LIMIT 5;

-- name: DigestNewRequests :many
SELECT title FROM request WHERE workspace_id = $1 AND created_at >= $2 ORDER BY created_at DESC, id LIMIT 5;

-- name: DigestShipped :many
SELECT DISTINCT r.title FROM outreach_batch b JOIN request r ON r.workspace_id = b.workspace_id AND r.id = b.request_id
WHERE b.workspace_id = $1 AND b.created_at >= $2 ORDER BY r.title LIMIT 5;
