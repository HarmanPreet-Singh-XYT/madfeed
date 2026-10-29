-- +goose Up

-- A survey can be told to close itself at a time. Only an open survey is
-- affected; the scheduler below runs outside any workspace.
ALTER TABLE survey ADD COLUMN closes_at timestamptz;

CREATE INDEX survey_due_idx ON survey (closes_at) WHERE state = 'open' AND closes_at IS NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION close_due_surveys() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n bigint;
BEGIN
  UPDATE survey
     SET state = 'closed', closed_at = now(), closes_at = NULL, updated_at = now()
   WHERE state = 'open' AND closes_at IS NOT NULL AND closes_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION close_due_surveys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_due_surveys() TO app_backend;

-- +goose Down
DROP FUNCTION close_due_surveys();
DROP INDEX survey_due_idx;
ALTER TABLE survey DROP COLUMN closes_at;
