-- +goose Up

-- A delivery report from the email provider names a message by the provider's
-- id and carries no workspace. This finds which of our messages it was, across
-- workspaces, and returns only what is needed to act on it. Index note: this is
-- the one lookup that cannot lead with workspace_id, because the caller does
-- not know the workspace yet.
CREATE INDEX outreach_message_provider_idx ON outreach_message (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION message_for_provider_id(p_id text)
RETURNS TABLE (workspace_id uuid, to_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.workspace_id, m.to_email FROM outreach_message m WHERE m.provider_message_id = p_id LIMIT 1
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION message_for_provider_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION message_for_provider_id(text) TO app_backend;

-- +goose Down
DROP FUNCTION message_for_provider_id(text);
DROP INDEX outreach_message_provider_idx;
