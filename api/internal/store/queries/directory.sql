-- name: UpsertAccountByName :one
INSERT INTO account (workspace_id, name, domain, revenue, plan, renewal_date)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (workspace_id, lower(name)) DO UPDATE SET
  domain       = coalesce(EXCLUDED.domain, account.domain),
  revenue      = coalesce(EXCLUDED.revenue, account.revenue),
  plan         = coalesce(EXCLUDED.plan, account.plan),
  renewal_date = coalesce(EXCLUDED.renewal_date, account.renewal_date),
  updated_at   = now()
RETURNING id, (xmax = 0) AS inserted;

-- name: UpsertPersonByEmail :one
INSERT INTO person (workspace_id, name, email, account_id) VALUES ($1, $2, $3, $4)
ON CONFLICT (workspace_id, lower(email)) WHERE email IS NOT NULL DO UPDATE SET
  name       = EXCLUDED.name,
  account_id = coalesce(EXCLUDED.account_id, person.account_id)
RETURNING id, (xmax = 0) AS inserted;

-- name: FindPersonByNameAndAccount :one
SELECT id FROM person
WHERE workspace_id = $1 AND lower(name) = lower($2) AND email IS NULL
  AND account_id IS NOT DISTINCT FROM $3
LIMIT 1;

-- name: InsertPerson :one
INSERT INTO person (workspace_id, name, email, account_id) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdatePerson :execrows
UPDATE person SET name = $3, email = $4, account_id = $5 WHERE workspace_id = $1 AND id = $2;

-- name: GetPerson :one
SELECT * FROM person WHERE workspace_id = $1 AND id = $2;

-- name: ListPeople :many
SELECT p.id, p.name, p.email, p.account_id, a.name AS account_name, p.created_at,
       act.quote_count, act.last_heard,
       EXISTS (
         SELECT 1 FROM person p2
         WHERE p2.workspace_id = p.workspace_id AND p2.id <> p.id
           AND lower(btrim(p2.name)) = lower(btrim(p.name))
       ) AS similar_name
FROM person p
LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
LEFT JOIN LATERAL (
  SELECT
    (SELECT count(*)::int FROM (
      SELECT 1 FROM evidence e JOIN source_item s ON s.workspace_id = e.workspace_id AND s.id = e.source_item_id
      WHERE s.workspace_id = p.workspace_id AND s.person_id = p.id
      UNION ALL
      SELECT 1 FROM highlight h JOIN source_item s ON s.workspace_id = h.workspace_id AND s.id = h.source_item_id
      WHERE s.workspace_id = p.workspace_id AND s.person_id = p.id
    ) c) AS quote_count,
    coalesce((SELECT q.at FROM (
      SELECT e.created_at AS at FROM evidence e JOIN source_item s ON s.workspace_id = e.workspace_id AND s.id = e.source_item_id
      WHERE s.workspace_id = p.workspace_id AND s.person_id = p.id
      UNION ALL
      SELECT h.created_at FROM highlight h JOIN source_item s ON s.workspace_id = h.workspace_id AND s.id = h.source_item_id
      WHERE s.workspace_id = p.workspace_id AND s.person_id = p.id
    ) q ORDER BY q.at DESC LIMIT 1), '0001-01-01'::timestamptz)::timestamptz AS last_heard
) act ON true
WHERE p.workspace_id = $1
  AND (sqlc.arg(q)::text = ''
       OR lower(p.name) LIKE '%' || lower(sqlc.arg(q)::text) || '%'
       OR lower(coalesce(p.email, '')) LIKE '%' || lower(sqlc.arg(q)::text) || '%')
  AND (sqlc.narg(account_id)::uuid IS NULL OR p.account_id = sqlc.narg(account_id))
  AND (sqlc.arg(email_state)::text = ''
       OR (sqlc.arg(email_state)::text = 'with' AND p.email IS NOT NULL)
       OR (sqlc.arg(email_state)::text = 'without' AND p.email IS NULL))
  AND (lower(p.name), p.id) > (sqlc.arg(after_name)::text, sqlc.arg(after_id)::uuid)
ORDER BY lower(p.name), p.id
LIMIT sqlc.arg(page_size)::int;

-- name: CountPeople :one
SELECT count(*)::int FROM person p
WHERE p.workspace_id = $1
  AND (sqlc.arg(q)::text = ''
       OR lower(p.name) LIKE '%' || lower(sqlc.arg(q)::text) || '%'
       OR lower(coalesce(p.email, '')) LIKE '%' || lower(sqlc.arg(q)::text) || '%')
  AND (sqlc.narg(account_id)::uuid IS NULL OR p.account_id = sqlc.narg(account_id))
  AND (sqlc.arg(email_state)::text = ''
       OR (sqlc.arg(email_state)::text = 'with' AND p.email IS NOT NULL)
       OR (sqlc.arg(email_state)::text = 'without' AND p.email IS NULL));

