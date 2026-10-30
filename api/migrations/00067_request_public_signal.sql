-- +goose Up
-- What the public web says about this request: a verdict, a one-sentence reading of the sources,
-- and the sources the model was allowed to cite. Null until someone asks for it.
ALTER TABLE request ADD COLUMN public_signal jsonb;

-- +goose Down
ALTER TABLE request DROP COLUMN public_signal;
