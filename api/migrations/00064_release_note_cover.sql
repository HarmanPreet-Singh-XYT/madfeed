-- +goose Up

-- A cover picture for a release note, so a public changelog can be scanned by picture as well as by text.
-- The bytes live in the database (at most 2 MB, PNG or JPEG) so that tenant isolation, deletion and the
-- public page all follow the same rules as the note: delete the note and its picture goes with it.
ALTER TABLE release_note ADD COLUMN cover_updated_at timestamptz;

CREATE TABLE release_note_cover (
  workspace_id    uuid NOT NULL,
  release_note_id uuid NOT NULL,
  content_type    text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  size            int  NOT NULL CHECK (size BETWEEN 1 AND 2097152),
  data            bytea NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, release_note_id),
  CHECK (octet_length(data) = size),
  FOREIGN KEY (workspace_id, release_note_id) REFERENCES release_note (workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE release_note_cover ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_note_cover FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON release_note_cover USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON release_note_cover FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON release_note_cover TO app_backend;

-- +goose Down
DROP TABLE release_note_cover;
ALTER TABLE release_note DROP COLUMN cover_updated_at;
