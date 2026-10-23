-- +goose Up
-- Totals for the metrics endpoint: how many model calls, how many failed and what they cost in
-- the last day, across all workspaces. Three numbers; no workspace, no content.
-- +goose StatementBegin
CREATE FUNCTION ops_ai_totals(p_hours int)
RETURNS TABLE (calls bigint, errors bigint, cost_usd float8)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*), count(*) FILTER (WHERE outcome = 'error'), coalesce(sum(cost_usd), 0)::float8
  FROM ai_event WHERE created_at > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION ops_ai_totals(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_ai_totals(int) TO app_backend;

-- +goose Down
DROP FUNCTION ops_ai_totals(int);
