-- +goose Up
-- Sign-in for remote assistants (the MCP "connector" flow, OAuth 2.1 with PKCE). An assistant registers
-- itself, a workspace admin approves it, and it receives a short-lived access token (an ordinary API key that
-- expires in an hour) and a refresh token that is replaced each time it is used.

-- Assistants that registered themselves. Public information; no workspace data.
CREATE TABLE oauth_client (
  client_id     text PRIMARY KEY CHECK (char_length(client_id) BETWEEN 20 AND 64),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  created_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON oauth_client FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON oauth_client TO app_backend;

-- What an admin has approved: one row per assistant connected to a workspace.
CREATE TABLE oauth_grant (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  client_id             text NOT NULL REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  client_name           text NOT NULL CHECK (char_length(client_name) <= 80),
  approved_by           uuid NOT NULL,
  scopes                text[] NOT NULL CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['requests', 'quotes', 'ask', 'submit']::text[]),
  refresh_hash          text NOT NULL UNIQUE CHECK (char_length(refresh_hash) = 64),
  previous_refresh_hash text CHECK (previous_refresh_hash IS NULL OR char_length(previous_refresh_hash) = 64),
  refresh_expires_at    timestamptz NOT NULL,
  key_id                uuid,                -- the access token currently in force
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz,
  revoked_at            timestamptz,
  UNIQUE (workspace_id, id)
);
CREATE INDEX oauth_grant_ws_idx ON oauth_grant (workspace_id, created_at DESC);
CREATE UNIQUE INDEX oauth_grant_previous_key ON oauth_grant (previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;

-- One-time codes handed to the assistant's return address. Only a hash is stored; taking one deletes it.
CREATE TABLE oauth_code (
  code_hash      text PRIMARY KEY CHECK (char_length(code_hash) = 64),
  workspace_id   uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  client_id      text NOT NULL REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  scopes         text[] NOT NULL,
  redirect_uri   text NOT NULL CHECK (char_length(redirect_uri) <= 500),
  code_challenge text NOT NULL CHECK (char_length(code_challenge) = 43),
  expires_at     timestamptz NOT NULL
);

-- Access tokens made through this flow are hidden from the ordinary key list and do not count against a plan's key limit.
ALTER TABLE api_key ADD COLUMN oauth_grant_id uuid;
CREATE INDEX api_key_oauth_idx ON api_key (oauth_grant_id) WHERE oauth_grant_id IS NOT NULL;

ALTER TABLE oauth_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_code FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON oauth_grant USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON oauth_code USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON oauth_grant, oauth_code FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_grant, oauth_code TO app_backend;

-- The token address is called by the assistant, with no workspace in hand. These two functions find the row the
-- assistant's secret opens, and nothing else.
-- +goose StatementBegin
CREATE FUNCTION oauth_take_code(p_hash text)
RETURNS TABLE (workspace_id uuid, client_id text, user_id uuid, scopes text[], redirect_uri text, code_challenge text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY DELETE FROM oauth_code c WHERE c.code_hash = p_hash AND c.expires_at > now()
    RETURNING c.workspace_id, c.client_id, c.user_id, c.scopes, c.redirect_uri, c.code_challenge;
  DELETE FROM oauth_code WHERE expires_at < now() - interval '1 hour';
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION oauth_take_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oauth_take_code(text) TO app_backend;

-- +goose StatementBegin
CREATE FUNCTION oauth_grant_for_refresh(p_hash text)
RETURNS TABLE (grant_id uuid, workspace_id uuid, client_id text, which text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.id, g.workspace_id, g.client_id, CASE WHEN g.refresh_hash = p_hash THEN 'current' ELSE 'previous' END
  FROM oauth_grant g WHERE g.refresh_hash = p_hash OR g.previous_refresh_hash = p_hash
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION oauth_grant_for_refresh(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oauth_grant_for_refresh(text) TO app_backend;

-- +goose Down
DROP FUNCTION oauth_grant_for_refresh(text);
DROP FUNCTION oauth_take_code(text);
DROP INDEX api_key_oauth_idx;
ALTER TABLE api_key DROP COLUMN oauth_grant_id;
DROP TABLE oauth_code;
DROP TABLE oauth_grant;
DROP TABLE oauth_client;
