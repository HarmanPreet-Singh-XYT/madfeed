-- +goose Up

-- A per-workspace override of the daily AI allowance (US dollars over the last
-- 24 hours). NULL means the server-wide default applies.
ALTER TABLE workspace ADD COLUMN ai_daily_budget_usd numeric(10, 2) CHECK (ai_daily_budget_usd IS NULL OR ai_daily_budget_usd > 0);

-- Something the workspace's admins should know about. At most one of each kind per day,
-- so a runaway job cannot flood the page.
CREATE TABLE notice (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('ai_budget')),
  message      text NOT NULL CHECK (char_length(message) <= 500),
  created_on   date NOT NULL DEFAULT current_date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, created_on)
);
CREATE INDEX notice_ws_created_idx ON notice (workspace_id, created_at DESC);

ALTER TABLE notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notice USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON notice FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON notice TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON notice FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE notice;
ALTER TABLE workspace DROP COLUMN ai_daily_budget_usd;
