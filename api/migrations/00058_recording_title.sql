-- +goose Up

-- A recording can be named before or after it is transcribed. Before, the list
-- can only show the file name ("call-4.m4a"); after, the transcript gets a title
-- of its own, so the two would drift. One title lives on the recording and is
-- copied to the transcript when that is written.
ALTER TABLE media
  ADD COLUMN title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200);

-- +goose Down
ALTER TABLE media DROP COLUMN title;
