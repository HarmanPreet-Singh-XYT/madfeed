-- +goose Up

-- Accounts (customer companies) with the value fields used to weight requests.
CREATE TABLE account (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  domain       text CHECK (domain IS NULL OR char_length(domain) <= 253),
  revenue      numeric(14, 2) CHECK (revenue IS NULL OR revenue >= 0),
  plan         text CHECK (plan IS NULL OR char_length(plan) <= 100),
  renewal_date date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX account_ws_name_key ON account (workspace_id, lower(name));

ALTER TABLE person ADD COLUMN account_id uuid;
ALTER TABLE person ADD FOREIGN KEY (workspace_id, account_id) REFERENCES account (workspace_id, id) ON DELETE SET NULL (account_id);
CREATE INDEX person_ws_account_idx ON person (workspace_id, account_id);
CREATE INDEX person_ws_name_idx ON person (workspace_id, lower(name), id);
CREATE INDEX account_ws_name_idx ON account (workspace_id, lower(name), id);

-- Did a person change the suggestion before accepting it? Feeds the quality panel.
ALTER TABLE proposal ADD COLUMN edited boolean NOT NULL DEFAULT false;

ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON account FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON account FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON account TO app_backend;

-- +goose Down
ALTER TABLE proposal DROP COLUMN edited;
ALTER TABLE person DROP COLUMN account_id;
DROP TABLE account;
