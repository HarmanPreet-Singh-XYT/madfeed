-- +goose Up
-- One reminder per invitation, for people who have not answered. Same rule as the invitation: a person approves
-- it first, and the send step refuses anything that was not approved.
ALTER TABLE survey_invite
  ADD COLUMN reminder_state text CHECK (reminder_state IN ('approved', 'sending', 'sent', 'failed')),
  ADD COLUMN reminder_approved_by uuid,
  ADD COLUMN reminded_at timestamptz,
  ADD CONSTRAINT survey_invite_reminder_approved CHECK (reminder_state IS NULL OR reminder_state = 'failed' OR reminder_approved_by IS NOT NULL);

-- +goose Down
ALTER TABLE survey_invite DROP CONSTRAINT survey_invite_reminder_approved, DROP COLUMN reminded_at, DROP COLUMN reminder_approved_by, DROP COLUMN reminder_state;
