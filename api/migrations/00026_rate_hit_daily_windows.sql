-- +goose Up
-- The limiter refused windows longer than an hour, so every "per day" limit silently fell back to
-- a per-process count. Allow windows up to a day, and keep old windows for two days so a daily
-- window is never cleaned up while it is still counting.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION rate_hit(p_bucket text, p_window_seconds int)
RETURNS TABLE (hits int, retry_after int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w timestamptz;
BEGIN
  IF p_window_seconds < 1 OR p_window_seconds > 86400 OR char_length(p_bucket) > 200 THEN
    RAISE EXCEPTION 'bad rate limit arguments';
  END IF;
  w := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  IF random() < 0.02 THEN
    DELETE FROM rate_limit r WHERE r.window_start < now() - interval '2 days';
  END IF;
  INSERT INTO rate_limit AS r (bucket, window_start, hits) VALUES (p_bucket, w, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
    RETURNING r.hits INTO hits;
  retry_after := greatest(1, ceil(extract(epoch FROM (w + make_interval(secs => p_window_seconds) - now())))::int);
  RETURN NEXT;
END $$;
-- +goose StatementEnd

-- +goose Down
SELECT 1;
