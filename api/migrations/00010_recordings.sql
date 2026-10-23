-- +goose Up

ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording'));

-- An uploaded audio or video file. While 'uploading' it is a resumable upload
-- session (received_bytes says where to continue). When the transcript is
-- ready, source_item_id points at the text source the transcript became.
-- The file itself lives in object storage under storage_key, which the server
-- generates; a client never chooses a path.
CREATE TABLE media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  uploaded_by    uuid NOT NULL,
  person_id      uuid,
  filename       text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0),
  received_bytes bigint NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= size_bytes),
  storage_key    text NOT NULL UNIQUE,
  state          text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'uploaded', 'transcribing', 'done', 'failed')),
  failure_reason text,
  duration_ms    int CHECK (duration_ms IS NULL OR duration_ms >= 0),
  source_item_id uuid,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id),
  CHECK (state <> 'done' OR source_item_id IS NOT NULL)
);
CREATE INDEX media_ws_created_idx ON media (workspace_id, created_at DESC, id DESC);
CREATE INDEX media_expiry_idx ON media (expires_at) WHERE state = 'uploading';
CREATE UNIQUE INDEX media_source_idx ON media (source_item_id) WHERE source_item_id IS NOT NULL;

-- One row per spoken passage. span_start/span_end are byte offsets into the
-- transcript's source_item.raw_text, so a quote, a highlight and a position in
-- the recording always agree.
CREATE TABLE segment (
  workspace_id   uuid NOT NULL,
  source_item_id uuid NOT NULL,
  ordinal        int  NOT NULL CHECK (ordinal >= 0),
  start_ms       int  NOT NULL CHECK (start_ms >= 0),
  end_ms         int  NOT NULL,
  speaker        text NOT NULL DEFAULT '' CHECK (char_length(speaker) <= 80),
  span_start     int  NOT NULL CHECK (span_start >= 0),
  span_end       int  NOT NULL,
  PRIMARY KEY (source_item_id, ordinal),
  CHECK (end_ms >= start_ms AND span_end > span_start),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX segment_span_idx ON segment (source_item_id, span_start);

-- +goose StatementBegin
CREATE FUNCTION assert_segment_in_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT octet_length(raw_text) INTO n FROM source_item WHERE workspace_id = NEW.workspace_id AND id = NEW.source_item_id;
  IF n IS NULL OR NEW.span_end > n THEN
    RAISE EXCEPTION 'segment span is outside the transcript';
  END IF;
  RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER segment_span_check BEFORE INSERT OR UPDATE ON segment FOR EACH ROW EXECUTE FUNCTION assert_segment_in_source();

-- Highlights the model suggests from the codebook. Same quote guarantee as
-- every other stored quote; accepting one creates a normal highlight.
CREATE TABLE highlight_proposal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  source_item_id uuid NOT NULL,
  chunk_id       uuid NOT NULL,
  span_start     int  NOT NULL,
  span_end       int  NOT NULL,
  quote_text     text NOT NULL CHECK (char_length(quote_text) > 0),
  tag_ids        uuid[] NOT NULL DEFAULT '{}',
  confidence     real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  state          text NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'accepted', 'dismissed')),
  edited         boolean NOT NULL DEFAULT false,
  decided_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (source_item_id, span_start, span_end),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, chunk_id) REFERENCES chunk (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX highlight_proposal_ws_idx ON highlight_proposal (workspace_id, state, created_at DESC);
CREATE TRIGGER highlight_proposal_quote_check BEFORE INSERT OR UPDATE OF quote_text, span_start, span_end, source_item_id ON highlight_proposal
  FOR EACH ROW EXECUTE FUNCTION assert_quote_in_source();

-- +goose StatementBegin
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media', 'segment', 'highlight_proposal'] LOOP
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

-- Finds abandoned uploads across all workspaces for the cleanup job. It runs
-- with the table owner's rights because the job has no single workspace; it
-- returns only what is needed to delete the files, and is not callable by the
-- public roles.
-- +goose StatementBegin
CREATE FUNCTION expired_uploads(p_now timestamptz, p_limit int)
RETURNS TABLE (workspace_id uuid, id uuid, uploaded_by uuid, storage_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.workspace_id, m.id, m.uploaded_by, m.storage_key FROM media m
  WHERE m.state = 'uploading' AND m.expires_at IS NOT NULL AND m.expires_at < p_now
  ORDER BY m.expires_at LIMIT p_limit
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION expired_uploads(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expired_uploads(timestamptz, int) TO app_backend;

-- +goose StatementBegin
CREATE FUNCTION media_key_exists(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM media WHERE storage_key = p_key)
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION media_key_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION media_key_exists(text) TO app_backend;

-- +goose Down
DROP FUNCTION media_key_exists(text);
DROP FUNCTION expired_uploads(timestamptz, int);
DROP TABLE highlight_proposal, segment, media;
DROP FUNCTION assert_segment_in_source();
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste'));
