-- +goose Up

-- Tenant tables reference each other with composite (workspace_id, id) keys so
-- a row can never point at another tenant's row, even through a bug.
ALTER TABLE request ADD COLUMN summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000);
ALTER TABLE request ADD COLUMN created_via text NOT NULL DEFAULT 'manual' CHECK (created_via IN ('manual', 'machine'));
ALTER TABLE request ADD CONSTRAINT request_ws_id_key UNIQUE (workspace_id, id);

CREATE TABLE person (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email        text CHECK (email IS NULL OR char_length(email) <= 320),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX person_ws_email_key ON person (workspace_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE source_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('paste')),
  title            text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  raw_text         text NOT NULL CHECK (char_length(raw_text) > 0 AND octet_length(raw_text) <= 1048576),
  content_hash     text NOT NULL,
  person_id        uuid,
  origin_url       text CHECK (origin_url IS NULL OR char_length(origin_url) <= 2000),
  processing_state text NOT NULL DEFAULT 'pending' CHECK (processing_state IN ('pending', 'processing', 'done', 'failed')),
  failure_reason   text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, content_hash),
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id)
);
CREATE INDEX source_item_ws_created_idx ON source_item (workspace_id, created_at DESC, id DESC);

-- Offsets everywhere are BYTE offsets into source_item.raw_text (UTF-8).
CREATE TABLE chunk (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  source_item_id uuid NOT NULL,
  ordinal        int  NOT NULL CHECK (ordinal >= 0),
  start_offset   int  NOT NULL CHECK (start_offset >= 0),
  end_offset     int  NOT NULL,
  text           text NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (source_item_id, ordinal),
  CHECK (end_offset > start_offset),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE proposal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  source_item_id     uuid NOT NULL,
  chunk_id           uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('new_request', 'evidence_for')),
  target_request_id  uuid,
  statement_kind     text NOT NULL CHECK (statement_kind IN ('need', 'bug', 'praise', 'question')),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  quote_text         text NOT NULL CHECK (char_length(quote_text) > 0),
  span_start         int  NOT NULL,
  span_end           int  NOT NULL,
  confidence         real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rationale          text NOT NULL DEFAULT '',
  state              text NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'accepted', 'dismissed')),
  request_id         uuid,           -- request this proposal produced or joined when accepted
  evidence_id        uuid,
  created_request    boolean NOT NULL DEFAULT false,
  decided_by         uuid,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (source_item_id, span_start, span_end),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, chunk_id) REFERENCES chunk (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, target_request_id) REFERENCES request (workspace_id, id) ON DELETE SET NULL (target_request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE SET NULL (request_id)
);
CREATE INDEX proposal_queue_idx ON proposal (workspace_id, state, confidence DESC, created_at);

CREATE TABLE evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  request_id     uuid NOT NULL,
  source_item_id uuid NOT NULL,
  chunk_id       uuid NOT NULL,            -- no evidence without a source chunk
  person_id      uuid,
  quote_text     text NOT NULL CHECK (char_length(quote_text) > 0),
  span_start     int  NOT NULL,
  span_end       int  NOT NULL,
  confidence     real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (request_id, source_item_id, span_start, span_end),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, chunk_id) REFERENCES chunk (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id)
);
CREATE INDEX evidence_request_idx ON evidence (workspace_id, request_id, created_at DESC);

ALTER TABLE proposal ADD FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence (workspace_id, id) ON DELETE SET NULL (evidence_id);

CREATE TABLE ai_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  task               text NOT NULL,
  tier               text NOT NULL,
  provider           text NOT NULL,
  model              text NOT NULL,
  prompt_version     text NOT NULL,
  input_tokens       int  NOT NULL DEFAULT 0,
  output_tokens      int  NOT NULL DEFAULT 0,
  cached_input_tokens int NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms         int  NOT NULL DEFAULT 0,
  outcome            text NOT NULL CHECK (outcome IN ('ok', 'error')),
  error_class        text,
  subject_id         uuid,
  human_action       text CHECK (human_action IS NULL OR human_action IN ('accepted', 'edited', 'dismissed', 'rated_good', 'rated_bad')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_event_ws_created_idx ON ai_event (workspace_id, created_at DESC);

-- Database-level guarantee behind "no claim without a source": every stored
-- quote must equal the source text at its byte span, whatever code wrote it.
-- +goose StatementBegin
CREATE FUNCTION assert_quote_in_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  src bytea;
BEGIN
  SELECT convert_to(raw_text, 'UTF8') INTO src
    FROM source_item WHERE workspace_id = NEW.workspace_id AND id = NEW.source_item_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'source item not found for quote';
  END IF;
  IF NEW.span_start < 0 OR NEW.span_end <= NEW.span_start OR NEW.span_end > octet_length(src) THEN
    RAISE EXCEPTION 'span out of range';
  END IF;
  IF substring(src FROM NEW.span_start + 1 FOR NEW.span_end - NEW.span_start) <> convert_to(NEW.quote_text, 'UTF8') THEN
    RAISE EXCEPTION 'quote does not match the source text at its span';
  END IF;
  RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER evidence_quote_check BEFORE INSERT OR UPDATE OF quote_text, span_start, span_end, source_item_id ON evidence
  FOR EACH ROW EXECUTE FUNCTION assert_quote_in_source();
CREATE TRIGGER proposal_quote_check BEFORE INSERT OR UPDATE OF quote_text, span_start, span_end, source_item_id ON proposal
  FOR EACH ROW EXECUTE FUNCTION assert_quote_in_source();

-- Spans are offsets into raw_text, so the text is immutable once stored.
-- +goose StatementBegin
CREATE FUNCTION forbid_raw_text_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_text IS DISTINCT FROM OLD.raw_text THEN
    RAISE EXCEPTION 'source text is immutable';
  END IF;
  RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER source_item_immutable BEFORE UPDATE ON source_item
  FOR EACH ROW EXECUTE FUNCTION forbid_raw_text_change();

ALTER TABLE person      ENABLE ROW LEVEL SECURITY; ALTER TABLE person      FORCE ROW LEVEL SECURITY;
ALTER TABLE source_item ENABLE ROW LEVEL SECURITY; ALTER TABLE source_item FORCE ROW LEVEL SECURITY;
ALTER TABLE chunk       ENABLE ROW LEVEL SECURITY; ALTER TABLE chunk       FORCE ROW LEVEL SECURITY;
ALTER TABLE proposal    ENABLE ROW LEVEL SECURITY; ALTER TABLE proposal    FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence    ENABLE ROW LEVEL SECURITY; ALTER TABLE evidence    FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_event    ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_event    FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON person      USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON source_item USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON chunk       USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON proposal    USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON evidence    USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON ai_event    USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON person, source_item, chunk, proposal, evidence, ai_event FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON person, source_item, chunk, proposal, evidence, ai_event FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON person, source_item, chunk, proposal, evidence, ai_event TO app_backend;

-- +goose Down
DROP TABLE ai_event;
DROP TABLE evidence CASCADE;
DROP TABLE proposal;
DROP TABLE chunk;
DROP TABLE source_item;
DROP TABLE person;
DROP FUNCTION assert_quote_in_source();
DROP FUNCTION forbid_raw_text_change();
ALTER TABLE request DROP CONSTRAINT request_ws_id_key;
ALTER TABLE request DROP COLUMN created_via;
ALTER TABLE request DROP COLUMN summary;
