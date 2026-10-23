-- +goose Up
-- A weekly email to the team. Off until an admin turns it on, names the recipients and confirms
-- they agreed to receive it. Every email carries an unsubscribe link that stops it for that person.
CREATE TABLE digest_setting (
  workspace_id uuid PRIMARY KEY REFERENCES workspace (id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  weekday      smallint NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  hour_utc     smallint NOT NULL DEFAULT 9 CHECK (hour_utc BETWEEN 0 AND 23),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE digest_recipient (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  email           text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 320),
  unsubscribed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, email)
);

-- One row per (week, person): claiming it before sending is what prevents a second email.
CREATE TABLE digest_send (
  workspace_id        uuid NOT NULL,
  period_start        date NOT NULL,
  recipient_id        uuid NOT NULL,
  state               text NOT NULL CHECK (state IN ('sending', 'sent', 'failed', 'skipped')),
  attempts            int NOT NULL DEFAULT 1,
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_start, recipient_id),
  FOREIGN KEY (workspace_id, recipient_id) REFERENCES digest_recipient (workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE digest_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_setting FORCE ROW LEVEL SECURITY;
ALTER TABLE digest_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_recipient FORCE ROW LEVEL SECURITY;
ALTER TABLE digest_send ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_send FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON digest_setting USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON digest_recipient USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON digest_send USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON digest_setting, digest_recipient, digest_send FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON digest_setting, digest_recipient, digest_send TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON digest_setting, digest_recipient, digest_send FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- The scheduler runs outside any workspace and needs to know which workspaces have the digest on.
-- It learns only the id and the schedule.
-- +goose StatementBegin
CREATE FUNCTION digest_workspaces() RETURNS TABLE (workspace_id uuid, weekday int, hour_utc int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace_id, weekday::int, hour_utc::int FROM digest_setting WHERE enabled
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION digest_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION digest_workspaces() TO app_backend;

-- +goose Down
DROP FUNCTION digest_workspaces();
DROP TABLE digest_send;
DROP TABLE digest_recipient;
DROP TABLE digest_setting;
