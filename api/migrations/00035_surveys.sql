-- +goose Up
-- Surveys: a few questions (rating, choice, free text), an audience, delivery by personal email link or a public
-- link, and responses. Free-text answers also become a source item so the usual review queue turns them into
-- cited evidence.

CREATE TABLE survey (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  intro            text NOT NULL DEFAULT '' CHECK (char_length(intro) <= 2000),
  thank_you        text NOT NULL DEFAULT '' CHECK (char_length(thank_you) <= 1000),
  state            text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'closed')),
  -- who it is for (a rule tree, see internal/audience); empty until chosen
  audience         jsonb,
  -- 'invited': only people who got a personal link; 'open': anyone with the public link
  delivery         text NOT NULL DEFAULT 'invited' CHECK (delivery IN ('invited', 'open')),
  -- the public link is signed over this number; raising it retires every earlier copy of the link
  link_epoch       int NOT NULL DEFAULT 0 CHECK (link_epoch >= 0),
  -- what happens to someone's answers when that person is deleted
  on_person_delete text NOT NULL DEFAULT 'remove' CHECK (on_person_delete IN ('remove', 'anonymise')),
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  opened_at        timestamptz,
  closed_at        timestamptz,
  UNIQUE (workspace_id, id)
);
CREATE INDEX survey_ws_idx ON survey (workspace_id, created_at DESC);

CREATE TABLE survey_question (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  survey_id    uuid NOT NULL,
  ordinal      int  NOT NULL CHECK (ordinal BETWEEN 0 AND 29),
  kind         text NOT NULL CHECK (kind IN ('nps', 'csat', 'choice', 'text')),
  prompt       text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 300),
  required     boolean NOT NULL DEFAULT false,
  options      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(options) <= 10),
  UNIQUE (workspace_id, id),
  UNIQUE (survey_id, ordinal),
  FOREIGN KEY (workspace_id, survey_id) REFERENCES survey (workspace_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'choice') = (cardinality(options) >= 2))
);

-- One row per person asked. A person is asked a survey once.
CREATE TABLE survey_invite (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  survey_id           uuid NOT NULL,
  person_id           uuid NOT NULL,
  to_email            text NOT NULL CHECK (char_length(to_email) <= 320),
  state               text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved', 'sending', 'sent', 'failed', 'suppressed', 'excluded')),
  approved_by         uuid,
  approved_at         timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  attempts            int NOT NULL DEFAULT 0,
  last_error_class    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (survey_id, person_id),
  FOREIGN KEY (workspace_id, survey_id) REFERENCES survey (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id),
  -- Nothing is approved, being sent or sent without a person having approved it.
  CHECK (state NOT IN ('approved', 'sending', 'sent') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX survey_invite_state_idx ON survey_invite (workspace_id, survey_id, state);

CREATE TABLE survey_response (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  survey_id      uuid NOT NULL,
  invite_id      uuid,
  person_id      uuid,
  respondent_key text CHECK (respondent_key IS NULL OR char_length(respondent_key) BETWEEN 16 AND 64),
  state          text NOT NULL DEFAULT 'partial' CHECK (state IN ('partial', 'complete')),
  source_item_id uuid,
  started_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, survey_id) REFERENCES survey (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, invite_id) REFERENCES survey_invite (workspace_id, id) ON DELETE SET NULL (invite_id),
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id) ON DELETE SET NULL (person_id),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE SET NULL (source_item_id),
  CHECK (state <> 'complete' OR submitted_at IS NOT NULL)
);
-- One response per invitation, and one per browser on a public link.
CREATE UNIQUE INDEX survey_response_invite_key ON survey_response (survey_id, invite_id) WHERE invite_id IS NOT NULL;
CREATE UNIQUE INDEX survey_response_respondent_key ON survey_response (survey_id, respondent_key) WHERE respondent_key IS NOT NULL;
CREATE INDEX survey_response_person_idx ON survey_response (workspace_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX survey_response_ws_idx ON survey_response (workspace_id, survey_id, state);

CREATE TABLE survey_answer (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  response_id  uuid NOT NULL,
  question_id  uuid NOT NULL,
  value_num    int,
  value_choice text CHECK (value_choice IS NULL OR char_length(value_choice) <= 200),
  value_text   text CHECK (value_text IS NULL OR char_length(value_text) BETWEEN 1 AND 2000),
  UNIQUE (response_id, question_id),
  FOREIGN KEY (workspace_id, response_id) REFERENCES survey_response (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, question_id) REFERENCES survey_question (workspace_id, id) ON DELETE CASCADE,
  CHECK ((value_num IS NOT NULL)::int + (value_choice IS NOT NULL)::int + (value_text IS NOT NULL)::int = 1)
);

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey', 'survey_question', 'survey_invite', 'survey_response', 'survey_answer'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_backend', t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- Free-text answers become source items of their own kind.
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api', 'chat', 'survey'));

-- +goose Down
DELETE FROM source_item WHERE kind = 'survey';
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api', 'chat'));
DROP TABLE survey_answer;
DROP TABLE survey_response;
DROP TABLE survey_invite;
DROP TABLE survey_question;
DROP TABLE survey;
