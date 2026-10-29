-- +goose Up

-- How far each person has read a conversation. Shared inboxes need this per
-- person, not per conversation: one teammate opening a thread must not mark it
-- read for everyone else. A row appears the first time someone reads it.
CREATE TABLE conversation_read (
  workspace_id    uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  -- the highest message seq this person has seen; 0 means "never opened it"
  last_read_seq   int  NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id, user_id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX conversation_read_person_idx ON conversation_read (workspace_id, user_id);

ALTER TABLE conversation_read ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_read FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversation_read USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON conversation_read FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_read TO app_backend;

-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON conversation_read FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE conversation_read;
