-- +goose Up
-- Salesforce as a second read-only source of account value, next to HubSpot. The worker finds due syncs for both
-- through one function.
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira', 'hubspot', 'clickup', 'asana', 'azuredevops', 'salesforce'));

-- +goose StatementBegin
CREATE FUNCTION integrations_crm_due() RETURNS TABLE (workspace_id uuid, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.workspace_id, i.kind FROM integration i
  WHERE i.kind IN ('hubspot', 'salesforce') AND i.state = 'connected'
    AND (coalesce((i.config ->> 'syncRequested')::boolean, false)
         OR i.config -> 'lastSync' IS NULL
         OR (i.config -> 'lastSync' ->> 'at')::timestamptz < now() - interval '24 hours')
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION integrations_crm_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations_crm_due() TO app_backend;
DROP FUNCTION integrations_hubspot_due();

-- +goose Down
-- +goose StatementBegin
CREATE FUNCTION integrations_hubspot_due() RETURNS TABLE (workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.workspace_id FROM integration i
  WHERE i.kind = 'hubspot' AND i.state = 'connected'
    AND (coalesce((i.config ->> 'syncRequested')::boolean, false)
         OR i.config -> 'lastSync' IS NULL
         OR (i.config -> 'lastSync' ->> 'at')::timestamptz < now() - interval '24 hours')
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION integrations_hubspot_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations_hubspot_due() TO app_backend;
DROP FUNCTION integrations_crm_due();
DELETE FROM integration WHERE kind = 'salesforce';
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira', 'hubspot', 'clickup', 'asana', 'azuredevops'));
