# Gate 3 record (in progress): closing the loop

Date: 2026-10-22    Environment: local (Docker Postgres 18, Go 1.27.3, Node 26, local mail stand-in)
Status: **BUILT AND TESTED LOCALLY, GATE OPEN.** Nothing has been sent through Resend or to a real inbox.

## Passed (evidence = tests; `make check` and `make e2e` green, full browser suite run twice: 14 passed, 4 gated screenshot tests skipped)

| Gate 3 item (`07`) | Result | Evidence |
|---|---|---|
| Never send without approval | PASS | `internal/workflow/send_test.go`: unapproved, excluded, suppressed and unknown messages are never handed to the sender; checked inside the send path, not only the UI; mutation-checked |
| No duplicate sends | PASS | double delivery of the same job, concurrent claims, retries after a transient failure, replayed "shipped", and randomised sequences all give at most one email per person per request (idempotency key `outreach-<messageId>`) |
| Opt-out honoured | PASS | unsubscribing stops pending messages in every batch, batches finish cleanly, later ships skip the address; unsubscribe links are signed, opening one changes nothing until the button is pressed |
| Drafts use only the recipient's own quotes | PASS | validation rejects links, emails, money, customer counts, dates and promises, other customers' names and misquotes; a misbehaving model falls back to a plain template |
| Statuses and shipping | PASS | admin-defined statuses; moving to a "done" status starts one batch; moving back withdraws an unapproved batch; replays create nothing twice |
| Release notes | PASS | draft, schedule (stored as an absolute time), publish, unpublish; public page shows only live notes; linked requests; "told about this" marks |
| Roles and isolation | PASS | viewers can read but not send or publish; other-workspace ids return 404 |
| Browser flow, desktop and phone | PASS | `web/e2e/phase3.spec.ts`: ship, review, edit, approve, delivered mail checked at the stand-in, unsubscribe as a stranger, schedule and publish. axe finds no serious or critical issues on the new screens. |

## Bugs found by testing, now fixed
- Two drafts finishing at the same moment could each see the other as unfinished and leave the batch stuck in "drafting" forever. The batch is now locked before counting; `TestDraftsFinishingAtTheSameTimeStillMoveTheBatchToReview` fails without the fix.
- A failed send attempt was rolled back with its error, losing the record of the attempt; it is now recorded first.
- A batch stayed "approved" after its last recipient opted out.
- The release editor crashed in the browser after scheduling (`Intl` does not allow `dateStyle`/`timeStyle` together with `timeZoneName`).
- A worker with no AI provider kept failing extraction and brief jobs it could not do; it now waits (snoozes) without using up attempts.
- Browser tests leaked state between runs (old jobs, opt-outs); setup now clears them.

## Real-model check (DeepSeek `deepseek-flash`, synthetic text only, 2026-10-23, `go run ./cmd/aieval`)
- Message drafts: the first run rejected 7 of 12 drafts because the model puts our sentence's comma inside the customer's quotation marks (`"...single sign-on,"`) and the check treated it as a misquote. Fixed (edge punctuation is ignored; misquotes still rejected). After the fix: 12 of 12 accepted; they read plainly, quote at most one phrase, make no promises. Cost about $0.0006 per draft run of 12.
- Extraction: found the real feedback in 5 synthetic conversations, every quote verbatim (0 snapped, 0 dropped), nothing from a no-feedback message, and a prompt injection in the text was ignored. Briefs stayed within the evidence (one quote: "One customer said..."). This is a smoke test on 5 conversations, not the 20-conversation gold set.

## Not done (Gate 3 stays open)

| Item | Needs |
|---|---|
| Real delivery through Resend; SPF/DKIM/DMARC; inbox placement | sender domain, API key, your approval to send |
| ~~Bounce and complaint feed~~ built 2026-10-23: `POST /v1/webhooks/resend`, signature-verified (Svix scheme), hard bounces and complaints only, acts only on messages we sent, replay-safe; tested with signed simulated payloads, mutation-checked. **Not yet pointed at by a real Resend account**: it needs the webhook created in Resend and `RESEND_WEBHOOK_SECRET` set; the real payload shape is from the provider's documentation, unverified against live traffic. | Resend account |
| Human tone check on 20 drafts written from real customer conversations | a person (12 synthetic drafts looked fine) |
| Manual pass of flow A4 | a person |
| Public pages: crawling, rate limiting | not built |
| Public page for an unpublished note returns status 200 with a "not found" body (Next streams it); no draft text is served, but crawlers see a soft 404 | decide whether it matters |
| Confirm that the `public_workspace_id` SECURITY DEFINER function bypasses RLS on Supabase as it does locally | Supabase project |
