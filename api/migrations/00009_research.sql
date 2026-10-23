-- +goose Up

-- Codebook: the shared set of tags with definitions. A tag is never silently
-- deleted: it is archived (and can be restored) or merged into another tag
-- (and the merge can be undone from its log row).
CREATE TABLE tag (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  definition   text NOT NULL DEFAULT '' CHECK (char_length(definition) <= 500),
  color        text NOT NULL DEFAULT 'gray' CHECK (color IN ('gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink')),
  origin       text NOT NULL DEFAULT 'human' CHECK (origin IN ('human', 'machine')),
  archived_at  timestamptz,
  merged_into  uuid,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, merged_into) REFERENCES tag (workspace_id, id)
);
-- One live tag per name, ignoring case; archived or merged ones free the name.
CREATE UNIQUE INDEX tag_live_name_idx ON tag (workspace_id, lower(btrim(name))) WHERE archived_at IS NULL;

-- A highlight is a verbatim passage someone marked in a source, with or
-- without a request. The same database check as evidence keeps the text
-- identical to the source at its byte span.
CREATE TABLE highlight (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  source_item_id uuid NOT NULL,
  chunk_id       uuid NOT NULL,
  span_start     int  NOT NULL,
  span_end       int  NOT NULL,
  quote_text     text NOT NULL CHECK (char_length(quote_text) > 0),
  note           text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  author_id      uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (source_item_id, span_start, span_end),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, chunk_id) REFERENCES chunk (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX highlight_ws_created_idx ON highlight (workspace_id, created_at DESC, id DESC);
CREATE INDEX highlight_source_idx ON highlight (workspace_id, source_item_id);
CREATE TRIGGER highlight_quote_check BEFORE INSERT OR UPDATE OF quote_text, span_start, span_end, source_item_id ON highlight
  FOR EACH ROW EXECUTE FUNCTION assert_quote_in_source();

CREATE TABLE highlight_tag (
  workspace_id uuid NOT NULL,
  highlight_id uuid NOT NULL,
  tag_id       uuid NOT NULL,
  PRIMARY KEY (highlight_id, tag_id),
  FOREIGN KEY (workspace_id, highlight_id) REFERENCES highlight (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tag (workspace_id, id)
);
CREATE INDEX highlight_tag_tag_idx ON highlight_tag (workspace_id, tag_id);

CREATE TABLE request_tag (
  workspace_id uuid NOT NULL,
  request_id   uuid NOT NULL,
  tag_id       uuid NOT NULL,
  PRIMARY KEY (request_id, tag_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tag (workspace_id, id)
);
CREATE INDEX request_tag_tag_idx ON request_tag (workspace_id, tag_id);

-- What a merge moved, so it can be undone exactly.
CREATE TABLE tag_merge (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  source_tag_id   uuid NOT NULL,
  target_tag_id   uuid NOT NULL,
  highlight_ids   uuid[] NOT NULL DEFAULT '{}',
  request_ids     uuid[] NOT NULL DEFAULT '{}',
  -- items that already carried the target tag, which undo must leave alone
  kept_highlight_ids uuid[] NOT NULL DEFAULT '{}',
  kept_request_ids   uuid[] NOT NULL DEFAULT '{}',
  merged_by       uuid NOT NULL,
  merged_at       timestamptz NOT NULL DEFAULT now(),
  undone_at       timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, source_tag_id) REFERENCES tag (workspace_id, id),
  FOREIGN KEY (workspace_id, target_tag_id) REFERENCES tag (workspace_id, id)
);

-- Questions asked of the workspace and what came back. An answer only exists
-- with citations; a refusal records that nothing relevant was found.
CREATE TABLE qa_answer (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  asked_by       uuid NOT NULL,
  question       text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  outcome        text NOT NULL CHECK (outcome IN ('answered', 'no_evidence')),
  answer         text CHECK (answer IS NULL OR char_length(answer) <= 2000),
  reason         text,
  rating         text CHECK (rating IN ('good', 'wrong')),
  prompt_version text,
  provider       text,
  model          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK ((outcome = 'answered') = (answer IS NOT NULL))
);
CREATE INDEX qa_answer_ws_created_idx ON qa_answer (workspace_id, created_at DESC, id DESC);

-- Each citation points at a stored quote (evidence or highlight). The text
-- shown is that row's own verbatim text, never the model's copy.
CREATE TABLE qa_citation (
  workspace_id uuid NOT NULL,
  answer_id    uuid NOT NULL,
  ordinal      int  NOT NULL CHECK (ordinal >= 1),
  evidence_id  uuid,
  highlight_id uuid,
  PRIMARY KEY (answer_id, ordinal),
  CHECK ((evidence_id IS NULL) <> (highlight_id IS NULL)),
  FOREIGN KEY (workspace_id, answer_id) REFERENCES qa_answer (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, highlight_id) REFERENCES highlight (workspace_id, id) ON DELETE CASCADE
);

-- Word search over stored quotes (the retrieval behind Q&A). The expression
-- must match the query's exactly for the index to be used.
CREATE INDEX evidence_fts_idx ON evidence USING gin (to_tsvector('english', quote_text));
CREATE INDEX highlight_fts_idx ON highlight USING gin (to_tsvector('english', quote_text));

-- Row-level security, deny to the public roles, grant to the backend role.
-- +goose StatementBegin
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tag', 'highlight', 'highlight_tag', 'request_tag', 'tag_merge', 'qa_answer', 'qa_citation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_backend', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP INDEX evidence_fts_idx;
DROP TABLE qa_citation, qa_answer, tag_merge, request_tag, highlight_tag, highlight, tag;
