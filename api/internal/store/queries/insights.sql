-- name: ListQuotes :many
-- Every stored quote (evidence and highlights), with filters and a chosen order. Each half is limited on its own
-- before the two are merged, so a page costs the same however many quotes there are. `desc` false means oldest first,
-- and the cursor compares in the same direction so paging works either way.
WITH ev AS (
  SELECT 'evidence'::text AS kind, e.id, e.created_at, e.quote_text, e.source_item_id, s.title AS source_title, s.kind AS source_kind,
         e.request_id, coalesce(r.title, '')::text AS request_title, coalesce(sent.label, '')::text AS sentiment, coalesce(sent.source, '')::text AS sentiment_source,
         coalesce(p.name, '')::text AS person_name, coalesce(a.name, '')::text AS account_name
  FROM evidence e
  JOIN source_item s ON s.workspace_id = e.workspace_id AND s.id = e.source_item_id
  LEFT JOIN request r ON r.workspace_id = e.workspace_id AND r.id = e.request_id
  LEFT JOIN person p ON p.workspace_id = s.workspace_id AND p.id = s.person_id
  LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
  LEFT JOIN LATERAL (SELECT x.label, x.source FROM quote_sentiment x WHERE x.evidence_id = e.id ORDER BY (x.source = 'human') DESC LIMIT 1) sent ON true
  WHERE e.workspace_id = $1 AND sqlc.arg(kind)::text IN ('', 'evidence')
    AND (sqlc.narg(tag_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM request_tag rt WHERE rt.workspace_id = e.workspace_id AND rt.request_id = e.request_id AND rt.tag_id = sqlc.narg(tag_id)))
    AND (sqlc.narg(sentiment)::text IS NULL OR coalesce(sent.label, 'none') = sqlc.narg(sentiment))
    AND (sqlc.narg(source_kind)::text IS NULL OR s.kind = sqlc.narg(source_kind))
    AND (sqlc.narg(search)::text IS NULL OR to_tsvector('english', e.quote_text) @@ to_tsquery('english', sqlc.narg(search)))
    AND (sqlc.narg(since)::timestamptz IS NULL OR e.created_at >= sqlc.narg(since)::timestamptz)
    AND (sqlc.narg(before)::timestamptz IS NULL OR e.created_at < sqlc.narg(before)::timestamptz)
    AND (sqlc.narg(person_id)::uuid IS NULL OR s.person_id = sqlc.narg(person_id))
    AND (sqlc.narg(account_id)::uuid IS NULL OR p.account_id = sqlc.narg(account_id))
    AND (sqlc.narg(after_created)::timestamptz IS NULL OR
         (CASE WHEN sqlc.arg(descending)::bool
            THEN (e.created_at, e.id) < (sqlc.narg(after_created)::timestamptz, sqlc.narg(after_id)::uuid)
            ELSE (e.created_at, e.id) > (sqlc.narg(after_created)::timestamptz, sqlc.narg(after_id)::uuid)
          END))
  ORDER BY
    CASE WHEN sqlc.arg(descending)::bool THEN e.created_at END DESC,
    CASE WHEN sqlc.arg(descending)::bool THEN e.id END DESC,
    CASE WHEN NOT sqlc.arg(descending)::bool THEN e.created_at END ASC,
    CASE WHEN NOT sqlc.arg(descending)::bool THEN e.id END ASC
  LIMIT sqlc.arg(page_size)::int
), hl AS (
  SELECT 'highlight'::text AS kind, h.id, h.created_at, h.quote_text, h.source_item_id, s.title AS source_title, s.kind AS source_kind,
         '00000000-0000-0000-0000-000000000000'::uuid AS request_id, ''::text AS request_title, coalesce(sent.label, '')::text AS sentiment, coalesce(sent.source, '')::text AS sentiment_source,
         coalesce(p.name, '')::text AS person_name, coalesce(a.name, '')::text AS account_name
  FROM highlight h
  JOIN source_item s ON s.workspace_id = h.workspace_id AND s.id = h.source_item_id
  LEFT JOIN person p ON p.workspace_id = s.workspace_id AND p.id = s.person_id
  LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
  LEFT JOIN LATERAL (SELECT x.label, x.source FROM quote_sentiment x WHERE x.highlight_id = h.id ORDER BY (x.source = 'human') DESC LIMIT 1) sent ON true
  WHERE h.workspace_id = $1 AND sqlc.arg(kind)::text IN ('', 'highlight')
    AND (sqlc.narg(tag_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM highlight_tag ht WHERE ht.workspace_id = h.workspace_id AND ht.highlight_id = h.id AND ht.tag_id = sqlc.narg(tag_id)))
    AND (sqlc.narg(sentiment)::text IS NULL OR coalesce(sent.label, 'none') = sqlc.narg(sentiment))
    AND (sqlc.narg(source_kind)::text IS NULL OR s.kind = sqlc.narg(source_kind))
    AND (sqlc.narg(search)::text IS NULL OR to_tsvector('english', h.quote_text) @@ to_tsquery('english', sqlc.narg(search)))
    AND (sqlc.narg(since)::timestamptz IS NULL OR h.created_at >= sqlc.narg(since)::timestamptz)
    AND (sqlc.narg(before)::timestamptz IS NULL OR h.created_at < sqlc.narg(before)::timestamptz)
    AND (sqlc.narg(person_id)::uuid IS NULL OR s.person_id = sqlc.narg(person_id))
    AND (sqlc.narg(account_id)::uuid IS NULL OR p.account_id = sqlc.narg(account_id))
    AND (sqlc.narg(after_created)::timestamptz IS NULL OR
         (CASE WHEN sqlc.arg(descending)::bool
            THEN (h.created_at, h.id) < (sqlc.narg(after_created)::timestamptz, sqlc.narg(after_id)::uuid)
            ELSE (h.created_at, h.id) > (sqlc.narg(after_created)::timestamptz, sqlc.narg(after_id)::uuid)
          END))
  ORDER BY
    CASE WHEN sqlc.arg(descending)::bool THEN h.created_at END DESC,
    CASE WHEN sqlc.arg(descending)::bool THEN h.id END DESC,
    CASE WHEN NOT sqlc.arg(descending)::bool THEN h.created_at END ASC,
    CASE WHEN NOT sqlc.arg(descending)::bool THEN h.id END ASC
  LIMIT sqlc.arg(page_size)::int
)
SELECT * FROM (SELECT * FROM ev UNION ALL SELECT * FROM hl) u
ORDER BY
  CASE WHEN sqlc.arg(descending)::bool THEN created_at END DESC,
  CASE WHEN sqlc.arg(descending)::bool THEN id END DESC,
  CASE WHEN NOT sqlc.arg(descending)::bool THEN created_at END ASC,
  CASE WHEN NOT sqlc.arg(descending)::bool THEN id END ASC