-- name: PersonStats :one
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE email IS NOT NULL)::int AS with_email,
       count(*) FILTER (WHERE email IS NULL)::int AS without_email
FROM person WHERE workspace_id = $1;

-- name: CreateAccount :one
INSERT INTO account (workspace_id, name, domain, revenue, plan, renewal_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdateAccount :execrows
UPDATE account SET name = $3, domain = $4, revenue = $5, plan = $6, renewal_date = $7, updated_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: GetAccount :one
SELECT * FROM account WHERE workspace_id = $1 AND id = $2;

-- name: CountAccounts :one
SELECT count(*)::int FROM account a
WHERE a.workspace_id = $1
  AND (sqlc.arg(q)::text = '' OR lower(a.name) LIKE '%' || lower(sqlc.arg(q)::text) || '%');

-- name: ListAccounts :many
SELECT a.id, a.name, a.domain, a.revenue, a.plan, a.renewal_date, a.research,
       (SELECT count(*) FROM person p WHERE p.workspace_id = a.workspace_id AND p.account_id = a.id)::int AS people_count
FROM account a
WHERE a.workspace_id = $1
  AND (sqlc.arg(q)::text = '' OR lower(a.name) LIKE '%' || lower(sqlc.arg(q)::text) || '%')
  AND (lower(a.name), a.id) > (sqlc.arg(after_name)::text, sqlc.arg(after_id)::uuid)
ORDER BY lower(a.name), a.id
LIMIT sqlc.arg(page_size)::int;

-- ---- merging two people who are the same person

-- name: LockPerson :one
SELECT id FROM person WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: MergePersonProfile :exec
-- The surviving person keeps their own name; an email or company they are missing is filled from the other.
UPDATE person
SET email = coalesce(email, sqlc.narg(fill_email)::text),
    account_id = coalesce(account_id, sqlc.narg(fill_account)::uuid)
WHERE workspace_id = $1 AND id = $2;

-- name: OutreachMergeConflicts :one
-- Both people were told about the same request: merging would have to drop one send record.
SELECT count(*)::int
FROM outreach_message s
JOIN outreach_message t
  ON t.workspace_id = s.workspace_id AND t.request_id = s.request_id AND t.person_id = sqlc.arg(target_id)::uuid
WHERE s.workspace_id = sqlc.arg(workspace_id)::uuid AND s.person_id = sqlc.arg(source_id)::uuid;

-- name: DropDuplicateVotes :exec
DELETE FROM request_vote v
WHERE v.workspace_id = $1 AND v.person_id = $2
  AND EXISTS (SELECT 1 FROM request_vote t WHERE t.workspace_id = $1 AND t.person_id = $3 AND t.request_id = v.request_id);

-- name: MergeVotes :exec
UPDATE request_vote SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: DropDuplicateSurveyInvites :exec
DELETE FROM survey_invite s
WHERE s.workspace_id = $1 AND s.person_id = $2
  AND EXISTS (SELECT 1 FROM survey_invite t WHERE t.workspace_id = $1 AND t.person_id = $3 AND t.survey_id = s.survey_id);

-- name: MergeSurveyInvites :exec
UPDATE survey_invite SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeSurveyResponses :exec
UPDATE survey_response SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeMedia :exec
UPDATE media SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeConversations :exec
UPDATE conversation SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeQuoteViews :exec
UPDATE quote_view SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeOutreach :exec
UPDATE outreach_message SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeSourceItems :exec
UPDATE source_item SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: MergeEvidence :exec
UPDATE evidence SET person_id = $3 WHERE workspace_id = $1 AND person_id = $2;

-- name: DeleteMergedPerson :execrows
DELETE FROM person WHERE workspace_id = $1 AND id = $2;

-- ---- merging two companies that are the same company

-- name: LockAccount :one
SELECT id FROM account WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: MergeAccountProfile :exec
-- The surviving company keeps its own name and any value it already has; missing details come from the other.
UPDATE account
SET domain = coalesce(domain, sqlc.narg(fill_domain)::text),
    revenue = coalesce(revenue, sqlc.narg(fill_revenue)::numeric),
    plan = coalesce(plan, sqlc.narg(fill_plan)::text),
    renewal_date = coalesce(renewal_date, sqlc.narg(fill_renewal)::date),
    updated_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: MergeAccountPeople :exec
UPDATE person SET account_id = $3 WHERE workspace_id = $1 AND account_id = $2;

-- name: MergeAccountQuoteViews :exec
UPDATE quote_view SET account_id = $3 WHERE workspace_id = $1 AND account_id = $2;

-- name: DeleteMergedAccount :execrows
DELETE FROM account WHERE workspace_id = $1 AND id = $2;

-- name: SetAccountResearch :execrows
UPDATE account SET research = $3::jsonb, updated_at = now() WHERE workspace_id = $1 AND id = $2;
