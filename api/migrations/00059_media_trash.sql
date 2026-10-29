-- +goose Up

-- Deleting a recording is reversible for a few seconds. Until the purge job
-- runs, the row is only marked, hidden from the library, and can be brought
-- back. The file and the transcript stay exactly where they were, so undo is
-- instant; after the window the purge removes them for good.
ALTER TABLE media ADD COLUMN deleted_at timestamptz;

-- Every list reads the live rows, newest first; a partial index keeps deleted
-- rows out of that path entirely.
CREATE INDEX media_live_idx ON media (workspace_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX media_live_idx;
ALTER TABLE media DROP COLUMN deleted_at;