LIMIT sqlc.arg(page_size)::int;

-- name: CountQuotes :one
-- How many quotes match the filters, for "128 quotes" above the list. No cursor and no limit.
SELECT count(*) FROM (
  SELECT 1 FROM evidence e
  JOIN source_item s ON s.workspace_id = e.workspace_id AND s.id = e.source_item_id
  LEFT JOIN person p ON p.workspace_id = s.workspace_id AND p.id = s.person_id
  LEFT JOIN LATERAL (SELECT x.label FROM quote_sentiment x WHERE x.evidence_id = e.id ORDER BY (x.source = 'human') DESC LIMIT 1) sent ON true
  WHERE e.workspace_id = $1 AND sqlc.arg(kind)::text IN ('', 'evidence')
    AND (sqlc.narg(tag_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM request_tag rt WHERE rt.workspace_id = e.workspace_id AND rt.request_id = e.request_id AND rt.tag_id = sqlc.narg(tag_id)))
    AND (sqlc.narg(sentiment)::text IS NULL OR coalesce(sent.label, 'none') = sqlc.narg(sentiment))
    AND (sqlc.narg(source_kind)::text IS NULL OR s.kind = sqlc.narg(source_kind))
    AND (sqlc.narg(search)::text IS NULL OR to_tsvector('english', e.quote_text) @@ to_tsquery('english', sqlc.narg(search)))
    AND (sqlc.narg(since)::timestamptz IS NULL OR e.created_at >= sqlc.narg(since)::timestamptz)
    AND (sqlc.narg(before)::timestamptz IS NULL OR e.created_at < sqlc.narg(before)::timestamptz)
    AND (sqlc.narg(person_id)::uuid IS NULL OR s.person_id = sqlc.narg(person_id))
    AND (sqlc.narg(account_id)::uuid IS NULL OR p.account_id = sqlc.narg(account_id))
  UNION ALL
  SELECT 1 FROM highlight h
  JOIN source_item s ON s.workspace_id = h.workspace_id AND s.id = h.source_item_id
  LEFT JOIN person p ON p.workspace_id = s.workspace_id AND p.id = s.person_id
  LEFT JOIN LATERAL (SELECT x.label FROM quote_sentiment x WHERE x.highlight_id = h.id ORDER BY (x.source = 'human') DESC LIMIT 1) sent ON true
  WHERE h.workspace_id = $1 AND sqlc.arg(kind)::text IN ('', 'highlight')
    AND (sqlc.narg(tag_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM highlight_tag ht WHERE ht.workspace_id = h.workspace_id AND ht.highlight_id = h.id AND ht.tag_id = sqlc.narg(tag_id)))
    AND (sqlc.narg(sentiment)::text IS NULL OR coalesce(sent.label, 'none') = sqlc.narg(sentiment))
    AND (sqlc.narg(source_kind)::text IS NULL OR s.kind = sqlc.narg(source_kind))
    AND (sqlc.narg(search)::text IS NULL OR to_tsvector('english', h.quote_text) @@ to_tsquery('english', sqlc.narg(search)))
    AND (sqlc.narg(since)::timestamptz IS NULL OR h.created_at >= sqlc.narg(since)::timestamptz)
    AND (sqlc.narg(before)::timestamptz IS NULL OR h.created_at < sqlc.narg(before)::timestamptz)
    AND (sqlc.narg(person_id)::uuid IS NULL OR s.person_id = sqlc.narg(person_id))
    AND (sqlc.narg(account_id)::uuid IS NULL OR p.account_id = sqlc.narg(account_id))
) u;

