-- +goose Up
-- A person asking for their sign-in account to be deleted. The identity service holds the account itself and this
-- app never holds the key that can remove it, so deleting is done by hand by the operator; this table is the
-- queue. It belongs to a person, not a workspace, so it has no workspace_id: a person sees and changes only their
-- own row (app.user_id), and nothing else in the app reads it. It keeps the address only so the operator can find
-- the account; it is removed when the request is done.
CREATE TABLE account_deletion_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  email        text NOT NULL CHECK (char_length(email) <= 320),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  handled_at   timestamptz
);
CREATE UNIQUE INDEX account_deletion_open_key ON account_deletion_request (user_id) WHERE status = 'open';

ALTER TABLE account_deletion_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_request FORCE ROW LEVEL SECURITY;
CREATE POLICY own_request ON account_deletion_request
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
REVOKE ALL ON account_deletion_request FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON account_deletion_request TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON account_deletion_request FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE account_deletion_request;
