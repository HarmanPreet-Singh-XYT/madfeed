-- +goose Up
-- How many things (card numbers, keys, passwords) were hidden when this text came in,
-- so the person can be told. The hidden values themselves are never stored.
ALTER TABLE source_item ADD COLUMN redactions int NOT NULL DEFAULT 0 CHECK (redactions >= 0);

-- +goose Down
ALTER TABLE source_item DROP COLUMN redactions;