-- name: GetQuote :one
-- One quote by id, for the detail panel and a shareable link. `kind` may be empty to accept either.
WITH u AS (
  SELECT 'evidence'::text AS kind, e.id, e.created_at, e.quote_text, e.source_item_id, s.title AS source_title, s.kind AS source_kind,
         e.request_id, coalesce(r.title, '')::text AS request_title, coalesce(sent.label, '')::text AS sentiment, coalesce(sent.source, '')::text AS sentiment_source,
         coalesce(p.name, '')::text AS person_name, coalesce(a.name, '')::text AS account_name
  FROM evidence e
  JOIN source_item s ON s.workspace_id = e.workspace_id AND s.id = e.source_item_id
  LEFT JOIN request r ON r.workspace_id = e.workspace_id AND r.id = e.request_id
  LEFT JOIN person p ON p.workspace_id = s.workspace_id AND p.id = s.person_id
  LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
  LEFT JOIN LATERAL (SELECT x.label, x.source FROM quote_sentiment x WHERE x.evidence_id = e.id ORDER BY (x.source = 'human') DESC LIMIT 1) sent ON true
  WHERE e.workspace_id = $1 AND e.id = sqlc.arg(quote_id)::uuid AND sqlc.arg(kind)::text IN ('', 'evidence')
  UNION ALL
  SELECT 'highlight'::text, h.id, h.created_at, h.quote_text, h.source_item_id, s.title, s.kind,
         '00000000-0000-0000-0000-000000000000'::uuid, ''::text, coalesce(sent.label, '')::text, coalesce(sent.source, '')::text,
         coalesce(p.name, '')::text, coalesce(a.name, '')::text
  FROM highlight h
  JOIN source_item s ON s.workspace_id = h.workspace_id AND s.id = h.source_item_id
  LEFT JOIN person p ON p.workspace_id = s.workspace_id AND p.id = s.person_id
  LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
  LEFT JOIN LATERAL (SELECT x.label, x.source FROM quote_sentiment x WHERE x.highlight_id = h.id ORDER BY (x.source = 'human') DESC LIMIT 1) sent ON true
  WHERE h.workspace_id = $1 AND h.id = sqlc.arg(quote_id)::uuid AND sqlc.arg(kind)::text IN ('', 'highlight')
)
SELECT * FROM u LIMIT 1;

-- name: ListTagsForQuotes :many
SELECT 'highlight'::text AS kind, ht.highlight_id AS quote_id, t.id AS tag_id, t.name, t.color
FROM highlight_tag ht JOIN tag t ON t.workspace_id = ht.workspace_id AND t.id = ht.tag_id
WHERE ht.workspace_id = $1 AND ht.highlight_id = ANY (sqlc.arg(highlight_ids)::uuid[])
UNION ALL
SELECT 'evidence'::text, e.id, t.id, t.name, t.color
FROM evidence e JOIN request_tag rt ON rt.workspace_id = e.workspace_id AND rt.request_id = e.request_id
JOIN tag t ON t.workspace_id = rt.workspace_id AND t.id = rt.tag_id
WHERE e.workspace_id = $1 AND e.id = ANY (sqlc.arg(evidence_ids)::uuid[]);

-- name: TagTrends :many
-- Quotes per tag per week since a date, split by how they feel ('none' when nobody has said).
WITH tq AS (
  SELECT ht.tag_id, h.created_at,
         (SELECT x.label FROM quote_sentiment x WHERE x.highlight_id = h.id ORDER BY (x.source = 'human') DESC LIMIT 1) AS label
  FROM highlight h JOIN highlight_tag ht ON ht.workspace_id = h.workspace_id AND ht.highlight_id = h.id
  WHERE h.workspace_id = $1 AND h.created_at >= $2
  UNION ALL
  SELECT rt.tag_id, e.created_at,
         (SELECT x.label FROM quote_sentiment x WHERE x.evidence_id = e.id ORDER BY (x.source = 'human') DESC LIMIT 1)
  FROM evidence e JOIN request_tag rt ON rt.workspace_id = e.workspace_id AND rt.request_id = e.request_id
  WHERE e.workspace_id = $1 AND e.created_at >= $2
)
SELECT tag_id, (date_trunc('week', created_at))::date AS week, coalesce(label, 'none')::text AS label, count(*)::int AS n
FROM tq GROUP BY tag_id, week, label ORDER BY week, tag_id;

