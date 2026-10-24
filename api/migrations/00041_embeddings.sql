-- +goose Up
-- Meaning-based matching and search. Vectors are 512 numbers (a shortened OpenAI embedding) so that 100,000 quotes
-- fit in about 200 MB. A vector is only ever compared with vectors from the same model.
CREATE EXTENSION IF NOT EXISTS vector;

-- What each request is about, for finding the request a new statement belongs to. The text embedded is the
-- request's title plus a few of its quotes; the hash says when it needs doing again.
CREATE TABLE request_embedding (
  workspace_id uuid NOT NULL,
  request_id   uuid NOT NULL,
  embedding    vector(512) NOT NULL,
  model        text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  text_hash    text NOT NULL CHECK (char_length(text_hash) = 64),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX request_embedding_ws_idx ON request_embedding (workspace_id);

-- What each stored quote means, for searching by meaning.
CREATE TABLE quote_embedding (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  evidence_id  uuid,
  highlight_id uuid,
  embedding    vector(512) NOT NULL,
  model        text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, highlight_id) REFERENCES highlight (workspace_id, id) ON DELETE CASCADE,
  CHECK ((evidence_id IS NULL) <> (highlight_id IS NULL))
);
CREATE UNIQUE INDEX quote_embedding_evidence_key ON quote_embedding (evidence_id) WHERE evidence_id IS NOT NULL;
CREATE UNIQUE INDEX quote_embedding_highlight_key ON quote_embedding (highlight_id) WHERE highlight_id IS NOT NULL;
CREATE INDEX quote_embedding_ws_idx ON quote_embedding (workspace_id);

-- A suggestion on a proposal: "this looks like request X". It is only ever a suggestion; a person decides.
ALTER TABLE proposal ADD COLUMN matched_at timestamptz;
ALTER TABLE proposal ADD COLUMN suggested_request_id uuid;
ALTER TABLE proposal ADD COLUMN match_score real CHECK (match_score IS NULL OR (match_score >= -1 AND match_score <= 1));
ALTER TABLE proposal ADD COLUMN match_confidence real CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1));
ALTER TABLE proposal ADD COLUMN match_rationale text NOT NULL DEFAULT '' CHECK (char_length(match_rationale) <= 500);
ALTER TABLE proposal ADD FOREIGN KEY (workspace_id, suggested_request_id) REFERENCES request (workspace_id, id) ON DELETE SET NULL (suggested_request_id);

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_embedding', 'quote_embedding'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_backend', t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE proposal DROP COLUMN match_rationale, DROP COLUMN match_confidence, DROP COLUMN match_score, DROP COLUMN suggested_request_id, DROP COLUMN matched_at;
DROP TABLE quote_embedding;
DROP TABLE request_embedding;
