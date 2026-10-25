-- +goose Up
-- Inviting teammates. An invitation names an email address and a role. The link is signed (nothing secret is stored),
-- it works only for someone signed in with that address once the identity service has confirmed it, and it
-- expires. Accepting adds the person as a member.
CREATE TABLE invitation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 320),
  role         text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  send_count   int NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz,
  UNIQUE (workspace_id, id)
);
-- One open invitation per address in a workspace.
CREATE UNIQUE INDEX invitation_open_key ON invitation (workspace_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitation_ws_idx ON invitation (workspace_id, created_at DESC);

ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitation USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON invitation FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitation TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON invitation FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE invitation;
