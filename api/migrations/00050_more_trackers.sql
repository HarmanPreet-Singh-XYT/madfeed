-- +goose Up
-- Three more issue trackers (ClickUp, Asana, Azure DevOps), behind a common driver. Their issue ids are not
-- always numbers (ClickUp and Asana use text ids), so a link can carry a text reference next to the number.
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira', 'hubspot', 'clickup', 'asana', 'azuredevops'));

ALTER TABLE request_issue DROP CONSTRAINT request_issue_tracker_check;
ALTER TABLE request_issue ADD CONSTRAINT request_issue_tracker_check CHECK (tracker IN ('github', 'linear', 'jira', 'clickup', 'asana', 'azuredevops'));
ALTER TABLE request_issue DROP CONSTRAINT request_issue_issue_number_check;
ALTER TABLE request_issue ADD CONSTRAINT request_issue_issue_number_check CHECK (issue_number >= 0);
ALTER TABLE request_issue ADD COLUMN issue_ref text NOT NULL DEFAULT '' CHECK (char_length(issue_ref) <= 100);
DROP INDEX request_issue_issue_key;
CREATE UNIQUE INDEX request_issue_issue_key ON request_issue (workspace_id, tracker, lower(repo), issue_number, issue_ref);

ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_source_check;
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_source_check CHECK (source IN ('github', 'linear', 'jira', 'clickup', 'asana', 'azuredevops'));

-- +goose Down
DELETE FROM webhook_delivery WHERE source IN ('clickup', 'asana', 'azuredevops');
ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_source_check;
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_source_check CHECK (source IN ('github', 'linear', 'jira'));
DELETE FROM request_issue WHERE tracker IN ('clickup', 'asana', 'azuredevops') OR issue_number = 0;
DROP INDEX request_issue_issue_key;
ALTER TABLE request_issue DROP COLUMN issue_ref;
CREATE UNIQUE INDEX request_issue_issue_key ON request_issue (workspace_id, tracker, lower(repo), issue_number);
ALTER TABLE request_issue DROP CONSTRAINT request_issue_issue_number_check;
ALTER TABLE request_issue ADD CONSTRAINT request_issue_issue_number_check CHECK (issue_number > 0);
ALTER TABLE request_issue DROP CONSTRAINT request_issue_tracker_check;
ALTER TABLE request_issue ADD CONSTRAINT request_issue_tracker_check CHECK (tracker IN ('github', 'linear', 'jira'));
DELETE FROM integration WHERE kind IN ('clickup', 'asana', 'azuredevops');
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear', 'jira', 'hubspot'));
