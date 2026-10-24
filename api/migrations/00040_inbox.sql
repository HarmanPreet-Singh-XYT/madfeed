-- +goose Up
-- Phase 9: a shared inbox for conversations that arrive by website chat or by email, replies from the team,
-- and turning a customer's message into feedback for the review queue.

CREATE TABLE inbox_setting (
  workspace_id  uuid PRIMARY KEY REFERENCES workspace (id) ON DELETE CASCADE,
  chat_enabled  boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT false,
  origins       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(origins) <= 10),
  greeting      text NOT NULL DEFAULT '' CHECK (char_length(greeting) <= 300),
  -- the chat widget's address and the inbound email signing key are both derived from the server's secret and
  -- these numbers; raising one ends every earlier copy at once
  widget_epoch  int NOT NULL DEFAULT 0 CHECK (widget_epoch >= 0),
  inbound_epoch int NOT NULL DEFAULT 0 CHECK (inbound_epoch >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('chat', 'email')),
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  subject          text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 200),
  customer_name    text NOT NULL DEFAULT '' CHECK (char_length(customer_name) <= 200),
  customer_email   text CHECK (customer_email IS NULL OR (customer_email = lower(customer_email) AND char_length(customer_email) <= 320)),
  person_id        uuid,
  assignee         uuid,
  -- a chat visitor's browser id (kept so they can pick the conversation up again); null for email
  visitor_key      text CHECK (visitor_key IS NULL OR char_length(visitor_key) BETWEEN 16 AND 64),
  -- a short code in the subject of email replies, so an answer from the customer finds its conversation
  ref              text NOT NULL CHECK (char_length(ref) BETWEEN 6 AND 12),
  message_count    int  NOT NULL DEFAULT 0,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, ref),
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id) ON DELETE SET NULL (person_id)
);
CREATE UNIQUE INDEX conversation_visitor_key ON conversation (workspace_id, visitor_key) WHERE visitor_key IS NOT NULL;
CREATE INDEX conversation_list_idx ON conversation (workspace_id, state, last_message_at DESC, id DESC);
CREATE INDEX conversation_email_idx ON conversation (workspace_id, customer_email) WHERE customer_email IS NOT NULL;

CREATE TABLE conversation_message (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  conversation_id     uuid NOT NULL,
  seq                 int  NOT NULL CHECK (seq >= 1),
  -- 'in' from the customer, 'out' a reply from the team, 'note' for the team only
  direction           text NOT NULL CHECK (direction IN ('in', 'out', 'note')),
  body                text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  author_id           uuid,
  -- replies by email go through 'queued' and 'sending'; everything else is 'sent' or 'received' at once
  state               text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'noted', 'queued', 'sending', 'sent', 'failed')),
  -- the outside id of an incoming email, so the same email arriving twice is stored once
  external_id         text CHECK (external_id IS NULL OR char_length(external_id) <= 300),
  provider_message_id text,
  last_error          text CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  attempts            int  NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (conversation_id, seq),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation (workspace_id, id) ON DELETE CASCADE,
  CHECK (direction <> 'out' OR author_id IS NOT NULL),
  CHECK (direction <> 'note' OR author_id IS NOT NULL)
);
CREATE UNIQUE INDEX conversation_message_external_key ON conversation_message (workspace_id, external_id) WHERE external_id IS NOT NULL;

-- A customer message sent on to the review queue as feedback.
CREATE TABLE conversation_link (
  workspace_id    uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id      uuid NOT NULL,
  source_item_id  uuid NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES conversation_message (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_item (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX conversation_link_conv_idx ON conversation_link (workspace_id, conversation_id);

ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api', 'chat', 'survey', 'support'));

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inbox_setting', 'conversation', 'conversation_message', 'conversation_link'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_backend', t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DELETE FROM source_item WHERE kind = 'support';
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form', 'api', 'chat', 'survey'));
DROP TABLE conversation_link;
DROP TABLE conversation_message;
DROP TABLE conversation;
DROP TABLE inbox_setting;
