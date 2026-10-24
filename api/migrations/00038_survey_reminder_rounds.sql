-- +goose Up
-- More than one reminder per invitation, spaced apart and capped: how many have gone out, and when the last did.
ALTER TABLE survey_invite ADD COLUMN reminder_count int NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 10);
UPDATE survey_invite SET reminder_count = 1, reminder_state = NULL WHERE reminder_state = 'sent';

-- +goose Down
ALTER TABLE survey_invite DROP COLUMN reminder_count;
