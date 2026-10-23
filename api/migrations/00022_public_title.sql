-- +goose Up
-- The public roadmap shows a title written for the public, never the request's own title (which
-- is extracted from customer words and may name people or companies).
ALTER TABLE request ADD COLUMN public_title text NOT NULL DEFAULT '' CHECK (char_length(public_title) <= 200);
-- Requests already public before this change have no public title and must not keep showing the old one.
UPDATE request SET public = false WHERE public;
ALTER TABLE request ADD CONSTRAINT request_public_has_text CHECK (NOT public OR (public_title <> '' AND public_summary <> ''));

-- +goose Down
ALTER TABLE request DROP CONSTRAINT request_public_has_text;
ALTER TABLE request DROP COLUMN public_title;
