-- name: CountWaitingProposals :one
-- How many suggestions wait in the review queue, counted only up to 100 (the navigation shows "100+").
SELECT count(*)::int FROM (SELECT 1 FROM proposal WHERE workspace_id = $1 AND state = 'suggested' LIMIT 100) p;

-- name: CountOutreachNeedingYou :one
-- Batches of personal messages that are being drafted or wait for a person's review.
SELECT count(*)::int FROM outreach_batch WHERE workspace_id = $1 AND state IN ('drafting', 'review');

-- name: CountWaitingConversations :one
-- Conversations whose newest real message is the customer's, counted only up to 100 (the navigation shows "100+").
SELECT count(*)::int FROM (
  SELECT 1 FROM conversation c
  WHERE c.workspace_id = $1 AND c.state = 'open'
    AND (SELECT m.direction FROM conversation_message m
         WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.direction <> 'note'
         ORDER BY m.seq DESC LIMIT 1) = 'in'
  LIMIT 100
) w;

-- name: CountUnreadConversations :one
-- Conversations with something this person has not read yet, counted up to 100.
SELECT count(*)::int FROM (
  SELECT 1 FROM conversation c
  LEFT JOIN LATERAL (
    SELECT m.seq FROM conversation_message m
    WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.direction <> 'note'
    ORDER BY m.seq DESC LIMIT 1
  ) l ON true
  LEFT JOIN conversation_read r ON r.workspace_id = c.workspace_id AND r.conversation_id = c.id AND r.user_id = sqlc.arg(me)::uuid
  WHERE c.workspace_id = sqlc.arg(workspace_id)::uuid AND c.state = 'open'
    AND coalesce(l.seq, 0) > coalesce(r.last_read_seq, 0)
  LIMIT 100
) u;
