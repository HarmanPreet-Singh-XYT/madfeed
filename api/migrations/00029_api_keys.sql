-- +goose Up
-- Read-only keys for integrations and AI assistants (the public API and the MCP server). A key
-- belongs to one workspace and can do nothing a viewer of that workspace could not. Only a hash of
-- the key is stored; the key itself is shown once, when it is made.
CREATE TABLE api_key (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  prefix       text NOT NULL CHECK (char_length(prefix) = 10), -- the start of the key, to recognise it in a list
  key_hash     text NOT NULL UNIQUE CHECK (char_length(key_hash) = 64),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  UNIQUE (workspace_id, id)
);
CREATE INDEX api_key_ws_idx ON api_key (workspace_id, created_at DESC);

ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_key USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON api_key FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_key TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON api_key FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- A request arrives with a key and no workspace, so the lookup has to cross workspaces. It returns
-- only the key's id and workspace, never revoked keys, and notes when the key was last used (at most
-- once every five minutes, so busy keys do not write on every request).
-- +goose StatementBegin
CREATE FUNCTION api_key_lookup(p_hash text) RETURNS TABLE (id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE api_key k SET last_used_at = now()
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.last_used_at IS NULL OR k.last_used_at < now() - interval '5 minutes');
  RETURN QUERY SELECT k.id, k.workspace_id FROM api_key k WHERE k.key_hash = p_hash AND k.revoked_at IS NULL;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO app_backend;

-- +goose Down
DROP FUNCTION api_key_lookup(text);
DROP TABLE api_key;
