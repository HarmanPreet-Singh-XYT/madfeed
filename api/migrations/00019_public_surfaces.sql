-- +goose Up
-- Outward surfaces: an embeddable feedback form and a public roadmap.

-- The form: a public key (it sits in web pages, so it is an address, not a secret) and the
-- web origins allowed to post to it. No key means the form is off.
ALTER TABLE workspace ADD COLUMN form_key text UNIQUE CHECK (form_key IS NULL OR char_length(form_key) BETWEEN 32 AND 64);
ALTER TABLE workspace ADD COLUMN form_origins text[] NOT NULL DEFAULT '{}' CHECK (cardinality(form_origins) <= 10);

-- Nothing is public unless somebody turns it on for that one request; the summary is
-- written for the public and is the only free text a visitor ever sees.
ALTER TABLE request ADD COLUMN public boolean NOT NULL DEFAULT false;
ALTER TABLE request ADD COLUMN public_summary text NOT NULL DEFAULT '' CHECK (char_length(public_summary) <= 1000);
CREATE INDEX request_public_idx ON request (workspace_id, updated_at DESC) WHERE public;

-- Submissions arrive as source items of their own kind. The address is kept only so the
-- submitter can be erased on request; it is never matched to a person record.
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording', 'form'));
ALTER TABLE source_item ADD COLUMN submitter_email text CHECK (submitter_email IS NULL OR (submitter_email = lower(submitter_email) AND char_length(submitter_email) <= 320));
CREATE INDEX source_item_submitter_idx ON source_item (workspace_id, submitter_email) WHERE submitter_email IS NOT NULL;

-- Resolve a public address to the form's settings without any tenant context.
-- +goose StatementBegin
CREATE FUNCTION form_config(p_slug text) RETURNS TABLE (workspace_id uuid, form_key text, origins text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, form_key, form_origins FROM workspace WHERE public_slug = p_slug AND form_key IS NOT NULL
$$;
-- +goose StatementEnd
REVOKE EXECUTE ON FUNCTION form_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION form_config(text) TO app_backend;

-- +goose Down
DROP FUNCTION form_config(text);
DROP INDEX source_item_submitter_idx;
ALTER TABLE source_item DROP COLUMN submitter_email;
DELETE FROM source_item WHERE kind = 'form';
ALTER TABLE source_item DROP CONSTRAINT source_item_kind_check;
ALTER TABLE source_item ADD CONSTRAINT source_item_kind_check CHECK (kind IN ('paste', 'recording'));
DROP INDEX request_public_idx;
ALTER TABLE request DROP COLUMN public_summary;
ALTER TABLE request DROP COLUMN public;
ALTER TABLE workspace DROP COLUMN form_origins;
ALTER TABLE workspace DROP COLUMN form_key;
