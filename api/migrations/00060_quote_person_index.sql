-- +goose Up

-- Filtering the quote list by person starts from source_item.person_id, so give it an index that leads with
-- the workspace, like every other list query.
CREATE INDEX source_item_ws_person_idx ON source_item (workspace_id, person_id, created_at DESC);

-- A saved quote view can stand for "what this person said" or "what this company said".
ALTER TABLE quote_view ADD COLUMN person_id uuid;
ALTER TABLE quote_view ADD COLUMN account_id uuid;
ALTER TABLE quote_view
  ADD FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE quote_view
  ADD FOREIGN KEY (workspace_id, account_id) REFERENCES account (workspace_id, id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE quote_view DROP COLUMN account_id;
ALTER TABLE quote_view DROP COLUMN person_id;
DROP INDEX source_item_ws_person_idx;
