-- name: OverviewCounts :one
SELECT
  (SELECT count(*) FROM request r JOIN status s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
    WHERE r.workspace_id = $1 AND s.bucket IN ('open', 'active'))::int AS open_requests,
  (SELECT count(*) FROM request r JOIN status s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
    WHERE r.workspace_id = $1 AND s.bucket = 'done')::int AS shipped_requests,
  (SELECT count(*) FROM person WHERE workspace_id = $1)::int AS people,
  (SELECT count(*) FROM account WHERE workspace_id = $1)::int AS accounts,
  ((SELECT count(*) FROM evidence WHERE workspace_id = $1)
    + (SELECT count(*) FROM highlight WHERE workspace_id = $1))::int AS quotes,
  (SELECT count(*) FROM proposal WHERE workspace_id = $1 AND state = 'suggested')::int AS suggestions_waiting,
  (SELECT count(*) FROM outreach_message m
    JOIN outreach_batch b ON b.workspace_id = m.workspace_id AND b.id = m.batch_id
    WHERE m.workspace_id = $1 AND b.state = 'review' AND m.state = 'draft')::int AS messages_waiting,
  (SELECT count(*) FROM finding_doc WHERE workspace_id = $1 AND deleted_at IS NULL)::int AS findings,
  (SELECT count(*) FROM survey WHERE workspace_id = $1 AND state = 'open')::int AS surveys_open,
  (SELECT count(*) FROM release_note WHERE workspace_id = $1 AND state = 'published')::int AS releases_published,
  (SELECT count(*) FROM request WHERE workspace_id = $1 AND created_at >= now() - interval '7 days')::int AS requests_last_7d,
  ((SELECT count(*) FROM evidence WHERE workspace_id = $1 AND created_at >= now() - interval '7 days')
    + (SELECT count(*) FROM highlight WHERE workspace_id = $1 AND created_at >= now() - interval '7 days'))::int AS quotes_last_7d,
  (SELECT count(*) FROM person WHERE workspace_id = $1 AND created_at >= now() - interval '7 days')::int AS people_last_7d;

-- name: OverviewActivity :many
SELECT kind, id, parent_id, parent_kind, title, detail, at
FROM (
  (SELECT 'request'::text AS kind, r.id, NULL::uuid AS parent_id, NULL::text AS parent_kind,
          r.title AS title, s.name AS detail, r.created_at AS at
   FROM request r JOIN status s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
   WHERE r.workspace_id = $1
   ORDER BY r.created_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'quote', e.id, e.request_id, 'request', left(e.quote_text, 160), r.title, e.created_at
   FROM evidence e JOIN request r ON r.workspace_id = e.workspace_id AND r.id = e.request_id
   WHERE e.workspace_id = $1
   ORDER BY e.created_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'quote', h.id, h.source_item_id, 'source', left(h.quote_text, 160), si.title, h.created_at
   FROM highlight h JOIN source_item si ON si.workspace_id = h.workspace_id AND si.id = h.source_item_id
   WHERE h.workspace_id = $1
   ORDER BY h.created_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'message', m.id, m.batch_id, 'batch', coalesce(nullif(m.subject, ''), 'Message'), coalesce(p.name, ''), m.sent_at
   FROM outreach_message m
   JOIN outreach_batch b ON b.workspace_id = m.workspace_id AND b.id = m.batch_id
   LEFT JOIN person p ON p.workspace_id = m.workspace_id AND p.id = m.person_id
   WHERE m.workspace_id = $1 AND m.state = 'sent' AND m.sent_at IS NOT NULL
   ORDER BY m.sent_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'conversation', c.id, NULL, NULL, coalesce(nullif(c.subject, ''), 'Conversation'), c.channel, c.last_message_at
   FROM conversation c WHERE c.workspace_id = $1
   ORDER BY c.last_message_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'finding', f.id, NULL, NULL, f.title, 'Published', f.published_at
   FROM finding_doc f
   WHERE f.workspace_id = $1 AND f.state = 'published' AND f.deleted_at IS NULL AND f.published_at IS NOT NULL
   ORDER BY f.published_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'release', n.id, NULL, NULL, n.title, 'Published', n.published_at
   FROM release_note n
   WHERE n.workspace_id = $1 AND n.state = 'published' AND n.published_at IS NOT NULL
   ORDER BY n.published_at DESC LIMIT 12)
  UNION ALL
  (SELECT 'survey', sv.id, NULL, NULL, sv.title, 'Opened', sv.created_at
   FROM survey sv WHERE sv.workspace_id = $1 AND sv.state <> 'draft'
   ORDER BY sv.created_at DESC LIMIT 12)
) a
ORDER BY at DESC, id DESC
LIMIT sqlc.arg(row_limit)::int;

