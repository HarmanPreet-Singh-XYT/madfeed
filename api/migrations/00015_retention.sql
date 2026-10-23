-- +goose Up

-- Retention: how long each kind of working data is kept. This runs across all
-- workspaces from the worker (no single tenant), so it is a database function
-- owned by the migration role, callable only by the backend role, that deletes
-- by age and reports how many rows went. It never touches sources, quotes,
-- requests, highlights, people or the send log: those are the customer's own
-- records and leave only when the customer deletes them.
-- +goose StatementBegin
CREATE FUNCTION purge_expired(p_qa_days int, p_ai_days int, p_notice_days int, p_dismissed_days int)
RETURNS TABLE (kind text, removed bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF p_qa_days < 7 OR p_ai_days < 30 OR p_notice_days < 1 OR p_dismissed_days < 7 THEN
    RAISE EXCEPTION 'retention periods are below the safe minimums';
  END IF;
  DELETE FROM qa_answer WHERE created_at < now() - make_interval(days => p_qa_days);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'questions and answers'; removed := n; RETURN NEXT;
  DELETE FROM ai_event WHERE created_at < now() - make_interval(days => p_ai_days);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'ai call records'; removed := n; RETURN NEXT;
  DELETE FROM notice WHERE created_at < now() - make_interval(days => p_notice_days);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'notices'; removed := n; RETURN NEXT;
  DELETE FROM proposal WHERE state = 'dismissed' AND created_at < now() - make_interval(days => p_dismissed_days);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'dismissed suggestions'; removed := n; RETURN NEXT;
  DELETE FROM highlight_proposal WHERE state = 'dismissed' AND created_at < now() - make_interval(days => p_dismissed_days);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'dismissed highlight suggestions'; removed := n; RETURN NEXT;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION purge_expired(int, int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired(int, int, int, int) TO app_backend;

-- +goose Down
DROP FUNCTION purge_expired(int, int, int, int);
