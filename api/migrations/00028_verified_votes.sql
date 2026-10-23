-- +goose Up
-- Verified votes. A vote can be tied to a real customer in two ways: the voter's confirmed email
-- matches someone in the workspace's people directory, or the company's own app vouched for the
-- voter with a link signed with the workspace's voting secret.
ALTER TABLE workspace ADD COLUMN vote_secret text CHECK (vote_secret IS NULL OR char_length(vote_secret) = 64);

ALTER TABLE request_vote ADD COLUMN person_id uuid;
ALTER TABLE request_vote ADD COLUMN verified_via text CHECK (verified_via IN ('email', 'signed'));
ALTER TABLE request_vote ADD CONSTRAINT vote_person_needs_via CHECK (person_id IS NULL OR verified_via IS NOT NULL);
-- Deleting a person deletes their votes with them.
ALTER TABLE request_vote ADD FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id) ON DELETE CASCADE;
-- One customer, one vote per request, however many accounts or links they use.
CREATE UNIQUE INDEX request_vote_person_key ON request_vote (request_id, person_id) WHERE person_id IS NOT NULL;

-- +goose Down
DROP INDEX request_vote_person_key;
ALTER TABLE request_vote DROP COLUMN verified_via;
ALTER TABLE request_vote DROP COLUMN person_id;
ALTER TABLE workspace DROP COLUMN vote_secret;
