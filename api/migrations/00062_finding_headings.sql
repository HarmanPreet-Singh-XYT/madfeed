-- +goose Up

-- A finding can have section headings, so a long document has structure and a contents list.
-- Existing paragraphs and quote cards are unchanged.

ALTER TABLE finding_block DROP CONSTRAINT IF EXISTS finding_block_kind_check;
ALTER TABLE finding_block ADD CONSTRAINT finding_block_kind_check
  CHECK (kind IN ('text', 'quote', 'heading'));

ALTER TABLE finding_block DROP CONSTRAINT IF EXISTS finding_block_check;
ALTER TABLE finding_block ADD CONSTRAINT finding_block_check CHECK (
  (kind = 'text' AND quote_kind IS NULL AND evidence_id IS NULL AND highlight_id IS NULL AND body <> '')
  OR (kind = 'heading' AND quote_kind IS NULL AND evidence_id IS NULL AND highlight_id IS NULL AND body <> '')
  OR (kind = 'quote' AND quote_kind = 'evidence' AND highlight_id IS NULL)
  OR (kind = 'quote' AND quote_kind = 'highlight' AND evidence_id IS NULL)
);

-- +goose Down
DELETE FROM finding_block WHERE kind = 'heading';
ALTER TABLE finding_block DROP CONSTRAINT IF EXISTS finding_block_kind_check;
ALTER TABLE finding_block ADD CONSTRAINT finding_block_kind_check
  CHECK (kind IN ('text', 'quote'));
ALTER TABLE finding_block DROP CONSTRAINT IF EXISTS finding_block_check;
ALTER TABLE finding_block ADD CONSTRAINT finding_block_check CHECK (
  (kind = 'text' AND quote_kind IS NULL AND evidence_id IS NULL AND highlight_id IS NULL AND body <> '')
  OR (kind = 'quote' AND quote_kind = 'evidence' AND highlight_id IS NULL)
  OR (kind = 'quote' AND quote_kind = 'highlight' AND evidence_id IS NULL)
);
