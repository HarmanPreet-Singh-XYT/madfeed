-- +goose Up
-- A question can be shown only when an earlier answer says so: {"question": <position>, "op": "eq|lte|gte|ne", "value": ...}.
ALTER TABLE survey_question ADD COLUMN show_if jsonb;

-- People with no email address can still be asked: their personal link is handed over by the owner
-- ('manual'). Nothing is ever sent for these.
ALTER TABLE survey_invite DROP CONSTRAINT survey_invite_state_check;
ALTER TABLE survey_invite ADD CONSTRAINT survey_invite_state_check CHECK (state IN ('draft', 'approved', 'sending', 'sent', 'failed', 'suppressed', 'excluded', 'manual'));

-- +goose Down
DELETE FROM survey_invite WHERE state = 'manual';
ALTER TABLE survey_invite DROP CONSTRAINT survey_invite_state_check;
ALTER TABLE survey_invite ADD CONSTRAINT survey_invite_state_check CHECK (state IN ('draft', 'approved', 'sending', 'sent', 'failed', 'suppressed', 'excluded'));
ALTER TABLE survey_question DROP COLUMN show_if;
