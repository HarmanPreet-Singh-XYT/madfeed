-- +goose Up
-- Connections to other services (a chat workspace, an issue tracker). The credentials are sealed with
-- the server's SECRETS_KEY before they are stored; the readable part (which channel, which repository)
-- lives in config. `state` says plainly whether the connection works.
CREATE TABLE integration (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('slack', 'github')),
  state        text NOT NULL CHECK (state IN ('connected', 'needs_reconnect')),
  external_id  text CHECK (external_id IS NULL OR char_length(external_id) <= 200), -- a Slack team id
  config       jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(config) < 8000),
  secret       bytea NOT NULL,
  last_ok_at   timestamptz,
  last_error   text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 200),
  connected_by uuid NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, kind)
);
-- One workspace per Slack team: an event names a team, and must belong to exactly one workspace.
CREATE UNIQUE INDEX integration_slack_team_key ON integration (external_id) WHERE kind = 'slack' AND external_id IS NOT NULL;

ALTER TABLE integration ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON integration FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON integration FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- A chat event names a team, not a workspace. This finds the workspace and the chosen channel for a
-- connected team, and nothing else; the event itself is authenticated by the app's signature.
-- +goose StatementBegin
CREATE FUNCTION integration_for_slack_team(p_team text) RETURNS TABLE (workspace_id uuid, channel_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.workspace_id, coalesce(i.config ->> 'channelId', '') FROM integration i
  WHERE i.kind = 'slack' AND i.external_id = p_team AND i.state = 'connected'
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION integration_for_slack_team(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_for_slack_team(text) TO app_backend;

-- When Slack says the app was removed or its tokens revoked, mark that team's connection as needing a reconnect.
-- +goose StatementBegin
CREATE FUNCTION integration_slack_revoked(p_team text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE integration SET state = 'needs_reconnect', last_error = 'removed from Slack', updated_at = now()
    WHERE kind = 'slack' AND external_id = p_team AND state = 'connected';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION integration_slack_revoked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_slack_revoked(text) TO app_backend;

-- The worker checks every connection's health; it needs to list them across workspaces.
-- +goose StatementBegin
CREATE FUNCTION integrations_to_check() RETURNS TABLE (workspace_id uuid, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace_id, kind FROM integration WHERE state = 'connected' AND (last_ok_at IS NULL OR last_ok_at < now() - interval '1 hour')
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION integrations_to_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations_to_check() TO app_backend;

-- Messages from a chat channel (and, later, other connectors) become source items of their own kind, with
-- the outside id kept so the same message arriving twice is stored once.
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api', 'chat'));
ALTER TABLE source_item ADD COLUMN external_id text CHECK (external_id IS NULL OR char_length(external_id) <= 300);
CREATE UNIQUE INDEX source_item_external_key ON source_item (workspace_id, kind, external_id) WHERE external_id IS NOT NULL;

-- +goose Down
DROP INDEX source_item_external_key;
ALTER TABLE source_item DROP COLUMN external_id;
DELETE FROM source_item WHERE kind = 'chat';
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api'));
DROP FUNCTION integrations_to_check();
DROP FUNCTION integration_slack_revoked(text);
DROP FUNCTION integration_for_slack_team(text);
DROP TABLE integration;
