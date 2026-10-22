-- +goose Up

-- The backend connects through a login role that is a member of app_backend.
-- app_backend is NOT a superuser, does NOT bypass RLS and owns nothing, so row
-- level security applies to every query it runs. The login role (with its
-- password) is provisioned outside migrations so no secret lives in the repo.
-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_backend') THEN
    CREATE ROLE app_backend NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
-- +goose StatementEnd

-- Tenant context set per transaction by the backend (see internal/store).
-- Unset or empty means NULL, which matches no rows.
CREATE FUNCTION app_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE TABLE workspace (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX member_user_idx ON member (user_id);

-- Placeholder entity so isolation can be proven end to end before the real
-- request/evidence tables arrive in Phase 1.
CREATE TABLE request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- workspace_id leads every index on tenant data.
CREATE INDEX request_ws_created_idx ON request (workspace_id, created_at DESC, id DESC);

ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace FORCE ROW LEVEL SECURITY;
ALTER TABLE member    ENABLE ROW LEVEL SECURITY;
ALTER TABLE member    FORCE ROW LEVEL SECURITY;
ALTER TABLE request   ENABLE ROW LEVEL SECURITY;
ALTER TABLE request   FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON workspace
  USING (id = app_workspace_id()) WITH CHECK (id = app_workspace_id());

CREATE POLICY tenant_isolation ON member
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
-- A user may list their own memberships across workspaces (to pick one at
-- sign-in) before any workspace context exists. Read-only.
CREATE POLICY own_memberships ON member FOR SELECT
  USING (user_id = app_user_id());

CREATE POLICY tenant_isolation ON request
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- Deny everything to Supabase's public-facing roles (when they exist), then
-- grant only what the backend role needs.
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON workspace, member, request FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION app_workspace_id(), app_user_id() FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON workspace, member, request FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace, member, request TO app_backend;
GRANT EXECUTE ON FUNCTION app_workspace_id(), app_user_id() TO app_backend;

-- +goose Down
DROP TABLE request;
DROP TABLE member;
DROP TABLE workspace;
DROP FUNCTION app_user_id();
DROP FUNCTION app_workspace_id();
