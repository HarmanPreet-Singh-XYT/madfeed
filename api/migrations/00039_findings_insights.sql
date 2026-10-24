-- +goose Up
-- Phase 8: findings documents with live quote cards, and sentiment over quotes.

CREATE TABLE finding_doc (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  state        text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
  -- the public link is signed over this number; raising it ends every earlier link at once
  share_epoch  int  NOT NULL DEFAULT 0 CHECK (share_epoch >= 0),
  published_by uuid,
  published_at timestamptz,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (state <> 'published' OR (published_by IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX finding_doc_ws_idx ON finding_doc (workspace_id, updated_at DESC);

-- A block is a paragraph or a quote card. A card points at a stored quote (evidence or a highlight); when that
-- quote is deleted the pointer becomes empty and the card shows as removed, never as stale text.
CREATE TABLE finding_block (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  doc_id       uuid NOT NULL,
  ordinal      int  NOT NULL CHECK (ordinal BETWEEN 0 AND 199),
  kind         text NOT NULL CHECK (kind IN ('text', 'quote')),
  body         text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  quote_kind   text CHECK (quote_kind IN ('evidence', 'highlight')),
  evidence_id  uuid,
  highlight_id uuid,
  UNIQUE (doc_id, ordinal),
  FOREIGN KEY (workspace_id, doc_id) REFERENCES finding_doc (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence (workspace_id, id) ON DELETE SET NULL (evidence_id),
  FOREIGN KEY (workspace_id, highlight_id) REFERENCES highlight (workspace_id, id) ON DELETE SET NULL (highlight_id),
  CHECK (
    (kind = 'text' AND quote_kind IS NULL AND evidence_id IS NULL AND highlight_id IS NULL AND body <> '')
    OR (kind = 'quote' AND quote_kind = 'evidence' AND highlight_id IS NULL)
    OR (kind = 'quote' AND quote_kind = 'highlight' AND evidence_id IS NULL)
  )
);
CREATE INDEX finding_block_evidence_idx ON finding_block (evidence_id) WHERE evidence_id IS NOT NULL;
CREATE INDEX finding_block_highlight_idx ON finding_block (highlight_id) WHERE highlight_id IS NOT NULL;

-- How a quote feels, by the model or by a person. A person's label wins; the two are kept so they can be compared.
CREATE TABLE quote_sentiment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  evidence_id    uuid,
  highlight_id   uuid,
  source         text NOT NULL CHECK (source IN ('model', 'human')),
  label          text NOT NULL CHECK (label IN ('positive', 'neutral', 'negative', 'mixed')),
  model          text,
  prompt_version text,
  set_by         uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, highlight_id) REFERENCES highlight (workspace_id, id) ON DELETE CASCADE,
  CHECK ((evidence_id IS NULL) <> (highlight_id IS NULL)),
  CHECK (source <> 'human' OR set_by IS NOT NULL)
);
CREATE UNIQUE INDEX quote_sentiment_evidence_key ON quote_sentiment (evidence_id, source) WHERE evidence_id IS NOT NULL;
CREATE UNIQUE INDEX quote_sentiment_highlight_key ON quote_sentiment (highlight_id, source) WHERE highlight_id IS NOT NULL;
CREATE INDEX quote_sentiment_ws_idx ON quote_sentiment (workspace_id, source, label);

-- Browsing quotes with filters stays fast at 100,000 rows: newest-first scans lead with the workspace.
CREATE INDEX evidence_ws_created_idx ON evidence (workspace_id, created_at DESC, id DESC);

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finding_doc', 'finding_block', 'quote_sentiment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_backend', t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP INDEX evidence_ws_created_idx;
DROP TABLE quote_sentiment;
DROP TABLE finding_block;
DROP TABLE finding_doc;
