-- +goose Up
-- A third issue tracker choice: Jira Cloud. As with Linear, a workspace connects one tracker at a time; "repo" on a
-- request's link holds the Jira project key and the number is the issue's number in it (PROJ-123 is (PROJ, 123)).
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira'));
ALTER TABLE request_issue DROP CONSTRAINT request_issue_tracker_check;
ALTER TABLE request_issue ADD CONSTRAINT request_issue_tracker_check CHECK (tracker IN ('github', 'linear', 'jira'));
ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_source_check;
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_source_check CHECK (source IN ('github', 'linear', 'jira'));

-- +goose Down
DELETE FROM webhook_delivery WHERE source = 'jira';
ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_source_check;
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_source_check CHECK (source IN ('github', 'linear'));
DELETE FROM request_issue WHERE tracker = 'jira';
ALTER TABLE request_issue DROP CONSTRAINT request_issue_tracker_check;
ALTER TABLE request_issue ADD CONSTRAINT request_issue_tracker_check CHECK (tracker IN ('github', 'linear'));
DELETE FROM integration WHERE kind = 'jira';
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear'));
