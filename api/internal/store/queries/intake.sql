-- name: CreatePerson :one
INSERT INTO person (workspace_id, name, email) VALUES ($1, $2, $3) RETURNING *;

-- name: InsertSourceItem :one
INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, person_id, origin_url, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (workspace_id, content_hash) DO NOTHING
RETURNING *;

-- name: GetSourceItemByHash :one
SELECT * FROM source_item WHERE workspace_id = $1 AND content_hash = $2;

-- name: GetSourceItem :one
SELECT * FROM source_item WHERE workspace_id = $1 AND id = $2;

-- name: SetSourceItemState :exec
UPDATE source_item SET processing_state = $3, failure_reason = $4 WHERE workspace_id = $1 AND id = $2;

-- name: InsertChunk :one
INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: ListChunks :many
SELECT * FROM chunk WHERE workspace_id = $1 AND source_item_id = $2 ORDER BY ordinal;

-- name: InsertProposal :execrows
INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence, rationale)
VALUES ($1, $2, $3, 'new_request', $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (source_item_id, span_start, span_end) DO NOTHING;

-- name: ListProposals :many
SELECT * FROM proposal
WHERE workspace_id = $1 AND state = $2
ORDER BY confidence DESC, created_at, id
LIMIT sqlc.arg(page_size)::int;

-- name: ListSuggestedAtOrAbove :many
SELECT id FROM proposal
WHERE workspace_id = $1 AND state = 'suggested' AND kind = 'new_request' AND confidence >= $2
ORDER BY confidence DESC, id
LIMIT sqlc.arg(page_size)::int;

-- name: GetProposalForUpdate :one
SELECT * FROM proposal WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: UpdateProposalTitle :execrows
UPDATE proposal SET title = $3, edited = true WHERE workspace_id = $1 AND id = $2 AND state = 'suggested';

-- name: MarkProposalAccepted :exec
UPDATE proposal SET state = 'accepted', request_id = $3, evidence_id = $4, created_request = $5, decided_by = $6, decided_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: MarkProposalDismissed :exec
UPDATE proposal SET state = 'dismissed', decided_by = $3, decided_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: ResetProposal :exec
UPDATE proposal SET state = 'suggested', request_id = NULL, evidence_id = NULL, created_request = false, decided_by = NULL, decided_at = NULL
WHERE workspace_id = $1 AND id = $2;

-- name: CreateMachineRequest :one
INSERT INTO request (workspace_id, title, created_via) VALUES ($1, $2, 'machine') RETURNING *;

-- name: InsertEvidence :one
INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, confidence, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: DeleteEvidence :execrows
DELETE FROM evidence WHERE workspace_id = $1 AND id = $2;

-- name: CountEvidenceForRequest :one
SELECT count(*) FROM evidence WHERE workspace_id = $1 AND request_id = $2;

-- name: ListEvidenceForRequest :many
SELECT * FROM evidence WHERE workspace_id = $1 AND request_id = $2 ORDER BY created_at DESC, id;

-- name: InsertAIEvent :exec
INSERT INTO ai_event (workspace_id, task, tier, provider, model, prompt_version, input_tokens, output_tokens, cached_input_tokens, cost_usd, latency_ms, outcome, error_class, subject_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);

-- name: SumIngestedBytesSince :one
SELECT coalesce(sum(octet_length(raw_text)), 0)::bigint FROM source_item
WHERE workspace_id = $1 AND created_at >= $2;

-- name: ListRequestSummaries :many
SELECT r.id, r.title, r.created_via, r.created_at,
       i.evidence_count, i.people_count, i.account_count, i.total_value, i.accounts_with_value, i.newest_evidence_at
FROM request r JOIN request_impact i ON i.workspace_id = r.workspace_id AND i.request_id = r.id
WHERE r.workspace_id = $1
  AND (r.created_at, r.id) < (sqlc.arg(before_created_at)::timestamptz, sqlc.arg(before_id)::uuid)
ORDER BY r.created_at DESC, r.id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: ListRequestSummariesByValue :many
SELECT r.id, r.title, r.created_via, r.created_at,
       i.evidence_count, i.people_count, i.account_count, i.total_value, i.accounts_with_value, i.newest_evidence_at
FROM request r JOIN request_impact i ON i.workspace_id = r.workspace_id AND i.request_id = r.id
WHERE r.workspace_id = $1
  AND (i.total_value, r.id) < (sqlc.arg(before_value)::numeric, sqlc.arg(before_id)::uuid)
ORDER BY i.total_value DESC, r.id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: GetRequestImpact :one
SELECT * FROM request_impact WHERE workspace_id = $1 AND request_id = $2;
