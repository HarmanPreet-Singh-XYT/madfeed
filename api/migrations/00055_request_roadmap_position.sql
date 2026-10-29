-- +goose Up

-- Manual order on the roadmap board. Null means "not placed by hand"; the
-- board falls back to value for those. A column's cards share the same range.
ALTER TABLE request ADD COLUMN roadmap_position double precision;

-- +goose Down
ALTER TABLE request DROP COLUMN roadmap_position;
