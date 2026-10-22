-- +goose Up

-- Impact of a request: how many people and accounts asked, and the value of
-- those accounts. Maintained by triggers so no code path can forget to update
-- it, and checked against a brute-force calculation in tests.
CREATE TABLE request_impact (
  workspace_id       uuid NOT NULL,
  request_id         uuid NOT NULL PRIMARY KEY,
  evidence_count     int NOT NULL DEFAULT 0,
  people_count       int NOT NULL DEFAULT 0,        -- distinct people with a known identity
  account_count      int NOT NULL DEFAULT 0,        -- distinct accounts of those people
  total_value        numeric(16, 2) NOT NULL DEFAULT 0, -- sum over DISTINCT accounts, never per quote
  accounts_with_value int NOT NULL DEFAULT 0,
  newest_evidence_at timestamptz,
  UNIQUE (workspace_id, request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX request_impact_value_idx ON request_impact (workspace_id, total_value DESC, request_id DESC);

ALTER TABLE request_impact ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_impact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request_impact USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- +goose StatementBegin
CREATE FUNCTION recompute_request_impact(p_ws uuid, p_requests uuid[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO request_impact (workspace_id, request_id, evidence_count, people_count, account_count, total_value, accounts_with_value, newest_evidence_at)
  SELECT r.workspace_id, r.id,
         coalesce(ec.n, 0), coalesce(pc.n, 0), coalesce(ac.n, 0), coalesce(ac.total, 0), coalesce(ac.with_value, 0), ec.newest
  FROM request r
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n, max(e.created_at) AS newest
    FROM evidence e WHERE e.workspace_id = r.workspace_id AND e.request_id = r.id) ec ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT e.person_id)::int AS n
    FROM evidence e WHERE e.workspace_id = r.workspace_id AND e.request_id = r.id AND e.person_id IS NOT NULL) pc ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n, coalesce(sum(a.revenue), 0) AS total, count(a.revenue)::int AS with_value
    FROM (SELECT DISTINCT p.account_id
          FROM evidence e JOIN person p ON p.workspace_id = e.workspace_id AND p.id = e.person_id
          WHERE e.workspace_id = r.workspace_id AND e.request_id = r.id AND p.account_id IS NOT NULL) da
    JOIN account a ON a.workspace_id = r.workspace_id AND a.id = da.account_id) ac ON true
  WHERE r.workspace_id = p_ws AND r.id = ANY (p_requests)
  ON CONFLICT (request_id) DO UPDATE SET
    evidence_count = EXCLUDED.evidence_count, people_count = EXCLUDED.people_count, account_count = EXCLUDED.account_count,
    total_value = EXCLUDED.total_value, accounts_with_value = EXCLUDED.accounts_with_value, newest_evidence_at = EXCLUDED.newest_evidence_at;
$$;
-- +goose StatementEnd

-- A new request starts with an all-zero row.
-- +goose StatementBegin
CREATE FUNCTION impact_on_request_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_request_impact(w, ids) FROM (SELECT workspace_id AS w, array_agg(id) AS ids FROM new_rows GROUP BY workspace_id) g;
  RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER request_impact_insert AFTER INSERT ON request
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION impact_on_request_insert();

-- Evidence added, removed or moved between requests.
-- +goose StatementBegin
CREATE FUNCTION impact_on_evidence_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_request_impact(w, ids) FROM (SELECT workspace_id AS w, array_agg(DISTINCT request_id) AS ids FROM new_rows GROUP BY workspace_id) g;
  RETURN NULL;
END $$;
CREATE FUNCTION impact_on_evidence_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_request_impact(w, ids) FROM (SELECT workspace_id AS w, array_agg(DISTINCT request_id) AS ids FROM old_rows GROUP BY workspace_id) g;
  RETURN NULL;
END $$;
CREATE FUNCTION impact_on_evidence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_request_impact(w, ids) FROM (
    SELECT workspace_id AS w, array_agg(DISTINCT request_id) AS ids FROM (
      SELECT workspace_id, request_id FROM new_rows UNION SELECT workspace_id, request_id FROM old_rows) u GROUP BY workspace_id) g;
  RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER evidence_impact_insert AFTER INSERT ON evidence REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION impact_on_evidence_insert();
CREATE TRIGGER evidence_impact_delete AFTER DELETE ON evidence REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION impact_on_evidence_delete();
CREATE TRIGGER evidence_impact_update AFTER UPDATE ON evidence REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION impact_on_evidence_update();

-- A person moved to another account changes every request they are evidence on.
-- +goose StatementBegin
CREATE FUNCTION impact_on_person_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_request_impact(g.w, g.ids) FROM (
    SELECT e.workspace_id AS w, array_agg(DISTINCT e.request_id) AS ids
    FROM new_rows n JOIN old_rows o ON o.id = n.id AND o.account_id IS DISTINCT FROM n.account_id
    JOIN evidence e ON e.workspace_id = n.workspace_id AND e.person_id = n.id
    GROUP BY e.workspace_id) g;
  RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER person_impact_update AFTER UPDATE ON person REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION impact_on_person_update();

-- An account's value changed: every request asked by its people changes.
-- +goose StatementBegin
CREATE FUNCTION impact_on_account_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_request_impact(g.w, g.ids) FROM (
    SELECT e.workspace_id AS w, array_agg(DISTINCT e.request_id) AS ids
    FROM new_rows n JOIN old_rows o ON o.id = n.id AND o.revenue IS DISTINCT FROM n.revenue
    JOIN person p ON p.workspace_id = n.workspace_id AND p.account_id = n.id
    JOIN evidence e ON e.workspace_id = n.workspace_id AND e.person_id = p.id
    GROUP BY e.workspace_id) g;
  RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER account_impact_update AFTER UPDATE ON account REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION impact_on_account_update();

-- Rows for requests that already exist.
SELECT recompute_request_impact(workspace_id, array_agg(id)) FROM request GROUP BY workspace_id;

-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON request_impact FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION recompute_request_impact(uuid, uuid[]) FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON request_impact FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON request_impact TO app_backend;
REVOKE EXECUTE ON FUNCTION recompute_request_impact(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recompute_request_impact(uuid, uuid[]) TO app_backend;

-- +goose Down
DROP TRIGGER account_impact_update ON account;
DROP TRIGGER person_impact_update ON person;
DROP TRIGGER evidence_impact_update ON evidence;
DROP TRIGGER evidence_impact_delete ON evidence;
DROP TRIGGER evidence_impact_insert ON evidence;
DROP TRIGGER request_impact_insert ON request;
DROP FUNCTION impact_on_account_update();
DROP FUNCTION impact_on_person_update();
DROP FUNCTION impact_on_evidence_update();
DROP FUNCTION impact_on_evidence_delete();
DROP FUNCTION impact_on_evidence_insert();
DROP FUNCTION impact_on_request_insert();
DROP FUNCTION recompute_request_impact(uuid, uuid[]);
DROP TABLE request_impact;
