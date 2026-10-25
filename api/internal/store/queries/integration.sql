-- name: GetIntegration :one
SELECT * FROM integration WHERE workspace_id = $1 AND kind = $2;

-- name: ListIntegrations :many
SELECT workspace_id, kind, state, external_id, config, last_ok_at, last_error, connected_at FROM integration WHERE workspace_id = $1 ORDER BY kind;

-- name: UpsertIntegration :exec
INSERT INTO integration (workspace_id, kind, state, external_id, config, secret, connected_by, last_ok_at, last_error)
VALUES ($1, $2, 'connected', $3, $4, $5, $6, now(), '')
ON CONFLICT (workspace_id, kind) DO UPDATE
  SET state = 'connected', external_id = EXCLUDED.external_id, config = EXCLUDED.config, secret = EXCLUDED.secret,
      connected_by = EXCLUDED.connected_by, connected_at = now(), last_ok_at = now(), last_error = '', updated_at = now();

-- name: UpdateIntegrationConfig :execrows
UPDATE integration SET config = $3, updated_at = now() WHERE workspace_id = $1 AND kind = $2;

-- name: UpdateIntegrationSecret :exec
UPDATE integration SET secret = $3, updated_at = now() WHERE workspace_id = $1 AND kind = $2;

-- name: MarkIntegrationOK :exec
UPDATE integration SET state = 'connected', last_ok_at = now(), last_error = '', updated_at = now() WHERE workspace_id = $1 AND kind = $2;

-- name: MarkIntegrationBroken :exec
UPDATE integration SET state = 'needs_reconnect', last_error = $3, updated_at = now() WHERE workspace_id = $1 AND kind = $2;

-- name: DeleteIntegration :execrows
DELETE FROM integration WHERE workspace_id = $1 AND kind = $2;

-- name: InsertRequestIssue :exec
INSERT INTO request_issue (workspace_id, request_id, repo, issue_number, issue_url, last_synced_status_id, created_by, last_event_at, tracker, issue_ref)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: GetRequestIssue :one
SELECT * FROM request_issue WHERE workspace_id = $1 AND request_id = $2;

-- name: GetRequestIssueByNumber :one
SELECT * FROM request_issue WHERE workspace_id = $1 AND tracker = $4 AND lower(repo) = lower($2) AND issue_number = $3 AND issue_ref = $5 FOR UPDATE;

-- name: SetRequestIssueState :exec
UPDATE request_issue
SET issue_state = $3, last_event_at = $4, last_synced_status_id = $5, pending_status_id = $6, conflict = $7
WHERE workspace_id = $1 AND request_id = $2;

-- name: DeleteRequestIssue :execrows
DELETE FROM request_issue WHERE workspace_id = $1 AND request_id = $2;

-- name: InsertWebhookDelivery :execrows
INSERT INTO webhook_delivery (workspace_id, source, delivery_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: PurgeWebhookDeliveries :exec
DELETE FROM webhook_delivery WHERE workspace_id = $1 AND received_at < now() - interval '14 days';

-- name: StatusExists :one
SELECT EXISTS (SELECT 1 FROM status WHERE workspace_id = $1 AND id = $2) AS ok;
