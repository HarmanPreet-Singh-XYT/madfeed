-- +goose Up

-- Deleting a findings document moves it to a restorable state and ends its public link at once.
ALTER TABLE finding_doc ADD COLUMN deleted_at timestamptz;
-- A shared link can expire, and it can ask for a password before it shows anything.
ALTER TABLE finding_doc ADD COLUMN share_expires_at timestamptz;
ALTER TABLE finding_doc ADD COLUMN share_password_hash text;
CREATE INDEX finding_doc_live_idx ON finding_doc (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

-- Periodic snapshots of a document's words, so a bad edit or a restore can be undone.
CREATE TABLE finding_doc_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  doc_id       uuid NOT NULL,
  title        text NOT NULL,
  blocks       jsonb NOT NULL,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, doc_id) REFERENCES finding_doc (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX finding_doc_version_doc_idx ON finding_doc_version (workspace_id, doc_id, created_at DESC);

ALTER TABLE finding_doc_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_doc_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finding_doc_version
  USING (workspace_id = app_workspace_id())
  WITH CHECK (workspace_id = app_workspace_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON finding_doc_version TO app_backend;

-- +goose Down
DROP TABLE finding_doc_version;
DROP INDEX finding_doc_live_idx;
ALTER TABLE finding_doc DROP COLUMN share_password_hash;
ALTER TABLE finding_doc DROP COLUMN share_expires_at;
ALTER TABLE finding_doc DROP COLUMN deleted_at;
