-- +goose Up
-- Support desk, second round: teammates can be named and handed conversations, canned replies, and first-reply
-- times with an optional target.

-- A name teammates see (the sign-in service is the only place that knows people's emails, so each person sets
-- the name they want shown). Empty means "a teammate".
ALTER TABLE member ADD COLUMN display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80);

-- When the team first answered, kept on the conversation so reporting is one cheap query.
ALTER TABLE conversation ADD COLUMN first_reply_at timestamptz;
UPDATE conversation c SET first_reply_at = (SELECT min(m.created_at) FROM conversation_message m WHERE m.conversation_id = c.id AND m.direction = 'out');
CREATE INDEX conversation_reply_idx ON conversation (workspace_id, created_at DESC) WHERE first_reply_at IS NOT NULL;

-- A reply target in hours; 0 means none.
ALTER TABLE inbox_setting ADD COLUMN reply_target_hours int NOT NULL DEFAULT 0 CHECK (reply_target_hours BETWEEN 0 AND 720);

CREATE TABLE canned_reply (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX canned_reply_name_key ON canned_reply (workspace_id, lower(btrim(name)));

ALTER TABLE canned_reply ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_reply FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON canned_reply USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON canned_reply FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON canned_reply TO app_backend;

-- +goose Down
DROP TABLE canned_reply;
ALTER TABLE inbox_setting DROP COLUMN reply_target_hours;
DROP INDEX conversation_reply_idx;
ALTER TABLE conversation DROP COLUMN first_reply_at;
ALTER TABLE member DROP COLUMN display_name;
