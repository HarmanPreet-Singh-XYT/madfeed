-- +goose Up
-- When the model first started reading a source item. Lets the worker cap how many website-form
-- submissions it reads per day, so a flood of them cannot use up a workspace's AI allowance.
ALTER TABLE source_item ADD COLUMN extract_started_at timestamptz;
CREATE INDEX source_item_form_extract_idx ON source_item (workspace_id, extract_started_at) WHERE kind = 'form' AND extract_started_at IS NOT NULL;

-- +goose Down
DROP INDEX source_item_form_extract_idx;
ALTER TABLE source_item DROP COLUMN extract_started_at;
