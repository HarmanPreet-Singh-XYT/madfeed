-- +goose Up
-- What other products already do about this request, written into the brief so the document a team
-- decides from compares the market, not only the customers.
ALTER TABLE brief ADD COLUMN market text;

-- +goose Down
ALTER TABLE brief DROP COLUMN market;
