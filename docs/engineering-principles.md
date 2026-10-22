# Engineering principles

Ten qualities every change must respect. Each has concrete rules for this stack, a way to check it, and the phase where the check becomes a gate (`synthesis/07-development-phases-and-test-plan.md`). When two principles conflict, the order below breaks the tie: security and privacy first, then reliability and availability, then the rest. Record the tradeoff in the PR description.

## 1. Security
- Every request is untrusted. Validate input at the edge (size, type, shape); reject, don't repair.
- Auth: verify the Supabase JWT on every API request (signature, expiry, audience, issuer, no `alg: none`), then look up membership and role in our tables. Never trust a role, workspace id or user id from the client.
- Tenancy: every table has `workspace_id` and row-level security; each request sets `SET LOCAL app.workspace_id` in its transaction. The backend uses a non-bypass DB role. `service_role` never appears in code or config.
- App tables are not reachable through Supabase's auto-generated API or from the browser.
- No secrets in the repo, logs, URLs, client bundles or error messages. Env vars only; `.env.example` lists names, never values.
- Defaults deny: new routes require auth and a role check unless explicitly marked public; new tables get deny-all policies first.
- Output safety: no raw HTML from user or model text; escape by default; model output is untrusted content (prompt injection) and never triggers tools or sends.
- Nothing is sent to a customer without an approved state enforced in the send function itself.
- Dependencies: latest stable, lockfiles committed, `govulncheck` and `npm audit` clean, new packages justified.
- Check: cross-tenant and role-matrix tests (L6), JWT tests, secret scan, header tests. Gate 0 onward.

## 2. Reliability
- Every external call (database, LLM, storage, email) has a timeout, bounded retries with backoff, and a defined failure result.
- Slow or fallible work runs as a River job: idempotent, retried, transactional enqueue. Side effects (sends, charges) carry idempotency keys.
- No partial writes: multi-step changes happen in one transaction.
- Errors are typed and handled; never swallow an error silently. Panics are recovered at the edge only.
- Check: kill-the-worker and replay tests, race detector (`-race`). Gate 0, 3.

## 3. Performance
- Set a budget before building: API p95 under 300 ms for reads, table loads under 2 s on 10k requests / 100k evidence rows, first AI suggestion under 30 s for a 2,000-word paste.
- Every list endpoint paginates (keyset where possible) and has a limit cap. No unbounded queries, no N+1: check the query plan for new queries and add the index in the same migration.
- Web: server components by default; client JS only where interaction needs it; images through `next/image`; measure with the production build.
- Check: explain-plan review, load tests, Lighthouse/bundle report per phase gate (L7).

## 4. Scalability
- Stateless API processes; all state in Postgres, storage or the queue. Any instance can serve any request.
- Design for one big shared database with tenant-scoped indexes (`workspace_id` leads composite indexes). No in-memory caches that break with two instances.
- Heavy work (transcription, embeddings, extraction) is queued and rate-limited per workspace so one tenant cannot starve others.
- Check: run two API instances and two workers in integration tests; no sticky-session assumptions.

## 5. Usability
- Output before setup. One noun per concept (request, evidence, person, account, tag, area). Plain consequences before destructive actions.
- Every screen has loading, empty, error and success states, written in plain language that says what happened and what to do next.
- Machine output shows its source sentence; the user can always undo or edit.
- Check: manual acceptance script (L8) and the stopwatch tests in `07`.

## 6. Maintainability
- Spec first: `api/openapi.yaml` is the contract; generated code is never hand-edited; CI fails on drift.
- Small packages with one job; dependencies point inward (handlers → services → store). SQL is written by hand and type-checked by sqlc.
- Small diffs, one concern per PR; no unrelated changes. Comments explain why, not what.
- Structured logs with a request id; every AI call writes an `ai_event`. A failure should be diagnosable from logs without a debugger.
- Check: lint, vet, diff-size review, docs updated in the same PR.

## 7. Availability
- `/healthz` (process up, no dependencies) and `/readyz` (dependencies usable) on every service; deploys use readiness.
- Graceful shutdown on SIGTERM; in-flight requests and jobs finish or are safely retried.
- Degrade, don't fail: if the LLM is down, ingest still saves the item and queues extraction; if email is down, approved messages wait in the queue.
- Backups and a restore drill before any real customer data. Rollback is a one-command operation.
- Check: deploy/rollback drill, restore test, dependency-failure tests. Gate 0, 5.

## 8. Privacy
- Collect the minimum. Every personal-data field has a purpose, a retention rule and a deletion path ("delete person" removes quotes, chunks, embeddings, transcripts and media).
- Logs, traces and error reports contain ids, not content, emails or tokens. Redact secrets and card-like numbers at ingest, before storage and before any model call.
- Customer data is never used to train models; use zero-retention terms where offered. List every subprocessor.
- Outbound email: only approved messages, authenticated sender, suppression list honoured, unsubscribe where required.
- Check: deletion tests with direct DB and storage checks, log scans for personal data, redaction tests. Gate 4, 5.

## 9. Accessibility
- Target WCAG 2.2 AA. Semantic HTML first; ARIA only when HTML cannot express it.
- Everything reachable and operable by keyboard with a visible focus; skip link; labelled form controls; errors announced and tied to fields.
- Colour contrast at least AA in light and dark; never colour alone to convey state; respect `prefers-reduced-motion`.
- Phone-width layouts work. Lint rule `jsx-a11y` is on; add axe checks to Playwright when e2e exists.
- Check: automated scan plus keyboard-only run of core flows. Gate 5.

## 10. Cost efficiency
- Tier models by task (small for routing, mid for extraction and drafts, large only for briefs and hard questions). Cache stable prompts; batch where possible.
- Every AI and vendor call logs tokens and cost; per-workspace budgets stop runaway imports; show an estimate and a 10-item sample before bulk work.
- Prefer boring, managed, scale-to-small infrastructure; no new service where Postgres will do.
- Review the weekly cost report; any component 25% over budget gets a ticket.
- Check: budget assertions in tests, cost report. Gate 1, 5.

## Pull request checklist
Copy into every PR description and answer each line (n/a is allowed with a reason).

```
Security:       auth + role + tenant checked; new input validated; no secrets/PII in logs
Reliability:    timeouts, retries, idempotency, transactions
Performance:    query plan / index / pagination / payload size
Scalability:    stateless; per-workspace limits for heavy work
Usability:      empty / loading / error states; plain copy; undo
Maintainability:contract updated + regenerated; small diff; docs updated
Availability:   degrades gracefully; health checks; rollback safe
Privacy:        data minimised; deletion path; redaction
Accessibility:  keyboard, labels, contrast, focus
Cost:           model tier, tokens/cost logged, budget respected
Tests:          acceptance test written first; authorisation test; AI eval if prompts changed
```