-- name: UnclassifiedQuotes :many
-- Quotes the model has not labelled yet. A quote a person already labelled still gets the model's label too: that
-- is how the two are compared.
SELECT * FROM (
  SELECT 'evidence'::text AS kind, e.id, e.quote_text, e.created_at FROM evidence e
  WHERE e.workspace_id = $1 AND NOT EXISTS (SELECT 1 FROM quote_sentiment x WHERE x.evidence_id = e.id AND x.source = 'model')
  UNION ALL
  SELECT 'highlight'::text, h.id, h.quote_text, h.created_at FROM highlight h
  WHERE h.workspace_id = $1 AND NOT EXISTS (SELECT 1 FROM quote_sentiment x WHERE x.highlight_id = h.id AND x.source = 'model')
) u ORDER BY created_at, id LIMIT sqlc.arg(max_rows)::int;

-- name: CountUnclassifiedQuotes :one
SELECT (
  (SELECT count(*) FROM evidence e WHERE e.workspace_id = $1 AND NOT EXISTS (SELECT 1 FROM quote_sentiment x WHERE x.evidence_id = e.id AND x.source = 'model')) +
  (SELECT count(*) FROM highlight h WHERE h.workspace_id = $1 AND NOT EXISTS (SELECT 1 FROM quote_sentiment x WHERE x.highlight_id = h.id AND x.source = 'model'))
)::int;

-- name: UpsertSentimentEvidence :exec
INSERT INTO quote_sentiment (workspace_id, evidence_id, source, label, model, prompt_version, set_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (evidence_id, source) WHERE evidence_id IS NOT NULL DO UPDATE SET label = EXCLUDED.label, model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version, set_by = EXCLUDED.set_by, created_at = now();

-- name: UpsertSentimentHighlight :exec
INSERT INTO quote_sentiment (workspace_id, highlight_id, source, label, model, prompt_version, set_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (highlight_id, source) WHERE highlight_id IS NOT NULL DO UPDATE SET label = EXCLUDED.label, model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version, set_by = EXCLUDED.set_by, created_at = now();

-- name: ClearHumanSentimentEvidence :exec
DELETE FROM quote_sentiment WHERE workspace_id = $1 AND evidence_id = $2 AND source = 'human';

-- name: ClearHumanSentimentHighlight :exec
DELETE FROM quote_sentiment WHERE workspace_id = $1 AND highlight_id = $2 AND source = 'human';

-- name: SentimentSample :many
-- Quotes for a person to label, in a fixed shuffled order (so everyone sees an unbiased mix, not the newest). The
-- model's label is deliberately not returned: a person should judge the words, not the model.
SELECT * FROM (
  SELECT 'evidence'::text AS kind, e.id, e.quote_text, md5(e.id::text || sqlc.arg(seed)::text) AS shuffle FROM evidence e
  WHERE e.workspace_id = $1 AND NOT EXISTS (SELECT 1 FROM quote_sentiment x WHERE x.evidence_id = e.id AND x.source = 'human')
  UNION ALL
  SELECT 'highlight'::text, h.id, h.quote_text, md5(h.id::text || sqlc.arg(seed)::text) FROM highlight h
  WHERE h.workspace_id = $1 AND NOT EXISTS (SELECT 1 FROM quote_sentiment x WHERE x.highlight_id = h.id AND x.source = 'human')
) u ORDER BY shuffle LIMIT sqlc.arg(max_rows)::int;

-- name: SentimentAgreement :many
-- Quotes labelled by both a person and the model: how often they agree, by pair.
SELECT hu.label AS human_label, mo.label AS model_label, count(*)::int AS n
FROM quote_sentiment hu JOIN quote_sentiment mo
  ON mo.workspace_id = hu.workspace_id AND mo.source = 'model'
 AND ((hu.evidence_id IS NOT NULL AND mo.evidence_id = hu.evidence_id) OR (hu.highlight_id IS NOT NULL AND mo.highlight_id = hu.highlight_id))
WHERE hu.workspace_id = $1 AND hu.source = 'human'
GROUP BY hu.label, mo.label;

-- name: CountHumanLabels :one
SELECT count(*)::int FROM quote_sentiment WHERE workspace_id = $1 AND source = 'human';
