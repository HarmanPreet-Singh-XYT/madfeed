-- +goose Up

-- ---------------------------------------------------------------- statuses
CREATE TABLE status (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- 'done' means shipped: moving a request into it starts the loop-closing flow.
  bucket       text NOT NULL CHECK (bucket IN ('open', 'active', 'done', 'closed')),
  position     int  NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX status_ws_name_key ON status (workspace_id, lower(name));

-- +goose StatementBegin
CREATE FUNCTION seed_default_statuses(p_ws uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO status (workspace_id, name, bucket, position) VALUES
    (p_ws, 'New', 'open', 0), (p_ws, 'Planned', 'active', 1), (p_ws, 'In progress', 'active', 2),
    (p_ws, 'Shipped', 'done', 3), (p_ws, 'Won''t do', 'closed', 4)
  ON CONFLICT DO NOTHING;
$$;
CREATE FUNCTION workspace_seed_statuses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_default_statuses(NEW.id);
  RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER workspace_statuses AFTER INSERT ON workspace FOR EACH ROW EXECUTE FUNCTION workspace_seed_statuses();

-- Existing workspaces get the defaults too.
SELECT seed_default_statuses(id) FROM workspace;

ALTER TABLE request ADD COLUMN status_id uuid;
UPDATE request r SET status_id = (SELECT s.id FROM status s WHERE s.workspace_id = r.workspace_id AND s.bucket = 'open' ORDER BY s.position LIMIT 1);
ALTER TABLE request ALTER COLUMN status_id SET NOT NULL;
ALTER TABLE request ADD FOREIGN KEY (workspace_id, status_id) REFERENCES status (workspace_id, id);
CREATE INDEX request_ws_status_idx ON request (workspace_id, status_id);

-- A new request starts in the workspace's first "open" status.
-- +goose StatementBegin
CREATE FUNCTION request_default_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_id IS NULL THEN
    SELECT id INTO NEW.status_id FROM status WHERE workspace_id = NEW.workspace_id AND bucket = 'open' ORDER BY position LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER request_status_default BEFORE INSERT ON request FOR EACH ROW EXECUTE FUNCTION request_default_status();

-- ------------------------------------------------- workspace public identity
ALTER TABLE workspace ADD COLUMN public_slug text CHECK (public_slug IS NULL OR public_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');
ALTER TABLE workspace ADD COLUMN sender_name text NOT NULL DEFAULT '' CHECK (char_length(sender_name) <= 100);
CREATE UNIQUE INDEX workspace_public_slug_key ON workspace (public_slug) WHERE public_slug IS NOT NULL;

-- Lets the public release pages find a workspace by its slug without any
-- tenant context. Returns only the id; runs with the owner's rights.
-- +goose StatementBegin
CREATE FUNCTION public_workspace_id(p_slug text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM workspace WHERE public_slug = p_slug
$$;
-- +goose StatementEnd
REVOKE EXECUTE ON FUNCTION public_workspace_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_workspace_id(text) TO app_backend;

-- --------------------------------------------------------------- suppression
-- People who must not be emailed again, whatever else happens.
CREATE TABLE suppression (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 320),
  reason       text NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);

-- ------------------------------------------------------------ release notes
CREATE TABLE release_note (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'scheduled', 'published', 'unpublished')),
  scheduled_for timestamptz,
  published_at  timestamptz,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (state <> 'scheduled' OR scheduled_for IS NOT NULL)
);
CREATE INDEX release_note_ws_idx ON release_note (workspace_id, state, published_at DESC);

CREATE TABLE release_note_request (
  workspace_id    uuid NOT NULL,
  release_note_id uuid NOT NULL,
  request_id      uuid NOT NULL,
  PRIMARY KEY (release_note_id, request_id),
  FOREIGN KEY (workspace_id, release_note_id) REFERENCES release_note (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX release_note_request_req_idx ON release_note_request (workspace_id, request_id);

-- ------------------------------------------------------------ loop closing
-- One batch of personal messages when a request ships.
CREATE TABLE outreach_batch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  request_id      uuid NOT NULL,
  release_note_id uuid,
  state           text NOT NULL DEFAULT 'drafting' CHECK (state IN ('drafting', 'review', 'approved', 'done', 'cancelled')),
  created_by      uuid NOT NULL,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, release_note_id) REFERENCES release_note (workspace_id, id) ON DELETE SET NULL (release_note_id)
);
-- Replaying "shipped" never creates a second open batch for the same request.
CREATE UNIQUE INDEX outreach_batch_one_open ON outreach_batch (request_id) WHERE state IN ('drafting', 'review', 'approved');

CREATE TABLE outreach_message (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  batch_id           uuid NOT NULL,
  request_id         uuid NOT NULL,
  person_id          uuid NOT NULL,
  to_email           text NOT NULL CHECK (char_length(to_email) <= 320),
  evidence_ids       uuid[] NOT NULL DEFAULT '{}',
  state              text NOT NULL DEFAULT 'drafting' CHECK (state IN ('drafting', 'draft', 'approved', 'sending', 'sent', 'failed', 'excluded', 'suppressed')),
  subject            text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 200),
  body               text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  generated_subject  text NOT NULL DEFAULT '',
  generated_body     text NOT NULL DEFAULT '',
  drafted_by         text CHECK (drafted_by IS NULL OR drafted_by IN ('model', 'fallback')),
  approved_by        uuid,
  approved_at        timestamptz,
  sent_at            timestamptz,
  provider_message_id text,
  attempts           int NOT NULL DEFAULT 0,
  last_error_class   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  -- A person is told about a request once, ever, whatever happens to batches.
  UNIQUE (request_id, person_id),
  FOREIGN KEY (workspace_id, batch_id) REFERENCES outreach_batch (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, request_id) REFERENCES request (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, person_id) REFERENCES person (workspace_id, id),
  -- A message that has been approved or sent always has an approver and a time.
  CHECK (state NOT IN ('approved', 'sending', 'sent') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX outreach_message_batch_idx ON outreach_message (workspace_id, batch_id, state);

ALTER TABLE status                ENABLE ROW LEVEL SECURITY; ALTER TABLE status                FORCE ROW LEVEL SECURITY;
ALTER TABLE suppression           ENABLE ROW LEVEL SECURITY; ALTER TABLE suppression           FORCE ROW LEVEL SECURITY;
ALTER TABLE release_note          ENABLE ROW LEVEL SECURITY; ALTER TABLE release_note          FORCE ROW LEVEL SECURITY;
ALTER TABLE release_note_request  ENABLE ROW LEVEL SECURITY; ALTER TABLE release_note_request  FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach_batch        ENABLE ROW LEVEL SECURITY; ALTER TABLE outreach_batch        FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach_message      ENABLE ROW LEVEL SECURITY; ALTER TABLE outreach_message      FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON status               USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON suppression          USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON release_note         USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON release_note_request USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON outreach_batch       USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant_isolation ON outreach_message     USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON status, suppression, release_note, release_note_request, outreach_batch, outreach_message FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public_workspace_id(text), seed_default_statuses(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON status, suppression, release_note, release_note_request, outreach_batch, outreach_message FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON status, suppression, release_note, release_note_request, outreach_batch, outreach_message TO app_backend;
REVOKE EXECUTE ON FUNCTION seed_default_statuses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_default_statuses(uuid) TO app_backend;

-- +goose Down
DROP TABLE outreach_message;
DROP TABLE outreach_batch;
DROP TABLE release_note_request;
DROP TABLE release_note;
DROP TABLE suppression;
DROP FUNCTION public_workspace_id(text);
ALTER TABLE workspace DROP COLUMN sender_name;
ALTER TABLE workspace DROP COLUMN public_slug;
DROP TRIGGER request_status_default ON request;
DROP FUNCTION request_default_status();
ALTER TABLE request DROP COLUMN status_id;
DROP TRIGGER workspace_statuses ON workspace;
DROP FUNCTION workspace_seed_statuses();
DROP FUNCTION seed_default_statuses(uuid);
DROP TABLE status;
