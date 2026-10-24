-- +goose Up
-- Outbound webhooks can speak the message format of a chat tool, so a channel can be notified directly
-- ("json" is the signed envelope for programs).
ALTER TABLE outbound_endpoint ADD COLUMN format text NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'slack', 'discord', 'teams'));

-- +goose Down
ALTER TABLE outbound_endpoint DROP COLUMN format;
