-- +goose Up
-- Files in website chat, both ways. The bytes live in the database (at most 5 MB each, 3 per message, and a
-- workspace total cap enforced by the service) so that tenant isolation and deletion are the same as for
-- messages: when a conversation or person is deleted the files go with it, with nothing left in a bucket.
CREATE TABLE conversation_attachment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  -- both null while the file is uploaded but not yet sent with a message
  conversation_id uuid,
  message_id      uuid,
  -- who uploaded it: "u:<user id>" for a teammate, "v:<hash of the visitor's browser id>" for a visitor
  uploader        text NOT NULL CHECK (char_length(uploader) BETWEEN 3 AND 80),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  content_type    text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain')),
  size            int  NOT NULL CHECK (size BETWEEN 1 AND 5242880),
  data            bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK ((message_id IS NULL) = (conversation_id IS NULL)),
  CHECK (octet_length(data) = size),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES conversation_message (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX conversation_attachment_message_idx ON conversation_attachment (workspace_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX conversation_attachment_pending_idx ON conversation_attachment (workspace_id, uploader, created_at) WHERE message_id IS NULL;

ALTER TABLE conversation_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversation_attachment USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON conversation_attachment FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_attachment TO app_backend;

-- +goose Down
DROP TABLE conversation_attachment;
