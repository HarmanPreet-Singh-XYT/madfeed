-- +goose Up
-- When a person is deleted their messages go with them, but the unsubscribe link in an email
-- they already received must still work, and that address must still never be emailed. These two
-- tables keep only a keyed hash of the address: enough to honour the opt-out, not enough to
-- read the address back.

-- Addresses that must not be emailed, known only by hash.
CREATE TABLE suppression_hash (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  email_hash   text NOT NULL CHECK (char_length(email_hash) = 64),
  reason       text NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email_hash)
);

-- A sent message whose row was deleted: its id (from the link) -> the hash of who it went to.
CREATE TABLE unsub_tombstone (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  message_id   uuid NOT NULL,
  email_hash   text NOT NULL CHECK (char_length(email_hash) = 64),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, message_id)
);

ALTER TABLE suppression_hash ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_hash FORCE ROW LEVEL SECURITY;
ALTER TABLE unsub_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE unsub_tombstone FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppression_hash USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON unsub_tombstone USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON suppression_hash, unsub_tombstone FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON suppression_hash, unsub_tombstone TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON suppression_hash, unsub_tombstone FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE unsub_tombstone;
DROP TABLE suppression_hash;
