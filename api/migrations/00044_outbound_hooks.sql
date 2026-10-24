-- +goose Up
-- Outbound webhooks: an admin gives a web address and picks events; each event becomes a signed message sent to
-- it. An event is written into the delivery table in the same transaction as the change that caused it, so a
-- delivery exists if and only if the change was committed (a transactional outbox). A background loop sends them.

CREATE TABLE outbound_endpoint (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  url                  text NOT NULL CHECK (char_length(url) BETWEEN 12 AND 2000),
  description          text NOT NULL DEFAULT '' CHECK (char_length(description) <= 200),
  events               text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 20),
  secret               bytea NOT NULL,                -- sealed signing secret; shown to the admin once
  enabled              boolean NOT NULL DEFAULT true,
  paused_reason        text NOT NULL DEFAULT '',
  consecutive_failures int NOT NULL DEFAULT 0,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX outbound_endpoint_ws_idx ON outbound_endpoint (workspace_id, created_at);

CREATE TABLE outbound_delivery (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  endpoint_id     uuid NOT NULL,
  event_id        uuid NOT NULL,                      -- the same for every endpoint and every retry, so receivers can drop duplicates
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status     int,
  last_error      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  FOREIGN KEY (workspace_id, endpoint_id) REFERENCES outbound_endpoint (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX outbound_delivery_due_idx ON outbound_delivery (next_attempt_at) WHERE state = 'pending';
CREATE INDEX outbound_delivery_endpoint_idx ON outbound_delivery (workspace_id, endpoint_id, created_at DESC);

ALTER TABLE outbound_endpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_endpoint FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbound_endpoint USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON outbound_endpoint FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_endpoint TO app_backend;

ALTER TABLE outbound_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbound_delivery USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON outbound_delivery FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_delivery TO app_backend;

-- The sender runs outside any workspace. It may claim due deliveries (pushing their next attempt two minutes out
-- so a second process skips them and a crash is retried) and learn only the ids it needs to open each one inside
-- its own workspace. It may also delete old finished rows.
-- +goose StatementBegin
CREATE FUNCTION outbound_claim_due(max_rows int) RETURNS TABLE (id uuid, workspace_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE outbound_delivery d SET next_attempt_at = now() + interval '2 minutes'
  WHERE d.id IN (
    SELECT x.id FROM outbound_delivery x
    WHERE x.state = 'pending' AND x.next_attempt_at <= now()
    ORDER BY x.next_attempt_at LIMIT least(max_rows, 200) FOR UPDATE SKIP LOCKED)
  RETURNING d.id, d.workspace_id
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION outbound_claim_due(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbound_claim_due(int) TO app_backend;

-- +goose StatementBegin
CREATE FUNCTION outbound_purge() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH gone AS (DELETE FROM outbound_delivery WHERE state <> 'pending' AND created_at < now() - interval '30 days' RETURNING 1)
  SELECT count(*) FROM gone
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION outbound_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbound_purge() TO app_backend;

-- +goose Down
DROP FUNCTION outbound_purge();
DROP FUNCTION outbound_claim_due(int);
DROP TABLE outbound_delivery;
DROP TABLE outbound_endpoint;
