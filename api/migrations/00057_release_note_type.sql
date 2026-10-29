-- +goose Up

-- A note says what kind of change it is, so a public changelog can be scanned
-- by kind (new / improved / fixed) instead of read line by line. Existing
-- notes are "new", which is what they were.
ALTER TABLE release_note
  ADD COLUMN type text NOT NULL DEFAULT 'new' CHECK (type IN ('new', 'improved', 'fixed'));

-- The filter that reads this leads with the workspace, like every other list.
CREATE INDEX release_note_type_idx ON release_note (workspace_id, type, created_at DESC);

-- +goose Down
DROP INDEX release_note_type_idx;
ALTER TABLE release_note DROP COLUMN type;
