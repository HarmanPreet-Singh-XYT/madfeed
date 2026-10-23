-- +goose Up

-- A weekly spot check: a few AI answers and briefs per workspace are put in
-- front of an admin, who says whether the quotes really support what was
-- claimed. Quality is something to measure on live data, not only before release.
CREATE TABLE audit_sample (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('answer', 'brief')),
  ref_id       uuid NOT NULL,  -- the answer's id, or the brief's request id
  sampled_at   timestamptz NOT NULL DEFAULT now(),
  verdict      text CHECK (verdict IN ('supported', 'not_supported')),
  note         text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, kind, ref_id),
  CHECK ((verdict IS NULL) = (reviewed_at IS NULL))
);
CREATE INDEX audit_sample_ws_idx ON audit_sample (workspace_id, sampled_at DESC);

ALTER TABLE audit_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_sample FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_sample USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE ALL ON audit_sample FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_sample TO app_backend;
-- +goose StatementBegin
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON audit_sample FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- +goose StatementEnd

-- Picks the week's samples across all workspaces from the worker. For each
-- workspace it tops the last seven days up to p_per_week randomly chosen,
-- not-yet-sampled, recent answers and briefs. Returns how many it added.
-- +goose StatementBegin
CREATE FUNCTION sample_for_audit(p_per_week int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE added int := 0; w record; need int; n int;
BEGIN
  IF p_per_week < 1 OR p_per_week > 20 THEN RAISE EXCEPTION 'bad sample size'; END IF;
  FOR w IN SELECT id FROM workspace LOOP
    SELECT p_per_week - count(*) INTO need FROM audit_sample WHERE workspace_id = w.id AND sampled_at > now() - interval '7 days';
    IF need <= 0 THEN CONTINUE; END IF;
    WITH candidates AS (
      SELECT 'answer'::text AS kind, a.id AS ref_id FROM qa_answer a
        WHERE a.workspace_id = w.id AND a.outcome = 'answered' AND a.created_at > now() - interval '14 days'
          AND NOT EXISTS (SELECT 1 FROM audit_sample s WHERE s.workspace_id = a.workspace_id AND s.kind = 'answer' AND s.ref_id = a.id)
      UNION ALL
      SELECT 'brief', b.request_id FROM brief b
        WHERE b.workspace_id = w.id AND b.state = 'ready' AND b.generated_at > now() - interval '14 days'
          AND NOT EXISTS (SELECT 1 FROM audit_sample s WHERE s.workspace_id = b.workspace_id AND s.kind = 'brief' AND s.ref_id = b.request_id)
    ), chosen AS (SELECT * FROM candidates ORDER BY random() LIMIT need)
    INSERT INTO audit_sample (workspace_id, kind, ref_id) SELECT w.id, kind, ref_id FROM chosen;
    GET DIAGNOSTICS n = ROW_COUNT;
    added := added + n;
  END LOOP;
  RETURN added;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION sample_for_audit(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sample_for_audit(int) TO app_backend;

-- +goose Down
DROP FUNCTION sample_for_audit(int);
DROP TABLE audit_sample;
