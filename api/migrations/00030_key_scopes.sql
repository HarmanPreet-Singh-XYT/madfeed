-- +goose Up
-- Narrower keys. Each key now has scopes (what it may do), an optional expiry, an optional list of
-- network addresses it may be used from, and a short log of what it did. Keys made before this change
-- keep exactly what they could do (read requests, quotes, ask) with no expiry and no address limit.
ALTER TABLE api_key ADD COLUMN scopes text[] NOT NULL DEFAULT '{requests,quotes,ask}'
  CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['requests', 'quotes', 'ask', 'submit']::text[]);
ALTER TABLE api_key ADD COLUMN expires_at timestamptz;
ALTER TABLE api_key ADD COLUMN allowed_cidrs text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_cidrs) <= 10);

CREATE TABLE api_key_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  key_id       uuid NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  action       text NOT NULL CHECK (action IN ('list', 'get', 'ask', 'submit')),
  detail       text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 200),
  ok           boolean NOT NULL,
  FOREIGN KEY (workspace_id, key_id) REFERENCES api_key (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX api_key_event_idx ON api_key_event (workspace_id, key_id, at DESC);
ALTER TABLE api_key_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_key_event USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON api_key_event FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_key_event TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON api_key_event FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- Keys can add notes to the review queue (kind 'api'): unreviewed, like a form submission.
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api'));

-- The lookup now also returns what the key may do, where from, and its name; expired keys are not found.
DROP FUNCTION api_key_lookup(text);
-- +goose StatementBegin
CREATE FUNCTION api_key_lookup(p_hash text) RETURNS TABLE (id uuid, workspace_id uuid, name text, scopes text[], allowed_cidrs text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE api_key k SET last_used_at = now()
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
      AND (k.last_used_at IS NULL OR k.last_used_at < now() - interval '5 minutes');
  RETURN QUERY SELECT k.id, k.workspace_id, k.name, k.scopes, k.allowed_cidrs FROM api_key k
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO app_backend;

-- +goose Down
DROP FUNCTION api_key_lookup(text);
DELETE FROM source_item WHERE kind = 'api';
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form'));
DROP TABLE api_key_event;
ALTER TABLE api_key DROP COLUMN allowed_cidrs;
ALTER TABLE api_key DROP COLUMN expires_at;
ALTER TABLE api_key DROP COLUMN scopes;
