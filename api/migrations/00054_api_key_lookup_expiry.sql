-- +goose Up
-- The lookup also says when the key ends, so a copy kept for a few seconds in the shared cache can never
-- outlive the key's own expiry. Nothing else about it changes.
DROP FUNCTION api_key_lookup(text);
-- +goose StatementBegin
CREATE FUNCTION api_key_lookup(p_hash text) RETURNS TABLE (id uuid, workspace_id uuid, name text, scopes text[], allowed_cidrs text[], expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE api_key k SET last_used_at = now()
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
      AND (k.last_used_at IS NULL OR k.last_used_at < now() - interval '5 minutes');
  RETURN QUERY SELECT k.id, k.workspace_id, k.name, k.scopes, k.allowed_cidrs, k.expires_at FROM api_key k
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO app_backend;

-- +goose Down
DROP FUNCTION api_key_lookup(text);
-- +goose StatementBegin
CREATE FUNCTION api_key_lookup(p_hash text) RETURNS TABLE (id uuid, workspace_id uuid, name text, scopes text[], allowed_cidrs text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE api_key k SET last_used_at = now()
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
      AND (k.last_used_at IS NULL OR k.last_used_at < now() - interval '5 minutes');
  RETURN QUERY SELECT k.id, k.workspace_id, k.name, k.scopes, k.allowed_cidrs FROM api_key k
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO app_backend;
