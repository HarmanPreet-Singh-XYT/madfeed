-- +goose Up
-- A request can be linked to one issue in the workspace's issue tracker (GitHub). The link remembers what
-- the issue's state last was and which of our statuses it last caused, so a change made here in the
-- meantime is reported as a conflict instead of being overwritten.
CREATE TABLE request_issue (
  workspace_id          uuid NOT NULL,
  request_id            uuid NOT NULL,
  repo                  text NOT NULL CHECK (char_length(repo) <= 201),
  issue_number          int  NOT NULL CHECK (issue_number > 0),
  issue_url             text NOT NULL CHECK (char_length(issue_url) <= 500),
  issue_state           text NOT NULL DEFAULT 'open' CHECK (issue_state IN ('open', 'closed', 'deleted')),
  last_event_at         timestamptz NOT NULL DEFAULT now(),
  last_synced_status_id uuid,           -- the request's status when the link last agreed with the issue
  pending_status_id     uuid,           -- the status the issue wants, held back by a conflict
  conflict              text NOT NULL DEFAULT '' CHECK (char_length(conflict) <= 300),
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE
);
-- An issue can follow one request in a workspace: events find the request by repository and number.
CREATE UNIQUE INDEX request_issue_issue_key ON request_issue (workspace_id, lower(repo), issue_number);

-- Deliveries already handled, so a notification sent twice (or replayed) is acted on once.
CREATE TABLE webhook_delivery (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  source       text NOT NULL CHECK (source IN ('github')),
  delivery_id  text NOT NULL CHECK (char_length(delivery_id) <= 100),
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source, delivery_id)
);

ALTER TABLE request_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_issue FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request_issue USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON webhook_delivery USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON request_issue, webhook_delivery FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON request_issue, webhook_delivery TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON request_issue, webhook_delivery FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE webhook_delivery;
DROP TABLE request_issue;
