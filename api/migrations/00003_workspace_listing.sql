-- +goose Up

-- A signed-in user may see the names of workspaces they belong to before any
-- workspace context exists (to pick one). Read-only; writes still need the
-- tenant policy.
CREATE POLICY own_workspaces ON workspace FOR SELECT
  USING (EXISTS (SELECT 1 FROM member m WHERE m.workspace_id = workspace.id AND m.user_id = app_user_id()));

-- +goose Down
DROP POLICY own_workspaces ON workspace;
