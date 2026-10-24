-- name: InsertSurvey :one
INSERT INTO survey (workspace_id, title, intro, thank_you, delivery, on_person_delete, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: GetSurvey :one
SELECT * FROM survey WHERE workspace_id = $1 AND id = $2;

-- name: GetSurveyForUpdate :one
SELECT * FROM survey WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: ListSurveys :many
SELECT s.*,
  (SELECT count(*) FROM survey_invite i WHERE i.workspace_id = s.workspace_id AND i.survey_id = s.id AND i.state = 'sent')::int AS invites_sent,
  (SELECT count(*) FROM survey_response r WHERE r.workspace_id = s.workspace_id AND r.survey_id = s.id AND r.state = 'complete')::int AS responses
FROM survey s WHERE s.workspace_id = $1 ORDER BY s.created_at DESC, s.id LIMIT $2;

-- name: UpdateSurveyBasics :execrows
UPDATE survey SET title = $3, intro = $4, thank_you = $5, delivery = $6, on_person_delete = $7, updated_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: SetSurveyAudience :execrows
UPDATE survey SET audience = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: OpenSurvey :execrows
UPDATE survey SET state = 'open', opened_at = coalesce(opened_at, now()), closed_at = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state IN ('draft', 'closed');

-- name: CloseSurvey :execrows
UPDATE survey SET state = 'closed', closed_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'open';

-- name: ResetSurveyLink :one
UPDATE survey SET link_epoch = link_epoch + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING link_epoch;

-- name: DeleteSurvey :execrows
DELETE FROM survey WHERE workspace_id = $1 AND id = $2;

-- name: ListSurveyQuestions :many
SELECT * FROM survey_question WHERE workspace_id = $1 AND survey_id = $2 ORDER BY ordinal;

-- name: DeleteSurveyQuestions :exec
DELETE FROM survey_question WHERE workspace_id = $1 AND survey_id = $2;

-- name: InsertSurveyQuestion :exec
INSERT INTO survey_question (workspace_id, survey_id, ordinal, kind, prompt, required, options)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: CountSurveyResponses :one
SELECT count(*)::int FROM survey_response WHERE workspace_id = $1 AND survey_id = $2;

-- ---- invitations ----

-- name: InsertSurveyInvite :one
INSERT INTO survey_invite (workspace_id, survey_id, person_id, to_email, state)
VALUES ($1, $2, $3, $4, $5) ON CONFLICT (survey_id, person_id) DO NOTHING RETURNING id;

-- name: ListSurveyInvites :many
SELECT i.id, i.person_id, p.name AS person_name, i.to_email, i.state, i.sent_at, i.reminder_state, i.reminded_at,
  EXISTS (SELECT 1 FROM survey_response r WHERE r.workspace_id = i.workspace_id AND r.invite_id = i.id AND r.state = 'complete') AS answered
FROM survey_invite i JOIN person p ON p.workspace_id = i.workspace_id AND p.id = i.person_id
WHERE i.workspace_id = $1 AND i.survey_id = $2 ORDER BY p.name, i.id LIMIT $3;

-- name: CountSurveyInvitesByState :many
SELECT state, count(*)::int AS n FROM survey_invite WHERE workspace_id = $1 AND survey_id = $2 GROUP BY state;

-- name: GetSurveyInvite :one
SELECT * FROM survey_invite WHERE workspace_id = $1 AND id = $2;

-- name: ToggleSurveyInvite :execrows
UPDATE survey_invite SET state = CASE WHEN sqlc.arg(exclude)::boolean THEN 'excluded' ELSE 'draft' END, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND state = CASE WHEN sqlc.arg(exclude)::boolean THEN 'draft' ELSE 'excluded' END;

-- name: ApproveSurveyInvites :many
UPDATE survey_invite SET state = 'approved', approved_by = $3, approved_at = now(), updated_at = now()
WHERE workspace_id = $1 AND survey_id = $2 AND state = 'draft' RETURNING id;

-- name: ClaimSurveyInviteForSend :one
-- Only an invitation a person approved, for a survey that is open, can be claimed; only one worker wins it.
UPDATE survey_invite i SET state = 'sending', attempts = i.attempts + 1, updated_at = now()
FROM survey s
WHERE i.workspace_id = $1 AND i.id = $2 AND i.state = 'approved' AND i.approved_by IS NOT NULL
  AND s.workspace_id = i.workspace_id AND s.id = i.survey_id AND s.state = 'open'
RETURNING i.*;

-- name: ExcludeApprovedInvitesOfClosedSurvey :exec
UPDATE survey_invite i SET state = 'excluded', updated_at = now()
FROM survey s
WHERE i.workspace_id = $1 AND i.id = $2 AND i.state = 'approved' AND s.workspace_id = i.workspace_id AND s.id = i.survey_id AND s.state <> 'open';

-- name: MarkSurveyInviteSent :exec
UPDATE survey_invite SET state = 'sent', sent_at = now(), provider_message_id = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: ReleaseSurveyInviteForRetry :exec
UPDATE survey_invite SET state = 'approved', last_error_class = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'sending';

-- name: MarkSurveyInviteFailed :exec
UPDATE survey_invite SET state = 'failed', last_error_class = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: SetSurveyInviteSuppressed :exec
UPDATE survey_invite SET state = 'suppressed', updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: SuppressPendingSurveyInvitesForEmail :exec
UPDATE survey_invite SET state = CASE WHEN state IN ('draft', 'approved') THEN 'suppressed' ELSE state END,
  reminder_state = CASE WHEN reminder_state = 'approved' THEN NULL ELSE reminder_state END, updated_at = now()
WHERE workspace_id = $1 AND to_email = $2 AND (state IN ('draft', 'approved') OR reminder_state = 'approved');

-- name: GetSurveyInviteAddress :one
SELECT to_email FROM survey_invite WHERE workspace_id = $1 AND id = $2;

-- name: SentSurveyInvitesForPerson :many
SELECT id, to_email FROM survey_invite WHERE workspace_id = $1 AND person_id = $2 AND state IN ('sending', 'sent');

-- name: DeleteSurveyInvitesForPerson :exec
DELETE FROM survey_invite WHERE workspace_id = $1 AND person_id = $2;

-- name: ApproveSurveyReminders :many
-- One reminder per invitation: only people whose invitation went out, who have not finished, and never reminded.
UPDATE survey_invite i SET reminder_state = 'approved', reminder_approved_by = $3, updated_at = now()
WHERE i.workspace_id = $1 AND i.survey_id = $2 AND i.state = 'sent' AND i.reminder_state IS NULL
  AND NOT EXISTS (SELECT 1 FROM survey_response r WHERE r.workspace_id = i.workspace_id AND r.invite_id = i.id AND r.state = 'complete')
RETURNING i.id;

-- name: CountSurveyRemindable :one
SELECT count(*)::int FROM survey_invite i
WHERE i.workspace_id = $1 AND i.survey_id = $2 AND i.state = 'sent' AND i.reminder_state IS NULL
  AND NOT EXISTS (SELECT 1 FROM survey_response r WHERE r.workspace_id = i.workspace_id AND r.invite_id = i.id AND r.state = 'complete');

-- name: ClaimSurveyReminderForSend :one
-- Approved by a person, not answered meanwhile, survey still open; only one worker wins it.
UPDATE survey_invite i SET reminder_state = 'sending', updated_at = now()
FROM survey s
WHERE i.workspace_id = $1 AND i.id = $2 AND i.state = 'sent' AND i.reminder_state = 'approved' AND i.reminder_approved_by IS NOT NULL
  AND s.workspace_id = i.workspace_id AND s.id = i.survey_id AND s.state = 'open'
  AND NOT EXISTS (SELECT 1 FROM survey_response r WHERE r.workspace_id = i.workspace_id AND r.invite_id = i.id AND r.state = 'complete')
RETURNING i.*;

-- name: DropUnsendableSurveyReminder :exec
-- An approved reminder that can no longer go out (answered, or the survey closed) is simply withdrawn.
UPDATE survey_invite SET reminder_state = NULL, reminder_approved_by = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND reminder_state IN ('approved', 'sending');

-- name: MarkSurveyReminderSent :exec
UPDATE survey_invite SET reminder_state = 'sent', reminded_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- name: ReleaseSurveyReminderForRetry :exec
UPDATE survey_invite SET reminder_state = 'approved', updated_at = now() WHERE workspace_id = $1 AND id = $2 AND reminder_state = 'sending';

-- name: MarkSurveyReminderFailed :exec
UPDATE survey_invite SET reminder_state = 'failed', updated_at = now() WHERE workspace_id = $1 AND id = $2;

-- ---- responses ----

-- name: GetSurveyResponseByInvite :one
SELECT * FROM survey_response WHERE workspace_id = $1 AND survey_id = $2 AND invite_id = $3;

-- name: GetSurveyResponseByRespondent :one
SELECT * FROM survey_response WHERE workspace_id = $1 AND survey_id = $2 AND respondent_key = $3;

-- name: InsertSurveyResponse :one
INSERT INTO survey_response (workspace_id, survey_id, invite_id, person_id, respondent_key)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: GetSurveyResponseForUpdate :one
SELECT * FROM survey_response WHERE workspace_id = $1 AND id = $2 FOR UPDATE;

-- name: UpsertSurveyAnswer :exec
INSERT INTO survey_answer (workspace_id, response_id, question_id, value_num, value_choice, value_text)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (response_id, question_id) DO UPDATE SET value_num = EXCLUDED.value_num, value_choice = EXCLUDED.value_choice, value_text = EXCLUDED.value_text;

-- name: DeleteSurveyAnswersExcept :exec
DELETE FROM survey_answer WHERE workspace_id = $1 AND response_id = $2 AND NOT (question_id = ANY (sqlc.arg(keep)::uuid[]));

-- name: ListSurveyAnswers :many
SELECT * FROM survey_answer WHERE workspace_id = $1 AND response_id = $2;

-- name: CompleteSurveyResponse :execrows
UPDATE survey_response SET state = 'complete', submitted_at = now() WHERE workspace_id = $1 AND id = $2 AND state = 'partial';

-- name: SetSurveyResponseSource :exec
UPDATE survey_response SET source_item_id = $3 WHERE workspace_id = $1 AND id = $2;

-- name: CountSurveyResponsesSince :one
SELECT count(*)::int FROM survey_response WHERE workspace_id = $1 AND survey_id = $2 AND started_at >= $3;

-- name: SurveyNumericResults :many
SELECT q.id AS question_id, q.kind,
  count(a.id)::int AS answers,
  coalesce(sum(a.value_num), 0)::bigint AS total,
  count(a.id) FILTER (WHERE q.kind = 'nps' AND a.value_num >= 9)::int AS promoters,
  count(a.id) FILTER (WHERE q.kind = 'nps' AND a.value_num BETWEEN 7 AND 8)::int AS passives,
  count(a.id) FILTER (WHERE q.kind = 'nps' AND a.value_num <= 6)::int AS detractors
FROM survey_question q
LEFT JOIN survey_answer a ON a.workspace_id = q.workspace_id AND a.question_id = q.id AND a.value_num IS NOT NULL
  AND EXISTS (SELECT 1 FROM survey_response r WHERE r.workspace_id = a.workspace_id AND r.id = a.response_id AND r.state = 'complete')
WHERE q.workspace_id = $1 AND q.survey_id = $2 AND q.kind IN ('nps', 'csat')
GROUP BY q.id, q.kind, q.ordinal ORDER BY q.ordinal;

-- name: SurveyChoiceResults :many
SELECT a.question_id, a.value_choice AS choice, count(*)::int AS n
FROM survey_answer a JOIN survey_response r ON r.workspace_id = a.workspace_id AND r.id = a.response_id AND r.state = 'complete'
WHERE a.workspace_id = $1 AND r.survey_id = $2 AND a.value_choice IS NOT NULL GROUP BY a.question_id, a.value_choice;

-- name: ListSurveyTextAnswers :many
SELECT a.question_id, a.value_text AS text, r.submitted_at, r.source_item_id, coalesce(p.name, '') AS person_name
FROM survey_answer a JOIN survey_response r ON r.workspace_id = a.workspace_id AND r.id = a.response_id AND r.state = 'complete'
LEFT JOIN person p ON p.workspace_id = r.workspace_id AND p.id = r.person_id
WHERE a.workspace_id = $1 AND r.survey_id = $2 AND a.value_text IS NOT NULL ORDER BY r.submitted_at DESC, a.id LIMIT $3;

-- name: CountSurveyResponsesByState :many
SELECT state, count(*)::int AS n FROM survey_response WHERE workspace_id = $1 AND survey_id = $2 GROUP BY state;

-- ---- when a person is deleted ----

-- name: DeleteSurveyResponsesOfPerson :exec
-- Surveys set to remove: everything the person answered goes.
DELETE FROM survey_response r USING survey s
WHERE r.workspace_id = $1 AND r.person_id = $2 AND s.workspace_id = r.workspace_id AND s.id = r.survey_id AND s.on_person_delete = 'remove';

-- name: AnonymiseSurveyResponsesOfPerson :exec
-- Surveys set to anonymise: the free text goes (it is the part that can identify someone), the ratings and
-- choices stay without a name.
WITH mine AS (
  SELECT r.id FROM survey_response r JOIN survey s ON s.workspace_id = r.workspace_id AND s.id = r.survey_id
  WHERE r.workspace_id = $1 AND r.person_id = $2 AND s.on_person_delete = 'anonymise'
), gone AS (
  DELETE FROM survey_answer a USING mine WHERE a.workspace_id = $1 AND a.response_id = mine.id AND a.value_text IS NOT NULL RETURNING a.id
)
UPDATE survey_response SET person_id = NULL, invite_id = NULL, respondent_key = NULL WHERE survey_response.workspace_id = $1 AND survey_response.id IN (SELECT mine.id FROM mine);
