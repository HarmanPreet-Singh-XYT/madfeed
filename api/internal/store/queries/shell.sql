-- name: CountWaitingProposals :one
-- How many suggestions wait in the review queue, counted only up to 100 (the navigation shows "100+").
SELECT count(*)::int FROM (SELECT 1 FROM proposal WHERE workspace_id = $1 AND state = 'suggested' LIMIT 100) p;

-- name: CountOutreachNeedingYou :one
-- Batches of personal messages that are being drafted or wait for a person's review.
SELECT count(*)::int FROM outreach_batch WHERE workspace_id = $1 AND state IN ('drafting', 'review');
