-- +goose Up
-- HubSpot as a read-only source of account value. A sync reads the contacts we already know (by email), the
-- company each belongs to, and a value for that company, and fills in or links accounts. Nothing is written
-- to HubSpot.
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira', 'hubspot'));

-- The worker needs to know which workspaces are due a sync (never synced, a day since the last, or asked for) without
-- seeing anything else.
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

-- +goose Down
DROP FUNCTION integrations_hubspot_due();
DELETE FROM integration WHERE kind = 'hubspot';
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira'));
