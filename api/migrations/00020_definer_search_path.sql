-- +goose Up
-- Every SECURITY DEFINER function looks tables up in `public` first and never lets the
-- session's temporary schema shadow them. (pg_temp is searched first unless named last.)
-- +goose StatementBegin
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
SELECT 1;
