-- +goose Up
-- A fifth permission for keys and assistants: "write" lets one change a request's status (never into a shipped
-- status) and add tags. It is never part of the default. The activity log also learns two more kinds of action.
ALTER TABLE api_key DROP CONSTRAINT api_key_scopes_check;
ALTER TABLE api_key ADD CONSTRAINT api_key_scopes_check CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['requests', 'quotes', 'ask', 'submit', 'write']::text[]);
ALTER TABLE oauth_grant DROP CONSTRAINT oauth_grant_scopes_check;
ALTER TABLE oauth_grant ADD CONSTRAINT oauth_grant_scopes_check CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['requests', 'quotes', 'ask', 'submit', 'write']::text[]);
ALTER TABLE api_key_event DROP CONSTRAINT api_key_event_action_check;
ALTER TABLE api_key_event ADD CONSTRAINT api_key_event_action_check CHECK (action IN ('list', 'get', 'ask', 'submit', 'search', 'update'));

-- +goose Down
DELETE FROM api_key_event WHERE action IN ('search', 'update');
ALTER TABLE api_key_event DROP CONSTRAINT api_key_event_action_check;
ALTER TABLE api_key_event ADD CONSTRAINT api_key_event_action_check CHECK (action IN ('list', 'get', 'ask', 'submit'));
UPDATE api_key SET scopes = array_remove(scopes, 'write') WHERE 'write' = ANY (scopes);
DELETE FROM api_key WHERE cardinality(scopes) = 0;
DELETE FROM oauth_grant WHERE scopes = ARRAY['write']::text[];
UPDATE oauth_grant SET scopes = array_remove(scopes, 'write') WHERE 'write' = ANY (scopes);
ALTER TABLE oauth_grant DROP CONSTRAINT oauth_grant_scopes_check;
ALTER TABLE oauth_grant ADD CONSTRAINT oauth_grant_scopes_check CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['requests', 'quotes', 'ask', 'submit']::text[]);
ALTER TABLE api_key DROP CONSTRAINT api_key_scopes_check;
ALTER TABLE api_key ADD CONSTRAINT api_key_scopes_check CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['requests', 'quotes', 'ask', 'submit']::text[]);
