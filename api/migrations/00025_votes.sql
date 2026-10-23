-- +goose Up
-- Public votes. A voter is a signed-in account (any account, not necessarily a member of the
-- workspace); one vote per account per request. Only requests marked public can be voted on.
CREATE TABLE request_vote (
  workspace_id uuid NOT NULL,
  request_id   uuid NOT NULL,
  voter_id     uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, voter_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX request_vote_ws_idx ON request_vote (workspace_id, request_id);
CREATE INDEX request_vote_voter_idx ON request_vote (voter_id, workspace_id);

ALTER TABLE request_vote ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_vote FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request_vote USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON request_vote FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON request_vote TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON request_vote FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- A voter can erase their votes everywhere. Votes sit in many workspaces, which row-level
-- security hides from any single one, so this runs as the owner. It deletes only rows whose
-- voter is the id given, and the API passes the caller's own id from their verified token.
-- +goose StatementBegin
CREATE FUNCTION erase_votes(p_voter uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM request_vote WHERE voter_id = p_voter;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION erase_votes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_votes(uuid) TO app_backend;

-- +goose Down
DROP FUNCTION erase_votes(uuid);
DROP TABLE request_vote;
