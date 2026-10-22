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
SELECT p.id, p.name, p.email, p.account_id, a.name AS account_name
FROM person p LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
WHERE p.workspace_id = $1
  AND (lower(p.name), p.id) > (sqlc.arg(after_name)::text, sqlc.arg(after_id)::uuid)
ORDER BY lower(p.name), p.id
LIMIT sqlc.arg(page_size)::int;

-- name: CreateAccount :one
INSERT INTO account (workspace_id, name, domain, revenue, plan, renewal_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdateAccount :execrows
UPDATE account SET name = $3, domain = $4, revenue = $5, plan = $6, renewal_date = $7, updated_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: GetAccount :one
SELECT * FROM account WHERE workspace_id = $1 AND id = $2;

-- name: ListAccounts :many
SELECT a.id, a.name, a.domain, a.revenue, a.plan, a.renewal_date,
       (SELECT count(*) FROM person p WHERE p.workspace_id = a.workspace_id AND p.account_id = a.id)::int AS people_count
FROM account a
WHERE a.workspace_id = $1
  AND (lower(a.name), a.id) > (sqlc.arg(after_name)::text, sqlc.arg(after_id)::uuid)
ORDER BY lower(a.name), a.id
LIMIT sqlc.arg(page_size)::int;
