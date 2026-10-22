-- +goose Up

-- One current decision brief per request. The model writes only the claim, the
-- choice of quotes (by evidence id) and what would disprove it. Everything
-- factual (counts, accounts, value, dates) is computed from the database when
-- the brief is read, so it cannot be invented and is never out of date.
CREATE TABLE brief (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  request_id         uuid NOT NULL UNIQUE,
  state              text NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
  claim              text CHECK (claim IS NULL OR char_length(claim) <= 600),
  disproof           text CHECK (disproof IS NULL OR char_length(disproof) <= 600),
  quote_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  evidence_fingerprint text,
  low_evidence       boolean NOT NULL DEFAULT false,
  prompt_version     text,
  provider           text,
  model              text,
  failure_reason     text,
  requested_by       uuid NOT NULL,
  generated_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX brief_ws_updated_idx ON brief (workspace_id, updated_at DESC);

ALTER TABLE brief ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brief USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON brief FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON brief FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON brief TO app_backend;

-- +goose Down
DROP TABLE brief;
