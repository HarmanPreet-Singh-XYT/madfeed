-- +goose Up

-- The watcher in the worker needs the AI error rate across all workspaces,
-- which row-level security hides from a normal query. This returns only two
-- counts (no content, no workspace) for the last few minutes.
-- +goose StatementBegin
CREATE FUNCTION ops_ai_error_rate(p_minutes int)
RETURNS TABLE (calls bigint, errors bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*), count(*) FILTER (WHERE outcome = 'error')
  FROM ai_event WHERE created_at > now() - make_interval(mins => least(greatest(p_minutes, 1), 1440))
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION ops_ai_error_rate(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_ai_error_rate(int) TO app_backend;

-- +goose Down
DROP FUNCTION ops_ai_error_rate(int);
