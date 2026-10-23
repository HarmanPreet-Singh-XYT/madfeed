-- name: GetFormSettings :one
SELECT form_key, form_origins, public_slug FROM workspace WHERE id = $1;

-- name: SetFormSettings :execrows
UPDATE workspace SET form_key = $2, form_origins = $3, updated_at = now() WHERE id = $1;

-- name: SetRequestPublic :execrows
UPDATE request SET public = $3, public_title = CASE WHEN $3 THEN $4 ELSE public_title END, public_summary = CASE WHEN $3 THEN $5 ELSE public_summary END, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: PublicRoadmap :many
-- Only what a visitor may see: the public title, the public summary and the status. The request's own title never appears. Nothing else leaves the table.
SELECT r.id, r.public_title AS title, r.public_summary, st.name AS status_name, st.bucket AS status_bucket
FROM request r JOIN status st ON st.workspace_id = r.workspace_id AND st.id = r.status_id
WHERE r.workspace_id = $1 AND r.public AND st.bucket <> 'closed'
ORDER BY st.position, r.updated_at DESC, r.id
LIMIT 200;

-- name: SourceIDsBySubmitter :many
SELECT id FROM source_item WHERE workspace_id = $1 AND kind = 'form' AND submitter_email = $2;

-- name: CountFormSubmissionsSince :one
SELECT count(*) FROM source_item WHERE workspace_id = $1 AND kind = 'form' AND created_at >= $2;
