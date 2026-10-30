# madfeed

**Customer conversations in. Cited, prioritised requests out. And the people who asked get told what happened.**

madfeed reads the conversations you already have — support chat, email, calls, tickets, survey
answers — and turns them into requests where every request carries the customer's exact words,
verifiable at the character offsets where they appear in the source. A statement the model cannot
back with a verbatim quote is never stored. An answer either cites a stored quote or refuses to
answer.

Most feedback tools summarise. A summary is convenient and unarguable, which is the problem: six
weeks later nobody can find who asked, what they said, or whether it was one loud account or forty
quiet ones. madfeed keeps the receipt. That one rule shapes the schema, the review queue, the
briefs, the AI answers, and the export: if the quote does not match the source, the write fails.

## What it does

| Area | What you get |
|---|---|
| **Intake** | Paste a conversation; import CSV; upload calls; website chat widget; support email; public API (`/v1/ext/feedback`, `/v1/ext/transcripts`) |
| **Extraction** | Model proposes statements (`need`, `bug`, `praise`, `question`) with a quote, a title and a confidence; code rejects anything whose quote is not verbatim at its stored span, checked twice plus a database trigger |
| **Review** | Queue of proposals: accept, reject, merge into an existing request; nothing becomes a request without a person or an explicit rule |
| **Requests** | Statuses, owners, tags, filters, saved views; every request lists its evidence with the quote highlighted in context |
| **People and accounts** | Directory, accounts, CSV import with strict validation, account value |
| **Impact** | Value summed over *distinct* accounts behind a request, maintained by trigger |
| **Decisions** | Cited decision briefs: what people asked for, who, how much it is worth, what the evidence does not say |
| **Research** | Highlights with the same verbatim guarantee, timed transcripts with a player, findings documents with shareable revocable links, grounded Q&A that cites or refuses |
| **Surveys** | Audience targeting, up to four branching conditions, one final answer per person, email invitation or public/embeddable link; free text lands in the review queue |
| **Closing the loop** | Approve drafts generated from each person's own quotes, send, log it, honour opt-outs, publish release notes, mark "told about this" |
| **Support desk** | Shared inbox for website chat and email, teammate replies, saved replies, private notes, first-reply reporting, files |
| **Public sources** | On a request, asks Tavily whether the thing people want is already documented or already reported publicly, and records the links — kept apart from customer evidence |
| **Admin** | Team invitations and roles, audit log, workspace export/import, retention policy, AI allowance per workspace |

## How it works

```
 Browser ──────────────► web/ (Next.js, client only: no database, no secrets)
                          │  server components call the API with the signed-in session
                          ▼
                    api/ (Go, one binary: APP_MODE=api)
                          │
        ┌─────────────────┼──────────────────────────────┐
        ▼                 ▼                              ▼
  Postgres 18        River job queue              internal/ai
  RLS + pgvector     (transactional,             tiers → provider routes
  (goose migrations)  resumable)                 ├── Nebius Token Factory
        ▲                 │                      └── (any OpenAI-compatible)
        │                 ▼
        └──────── api/ (APP_MODE=worker): extraction, embeddings, transcription,
                  digests, integration sync, outbound webhooks, retention
```

- **Tenant isolation is structural.** Every table has `workspace_id` and a row-level-security
  policy; every request runs in a transaction that sets the workspace. The backend never connects
  as a superuser or a hosted platform's `service_role`. A new table without a policy fails the
  test suite.
- **Contract first.** `api/openapi.yaml` is the source of truth. Go stubs and the TypeScript client
  are generated (`make generate`); `make check-generated` fails on drift. Hand-editing generated
  files is a bug.
- **One provider seam.** Features ask `internal/ai` for a tier; configuration maps tiers to ordered
  `(provider, model)` routes with prices, and the router falls back on outages, rate limits and
  bad keys. Vendor SDK types never leave their adapter package, and every attempt is recorded in
  `ai_event` (provider, model, prompt version, tokens, cost, latency).
- **Customer text is treated as hostile.** Prompts separate instructions from untrusted data,
  secrets are redacted before anything leaves the process, MCP answers withhold quotes that look
  like prompt injection, and a route only receives customer content when it has been approved to.

## Models

Routing lives in `api/config/ai.json` (copy `api/config/ai.example.json`). The shipped example
sends the expensive work nowhere cheap work will do:

| Tier | Model on Nebius Token Factory | Used for |
|---|---|---|
| `small` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | feeling labels, match/dedupe judgement — the high-volume calls |
| `mid` | `nvidia/nemotron-3-super-120b-a12b` | extraction, grounded Q&A, reply drafts |
| `large` | `nvidia/Nemotron-3-Ultra-550b-a55b` | decision briefs |

Nebius Token Factory is OpenAI-compatible (`https://api.tokenfactory.nebius.com/v1`), so the
adapter is the same one used for any OpenAI-shaped vendor. Set `NEBIUS_API_KEY`; `AI_DAILY_BUDGET_USD`
caps spend per workspace per 24 hours, and work waits rather than failing when the cap is reached.

```bash
cd api && NEBIUS_API_KEY=... go run ./cmd/aismoke   # one prompt per tier: who answered, tokens, cost
```

Quality is measured, not asserted: `make eval` runs the extraction, Q&A and brief prompts against
thresholds in `api/eval/thresholds.json`, and `make eval-gate` proves the harness still catches
deliberately worse prompts. Grounded Q&A has been measured at 20/20 unanswerable questions refused
and 20/20 false-premise questions refused on a small synthetic set.

## Public sources (Tavily)

Requests get an optional public check. Two searches run — the request's title, and how other
products solve the same thing — then one model reads every returned title and snippet and answers two
questions. First, one of four verdicts — `already_supported` (the capability people are asking for
already exists), `known_issue` (this exact problem is already reported publicly as broken),
`demand_signal` (people on other products are asking for the same thing) or `no_signal` (nothing
relevant came back). That distinction matters: a request that is really a documentation gap
should not be built as a feature. Second, up to three **patterns**: one sentence each on how other
products solve it, with the page it came from — inspiration with a receipt, for the design
conversation that follows.

Three rules keep it from becoming a rumour machine:

- **Only links the search returned.** The model is given the results and may cite nothing else; an
  invented or altered URL is rejected the same way a hallucinated quote is.
- **The query is the request's neutral title, never a quote.** The query leaves the building to a
  third party, so a customer's words never do.
- **It is not evidence.** The verdict sits in its own box, labelled "Not customer evidence", and is
  never added up with what customers said.

`TAVILY_API_KEY` switches it on; unset, the endpoint answers `not_configured` and the card is hidden.
The answer is stored on the request with the time it was checked and can be re-run.

## Integrations

Every outside service is behind `INTEGRATIONS_ENABLED`; a service that is off hides its screens,
refuses its calls and runs no background work.

| Service | Direction | Default |
|---|---|---|
| Slack | connect a workspace; issue notifications | **on** |
| GitHub | one tracker per workspace: issues from requests | **on** |
| Linear, Jira Cloud, ClickUp, Asana, Azure DevOps | alternative trackers | off |
| HubSpot, Salesforce | account value, read-only | off |
| Outbound webhooks | signed JSON to any HTTPS endpoint; Slack, Discord and Teams formats | on |
| Stripe | billing (a test key outside production) | off — everything included, nothing billed |
| Resend | transactional email and inbound support mail | off until a key and a verified sender |
| AssemblyAI / OpenAI audio | transcription behind `internal/transcribe` | off |
| S3-compatible storage | recordings (Supabase Storage works) | off — local disk or unset |
| MCP server | ten tools for assistants; two write tools behind an opt-in `write` permission; remote assistants sign in through OAuth with an admin's approval | local `cmd/mcp` or hosted at `/mcp` |
| Public API | scoped, expiring, address-limited keys | on |

## Security and privacy

- Row-level security plus a restricted application role; isolation and role sweeps are generated
  from the API contract and run against every endpoint, including "another workspace" and
  "lower role" cases.
- Nothing is sent to a customer without an approved state, enforced inside the send function.
- Every outgoing message and webhook is signed; unsubscribe and share links are signed and
  revocable; credentials for connected services are sealed with `SECRETS_KEY`.
- Rate limits are counted in Postgres, or in Redis when `REDIS_URL` is set.
- Retention deletes on a schedule: Q&A after 180 days, per-call AI cost records after 400, admin
  notices after 30, dismissed suggestions after 90. Personal data is erased across every tool when
  a person is deleted.
- Secrets and personal data never go in code, logs, URLs, error messages or client bundles.
  `.env` is git-ignored; `.env.example` carries names only.

## Quick start

Prerequisites: Go 1.27+, Node 22+, Docker, `make`.

