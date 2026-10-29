-- +goose Up

-- A saved way of looking at the quote list, shared by the workspace. Same idea
-- as saved_view for requests, with the quote filters: type, tag, feeling,
-- source, word search, meaning search and order. Typed columns with real
-- foreign keys, so a view can never point at a tag from another workspace.
CREATE TABLE quote_view (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  kind         text NOT NULL DEFAULT '' CHECK (kind IN ('', 'evidence', 'highlight')),
  tag_id       uuid,
  sentiment    text NOT NULL DEFAULT '' CHECK (sentiment IN ('', 'positive', 'neutral', 'negative', 'mixed', 'none')),
  source_kind  text NOT NULL DEFAULT '' CHECK (source_kind IN ('', 'paste', 'recording', 'form', 'api', 'chat', 'survey')),
  search       text NOT NULL DEFAULT '' CHECK (char_length(search) <= 200),
  meaning      text NOT NULL DEFAULT '' CHECK (char_length(meaning) <= 300),
  days         integer NOT NULL DEFAULT 0 CHECK (days IN (0, 7, 30, 90)),
  sort         text NOT NULL DEFAULT 'newest' CHECK (sort IN ('newest', 'oldest')),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tag (workspace_id, id)
);
CREATE UNIQUE INDEX quote_view_name_idx ON quote_view (workspace_id, lower(btrim(name)));
CREATE INDEX quote_view_workspace_idx ON quote_view (workspace_id, created_at DESC);

ALTER TABLE quote_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_view USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON quote_view FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON quote_view TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quote_view FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quote_view FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
DROP TABLE quote_view;
