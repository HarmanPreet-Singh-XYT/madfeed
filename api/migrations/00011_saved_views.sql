-- +goose Up

-- A saved way of looking at the request list, shared by the workspace. Typed
-- columns with real foreign keys (not a JSON blob), so a view can never point
-- at a status or tag from another workspace.
CREATE TABLE saved_view (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  status_id    uuid,
  tag_id       uuid,
  search       text NOT NULL DEFAULT '' CHECK (char_length(search) <= 100),
  sort         text NOT NULL DEFAULT 'newest' CHECK (sort IN ('newest', 'value')),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, status_id) REFERENCES status (workspace_id, id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tag (workspace_id, id)
);
CREATE UNIQUE INDEX saved_view_name_idx ON saved_view (workspace_id, lower(btrim(name)));

ALTER TABLE saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_view USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON saved_view FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_view TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON saved_view FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE saved_view;