```bash
cp .env.example .env            # names only; no secrets in git
make dev-db                     # Postgres 18 + pgvector in Docker
make migrate                    # schema and job-queue migrations
make dev-role                   # restricted login role (once)
make devauth                    # stand-in identity provider on :9999 (its own terminal)
make api                        # http://localhost:8080/healthz
make web                        # http://localhost:3000
```

Set `DATABASE_URL`, `SUPABASE_JWKS_URL` and `JWT_ISSUER` in `.env` from the template, and put
`ENABLE_DEV_AUTH=true` in `web/.env.local` for local sign-in. Provider keys are optional: with none
set, everything except AI features still runs; with `AI_CONFIG` unset, questions are switched off.
`TAVILY_API_KEY` enables the public-source check on a request; `ASSEMBLYAI_API_KEY` enables transcription.

```bash
curl 'localhost:9999/token?sub=<any uuid>'   # an actor token for the API
APP_MODE=worker go run ./cmd/server          # run the background worker
```

Tool stand-ins for local work: `cmd/devmodel` (models), `cmd/devmail` (email), `cmd/devslack`,
`cmd/devgithub`, `cmd/devstripe` and friends (integrations). Nothing in this repository talks to a
real vendor in tests.

**No backend, no sign-in:** `make preview` serves the real screens on sample data at
http://localhost:3100/mock, with switches for empty, slow, failing and signed-out states. See
`web/mock/README.md`.

## Checks

```bash
make check        # everything CI runs: backend, web, generated-code drift
make api-check    # gofmt, go vet, tests with -race, govulncheck (if installed)
make web-check    # eslint, tsc, vitest, npm audit
make e2e          # Playwright on desktop and phone against the real local stack
make security     # static analysis plus dependency audits
make eval         # measure AI features against thresholds (costs a few cents)
make backup-drill # dump, restore into a clean database, prove equivalence
make deploy-drill # run the container images, break one, roll back
```

CI is manual-only (`workflow_dispatch`): run the checks locally before a commit, and trigger CI by
hand for a release candidate.

## Deployment

`make images` builds the API/worker and web images. Production needs an https Postgres with
`pgvector`, JWKS settings for the identity provider, `ALLOWED_ORIGINS`, `UNSUBSCRIBE_SECRET`,
`PUBLIC_BASE_URL` and `TRUSTED_PROXY_HOPS`; the API and the worker run the same binary with
different `APP_MODE`. Heavy jobs run on the `research` queue (`WORKER_QUEUES`). Recordings go to an
S3-compatible bucket in production. Migrations are forward-only goose files and are applied with
the privileged `DATABASE_ADMIN_URL`, which the API and worker never receive.

Reference material: `docs/engineering-principles.md` (the ten principles and the PR checklist),
`docs/PLATFORM.md` (tools, permissions, workspaces), `docs/webhooks.md`,
`docs/INTEGRATIONS-PLAN.md`, `docs/MCP-PLAN.md`, `docs/gates/` (one record per phase gate).

## Layout

| Folder | What |
|---|---|
| `web/` | Next.js client: public site, app screens, preview build, browser tests |
| `api/` | Go API and worker: `cmd/server`, `cmd/migrate`, `internal/*`, `migrations/`, `openapi.yaml` |
| `docs/` | Engineering principles, platform notes, gate records |
| `synthesis/` | Product research and spec (kept locally, not versioned) |

## Known limits

Stated plainly, because a feedback tool that hides its gaps is asking for trust it has not earned:

- Real email delivery (SPF/DKIM), Slack, GitHub and Stripe have only been exercised against local
  stand-ins in `api/cmd`, never a live vendor.
- Transcription ran once end to end against AssemblyAI (a 13-second clip, diarized, extracted into
  three cited proposals); it has not been tried at scale. Meaning-based matching needs an embeddings
  provider and is off by default.
- Public sources ran against the live Tavily API once (a `known_issue` verdict with a real documentation link); no rate-limit or cost testing.
- Feeling labels have been agreed with humans on a small sample, not the planned 200 labels.
- Company sign-in (SSO) is built and off unless `SSO_ENABLED=true`.
- There is no hosted deployment yet; the local stack and container images are what exist.

## License

AGPL-3.0. You can run, study, modify and self-host madfeed, including commercially. If you run a
modified version as a network service, you must offer its source to the people using it. The name
is not a trademark grant.

If you would like to contribute, open an issue first; a contributor licence grant is required so
the project can be relicensed if it ever needs to be.
