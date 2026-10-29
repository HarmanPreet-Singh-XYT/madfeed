-- +goose Up

-- A person's quotes are found through their source items. Highlights already had this index; evidence did not,
-- so the people list's "quotes" and "last heard" columns scanned the whole table per person.
CREATE INDEX evidence_source_idx ON evidence (workspace_id, source_item_id);

-- +goose Down
DROP INDEX evidence_source_idx;
