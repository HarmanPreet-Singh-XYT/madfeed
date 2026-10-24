-- +goose Up
-- A second issue tracker. A workspace connects one tracker at a time (GitHub or Linear); a request's link
-- says which one made it. For Linear, "repo" holds the team key (for example ENG) and the number is the
-- issue's number in that team, so ENG-123 is (ENG, 123).
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github', 'linear'));

ALTER TABLE request_issue ADD COLUMN tracker text NOT NULL DEFAULT 'github' CHECK (tracker IN ('github', 'linear'));
DROP INDEX request_issue_issue_key;
CREATE UNIQUE INDEX request_issue_issue_key ON request_issue (workspace_id, tracker, lower(repo), issue_number);

ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_source_check;
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_source_check CHECK (source IN ('github', 'linear'));

-- +goose Down
ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_source_check;
DELETE FROM webhook_delivery WHERE source = 'linear';
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_source_check CHECK (source IN ('github'));
DELETE FROM request_issue WHERE tracker = 'linear';
DROP INDEX request_issue_issue_key;
CREATE UNIQUE INDEX request_issue_issue_key ON request_issue (workspace_id, lower(repo), issue_number);
ALTER TABLE request_issue DROP COLUMN tracker;
DELETE FROM integration WHERE kind = 'linear';
ALTER TABLE integration DROP CONSTRAINT integration_kind_check;
ALTER TABLE integration ADD CONSTRAINT integration_kind_check CHECK (kind IN ('slack', 'github'));
