-- name: QualityByWeek :many
SELECT s.kind AS source_kind,
       date_trunc('week', p.created_at)::timestamptz AS week,
       count(*) FILTER (WHERE p.state = 'accepted')::int AS accepted,
       count(*) FILTER (WHERE p.state = 'accepted' AND p.edited)::int AS accepted_edited,
       count(*) FILTER (WHERE p.state = 'dismissed')::int AS dismissed,
       count(*) FILTER (WHERE p.state = 'suggested')::int AS still_open
FROM proposal p JOIN source_item s ON s.workspace_id = p.workspace_id AND s.id = p.source_item_id
WHERE p.workspace_id = $1 AND p.created_at >= $2
GROUP BY 1, 2
ORDER BY 2, 1;

-- name: AICostByTaskModel :many
SELECT task, provider, model, count(*)::int AS calls,
       count(*) FILTER (WHERE outcome = 'error')::int AS errors,
       coalesce(sum(cost_usd), 0)::numeric(14, 6) AS cost_usd,
       coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
       coalesce(sum(output_tokens), 0)::bigint AS output_tokens
FROM ai_event WHERE workspace_id = $1 AND created_at >= $2
GROUP BY task, provider, model ORDER BY task, provider, model;

-- name: QualityCountsBetween :one
SELECT
  count(*) FILTER (WHERE p.state = 'accepted')::int AS accepted,
  count(*) FILTER (WHERE p.state = 'accepted' AND p.edited)::int AS accepted_edited,
  count(*) FILTER (WHERE p.state = 'dismissed')::int AS dismissed,
  count(*) FILTER (WHERE p.state = 'suggested')::int AS still_open
FROM proposal p
WHERE p.workspace_id = $1 AND p.created_at >= $2 AND p.created_at < $3;

-- name: PublicSignalCounts :many
SELECT (public_signal->>'verdict')::text AS verdict, count(*)::int AS n
FROM request
WHERE workspace_id = $1 AND public_signal IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- name: RequestsAlreadyPossible :many
SELECT id, title, public_signal
FROM request
WHERE workspace_id = $1 AND public_signal->>'verdict' = 'others_ship_it'
ORDER BY updated_at DESC
LIMIT 10;