-- name: OverviewSeries :many
WITH days AS (
  SELECT generate_series(
    (current_date - (sqlc.arg(window_days)::int - 1) * interval '1 day')::date,
    current_date::date,
    interval '1 day'
  )::date AS day
)
SELECT d.day,
  (SELECT count(*) FROM request r
    WHERE r.workspace_id = $1 AND (r.created_at AT TIME ZONE 'UTC')::date = d.day)::int AS requests,
  ((SELECT count(*) FROM evidence e
     WHERE e.workspace_id = $1 AND (e.created_at AT TIME ZONE 'UTC')::date = d.day)
   + (SELECT count(*) FROM highlight h
     WHERE h.workspace_id = $1 AND (h.created_at AT TIME ZONE 'UTC')::date = d.day))::int AS quotes,
  (SELECT count(*) FROM outreach_message m
    WHERE m.workspace_id = $1 AND m.state = 'sent' AND m.sent_at IS NOT NULL
      AND (m.sent_at AT TIME ZONE 'UTC')::date = d.day)::int AS messages
FROM days d
ORDER BY d.day;

-- name: WorkspaceActivity :many
SELECT kind, id, parent_id, parent_kind, title, detail, at
FROM (
  (SELECT 'request'::text AS kind, r.id, NULL::uuid AS parent_id, NULL::text AS parent_kind,
          r.title AS title, s.name AS detail, r.created_at AS at
   FROM request r JOIN status s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
   WHERE r.workspace_id = $1
     AND (NOT sqlc.arg(has_cursor)::bool OR (r.created_at, r.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY r.created_at DESC, r.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'quote', e.id, e.request_id, 'request', left(e.quote_text, 160), r.title, e.created_at
   FROM evidence e JOIN request r ON r.workspace_id = e.workspace_id AND r.id = e.request_id
   WHERE e.workspace_id = $1
     AND (NOT sqlc.arg(has_cursor)::bool OR (e.created_at, e.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY e.created_at DESC, e.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'quote', h.id, h.source_item_id, 'source', left(h.quote_text, 160), si.title, h.created_at
   FROM highlight h JOIN source_item si ON si.workspace_id = h.workspace_id AND si.id = h.source_item_id
   WHERE h.workspace_id = $1
     AND (NOT sqlc.arg(has_cursor)::bool OR (h.created_at, h.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY h.created_at DESC, h.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'message', m.id, m.batch_id, 'batch', coalesce(nullif(m.subject, ''), 'Message'), coalesce(p.name, ''), m.sent_at
   FROM outreach_message m
   JOIN outreach_batch b ON b.workspace_id = m.workspace_id AND b.id = m.batch_id
   LEFT JOIN person p ON p.workspace_id = m.workspace_id AND p.id = m.person_id
   WHERE m.workspace_id = $1 AND m.state = 'sent' AND m.sent_at IS NOT NULL
     AND (NOT sqlc.arg(has_cursor)::bool OR (m.sent_at, m.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY m.sent_at DESC, m.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'conversation', c.id, NULL, NULL, coalesce(nullif(c.subject, ''), 'Conversation'), c.channel, c.last_message_at
   FROM conversation c WHERE c.workspace_id = $1
     AND (NOT sqlc.arg(has_cursor)::bool OR (c.last_message_at, c.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY c.last_message_at DESC, c.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'finding', f.id, NULL, NULL, f.title, 'Published', f.published_at
   FROM finding_doc f
   WHERE f.workspace_id = $1 AND f.state = 'published' AND f.deleted_at IS NULL AND f.published_at IS NOT NULL
     AND (NOT sqlc.arg(has_cursor)::bool OR (f.published_at, f.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY f.published_at DESC, f.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'release', n.id, NULL, NULL, n.title, 'Published', n.published_at
   FROM release_note n
   WHERE n.workspace_id = $1 AND n.state = 'published' AND n.published_at IS NOT NULL
     AND (NOT sqlc.arg(has_cursor)::bool OR (n.published_at, n.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY n.published_at DESC, n.id DESC LIMIT sqlc.arg(page_size)::int)
  UNION ALL
  (SELECT 'survey', sv.id, NULL, NULL, sv.title, 'Opened', sv.created_at
   FROM survey sv WHERE sv.workspace_id = $1 AND sv.state <> 'draft'
     AND (NOT sqlc.arg(has_cursor)::bool OR (sv.created_at, sv.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid))
   ORDER BY sv.created_at DESC, sv.id DESC LIMIT sqlc.arg(page_size)::int)
) a
WHERE (sqlc.arg(kind)::text = '' OR kind = sqlc.arg(kind)::text)
ORDER BY at DESC, id DESC
LIMIT sqlc.arg(row_limit)::int;
