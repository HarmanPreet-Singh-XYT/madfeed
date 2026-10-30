-- +goose Up
-- What the public web says about this company: a short summary and the pages it came from.
ALTER TABLE account ADD COLUMN research jsonb;

-- +goose Down
ALTER TABLE account DROP COLUMN research;
