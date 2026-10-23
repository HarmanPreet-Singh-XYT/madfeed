-- +goose Up

-- Request counters for rate limiting. State lives here, not in memory, so the
-- limit holds across API instances and restarts. Keys are keyed hashes of an
-- address or user id, never the value itself. The table holds no tenant data,
-- so it has no workspace column; instead it is closed to everyone and only
-- the function below (callable by the backend role) can touch it.
CREATE TABLE rate_limit (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limit FROM PUBLIC;

-- Counts one request in the current fixed window and returns the total so far
-- and the seconds until the window ends. Old windows are removed as a side
-- effect, a few at a time, so no separate cleanup job is needed.
-- +goose StatementBegin
CREATE FUNCTION rate_hit(p_bucket text, p_window_seconds int)
RETURNS TABLE (hits int, retry_after int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
BEGIN
  IF p_window_seconds < 1 OR p_window_seconds > 3600 OR char_length(p_bucket) > 200 THEN
    RAISE EXCEPTION 'bad rate limit arguments';
  END IF;
  IF random() < 0.02 THEN
    DELETE FROM rate_limit r WHERE r.window_start < now() - interval '2 hours';
  END IF;
  INSERT INTO rate_limit AS r (bucket, window_start, hits) VALUES (p_bucket, w, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
    RETURNING r.hits INTO hits;
  retry_after := greatest(1, ceil(extract(epoch FROM (w + make_interval(secs => p_window_seconds) - now())))::int);
  RETURN NEXT;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION rate_hit(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_hit(text, int) TO app_backend;

-- +goose Down
DROP FUNCTION rate_hit(text, int);
DROP TABLE rate_limit;
