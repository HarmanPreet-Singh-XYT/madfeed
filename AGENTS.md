# Agent instructions

This repo is a closed-source SaaS that turns customer conversations into cited, prioritised requests and closes the loop with the people who asked. Read this file first; it applies to every AI agent and human working here.

## Layout
- `web/`: Next.js + TypeScript **client only**. Never touches the database; calls the API. Next.js here has breaking changes: read `web/AGENTS.md` and the guides in `web/node_modules/next/dist/docs/` before writing web code.
- `api/`: Go backend (chi, pgx, sqlc, goose, River, oapi-codegen). One binary, `APP_MODE=api|worker`. Contract in `api/openapi.yaml`.
- `synthesis/`: product research, spec (`04`), blueprint (`05`), risks (`06`), phases and test gates (`07`). Source of truth for *what* to build; `docs/engineering-principles.md` for *how*.
- `docs/gates/`: one record per phase gate (template at the end of `07`).

## The ten principles (non-negotiable)
Security, reliability, performance, scalability, usability, maintainability, availability, privacy, accessibility, cost efficiency. Concrete rules and checks are in `docs/engineering-principles.md`. Tie-break order: security and privacy, then reliability and availability, then the rest. Read it before your first change, and answer its PR checklist in every PR description.

## Hard rules
1. **Tenant isolation.** Every table has `workspace_id` and RLS; every request runs in a transaction that sets the workspace. The backend never uses `service_role`. A new table without a policy fails tests.
2. **Never send to a customer without an approved state**, enforced inside the send function, not only the UI.
3. **No claim without a source.** Evidence rows need a chunk; every stored quote must appear verbatim in its chunk at the stored offsets; AI answers cite or refuse.
4. **Secrets and personal data** never go in code, logs, URLs, error messages or client bundles. `.env` is git-ignored; update `.env.example` with names only.
5. **Contract first.** Change `api/openapi.yaml`, regenerate Go stubs and the TypeScript client, never hand-edit generated files.
6. **Latest stable dependencies** resolved by the package manager (`go get pkg@latest`, `npm i pkg@latest`); no versions from memory; no pre-release without a written reason. Model IDs are pinned per prompt and changed only through the eval gate.
7. **Clean room.** Do not copy competitor code, text, layouts or distinctive names. The AGPL reference project (Quackback) is feature reference only; do not read or port its code. Competitor names do not appear in code, UI or docs outside `synthesis/00`–`02`.
8. **AI and email go through interfaces.** Call models only via `api/internal/ai` (tiers and routes from config; no model IDs, langchaingo or vendor SDK types outside an adapter package) and send mail only via `api/internal/email`. Every AI call sets `ContainsCustomerData` truthfully (true for any prompt with customer text or personal data) and records provider, model, prompt version, tokens and cost.
9. **Vocabulary.** Request, evidence, person, account, tag, area. No parallel nouns (idea, insight, theme, group) without a definition in `synthesis/00-glossary.md`.

## How to work
- **Acceptance test first**, written from the spec in `synthesis/04`/`07`, then the code. Tests must assert behaviour, not mirror the implementation.
- **Definition of done:** tests (unit, integration, authorisation for other-workspace and lower-role, affected e2e), empty/loading/error states, `ai_event` logged for every AI call, small reviewed diff, docs updated. Nothing is done until a human has watched it work.
- **Small diffs.** One concern per change; no "while I was there" edits; list changed files in the summary.
- **CI is manual-only** (`workflow_dispatch`), so nothing runs automatically on push or PR. Run `make check` locally before every commit and before asking for a review; trigger CI by hand for a release candidate or a gate. Do not add `push` or `pull_request` triggers without the owner's approval.
- **Check commands:** `make check` (everything CI runs), or `make api-check` / `make web-check`. Run before declaring work done and report real output. If something fails, say so.
- **Migrations** are forward-only goose files, reviewed for locks and data loss; add indexes (lead with `workspace_id`) in the same change as new queries.
- **Web:** server components by default; semantic HTML; keyboard and focus; AA contrast; phone-width layout.
- **AI features:** structured outputs with schema validation; treat model input and output as untrusted; prompt versions stored; cost estimate before bulk work.

## Ask the owner before
Anything outward-facing or hard to reverse: sending email, creating paid or hosted resources (Supabase projects, deployments, domains), publishing, pushing to a remote, force-pushing, deleting data, adding a new vendor or subprocessor, changing the stack decisions in `synthesis/05`.

## Current state
Phase 0 is partly open (Supabase, real AI keys, Resend, deploy drills: `docs/gates/gate-0.md`). Phase 1 (`gate-1.md`) and Phase 2 (`gate-2.md`) are built and tested locally with a fake model: ingest, extraction with verbatim quotes, review queue, requests with cited evidence, people and accounts with strict CSV import, trigger-maintained impact (value summed over distinct accounts), cited decision briefs, quality panel, admin export plus import, and the matching web screens with browser tests at desktop and phone size. Local workflow: `make dev-db migrate dev-role devauth`, run the API (README), `make web`; `make e2e` for browser tests (it migrates first; migrate before running Playwright directly). Web sign-in is dev-only (ENABLE_DEV_AUTH) until Supabase exists. Phase 3 (`gate-3.md`) is built and tested locally: statuses, shipping a request starts one batch of personal drafts from each person's own quotes, owner review and approval, a send worker that refuses anything unapproved, send log, opt-outs and signed unsubscribe links, release notes with a public page and scheduling, and "told about this" marks. Sending is only exercised against a local mail stand-in (`api/cmd/devmail`); nothing has gone through Resend. Phase 4 part A (`gate-4.md`) is built: tag codebook with merge and exact undo, highlights with the verbatim guarantee, and grounded Q&A that cites stored quotes or refuses (measured once against DeepSeek on a small synthetic set: 20/20 unanswerable and 20/20 false-premise refused). Browser tests use a fake provider (`api/cmd/devmodel`). The hosted Supabase database has migrations applied and passed the exposure and isolation checks (`gate-0.md`); real sign-in is still untested. Part B (uploads, transcription, media sync) waits for a transcription vendor and storage decisions. Next: real Supabase sign-in and the Gate 0 items, a real extraction and brief run to measure quality, email forward-in, matching (needs an embeddings provider), saved views, sender-domain setup and a real Resend test. Product name is undecided; do not invent one in user-facing copy.
