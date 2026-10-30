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
| **Who else ships it** | On a request, asks Tavily which other products already ship this and how they built it; on a company, what the web says about them — links recorded, never mixed with customer evidence |
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

### What Nebius Token Factory enabled

- **One adapter, three models.** The OpenAI wire format meant the provider is a single case in
  `api/internal/ai/langchain/providers.go` — no vendor SDK, no second code path for extraction,
  briefs, or Q&A.
- **The pipeline's stages map onto the price ladder.** Nano filters and de-duplicates the volume at
  $0.06 per million input tokens, so the expensive model only ever sees text that survived a citation
  check; Super extracts and answers at $0.30; Ultra is reserved for briefs at $1.00. Cost follows
  value instead of a flat model choice.
- **Structured output, priced per call.** JSON mode plus per-response usage meant schema validation
  and cost accounting (`ai_event`) needed no estimation — every call records provider, model, prompt
  version, tokens and dollars.
- **Fast enough to sit in front of a person.** Short prompts answer in well under a second, so the
  review queue never feels like waiting on a model.

Nebius services used: **Token Factory only** — no AI Cloud compute, Serverless Endpoints or
Serverless Jobs. Everything else in the stack runs locally or on a single VPS.

Quality is measured, not asserted: `make eval` runs the extraction, Q&A and brief prompts against
thresholds in `api/eval/thresholds.json`, and `make eval-gate` proves the harness still catches
deliberately worse prompts. Grounded Q&A has been measured at 20/20 unanswerable questions refused
and 20/20 false-premise questions refused on a small synthetic set.

## Who else ships it (Tavily)

**It is not a button you have to remember.** Every request created from the review queue is checked
automatically, so it arrives with its market context already attached; the decision brief states it
too, which turns "what did customers ask for" into "should we build this". Pressing the button re-runs
it. Two searches run — the request's title, and the title
with "competitor product how it works" — then one model reads every returned title and snippet and
answers:

- `others_ship_it` — one or more other products already offer this; the summary names them
- `prior_art` — no product is shown shipping it, but write-ups, discussions or open-source projects
  describe how it is done
- `no_signal` — nothing in the results is about this idea

Plus up to three **patterns**: one line each on how a named product or team does it, with the page it
came from. That is the design conversation, with receipts.

Rules that keep it honest:

- **Only links the search returned.** The model may cite nothing else; an invented or altered URL is
  rejected the same way a hallucinated quote is. When a pattern cites a page that was not in the
  results, only that pattern is dropped.
- **The query is the request's neutral title, never a quote.** The query leaves the building to a
  third party, so a customer's words never do.
- **It is not evidence.** The verdict sits in its own box, labelled "Not customer evidence", and is
  never added up with what customers said.
- **The first result is read in full** (Tavily Extract), so a verdict rests on what the page says
  rather than on what a snippet promised; if the page cannot be read, snippets are used and nothing
  fails.

The same client answers a second question on a company: **What the web says** in the company drawer
searches by the name and domain in your own directory — never a customer's words — and stores two
sentences plus at most two sources on the account. It refuses to describe a different company that
shares the name.

It shows up in three places: on the request (verdict, sources, patterns), on **Quality** (every
request rolled up by verdict, and an **Already built elsewhere** list), and in the company drawer.

`TAVILY_API_KEY` switches it on; unset, the endpoints answer `not_configured` and those surfaces hide.

## Integrations

Every outside service sits behind `INTEGRATIONS_ENABLED`. A service that is off hides its screens,
refuses its calls and runs no background work, while anything already stored stays readable.

### Built, and what each one does here

| Service | What it does | Default |
|---|---|---|
| **Slack** | Connect a workspace and pick a public channel: its messages are read as conversations and go through extraction like anything else | on |
| **GitHub** | One tracker per workspace: create an issue from a request; when the issue closes or reopens, the request moves to the status an admin mapped to it | on |
| **Linear, Jira Cloud, ClickUp, Asana, Azure DevOps** | The same issue flow through one driver framework; one tracker per workspace | off |
| **HubSpot, Salesforce** | Read-only account value, so a request's impact is priced without typing numbers in | off |
| **Outbound webhooks** | Signed JSON to any HTTPS endpoint on request created, status changed, suggestions ready, release note published or survey completed; also rendered for Slack, Discord and Teams channels | on |
| **Stripe** | Billing; a test key outside production, and with no key everything is included and nothing is billed | off |
| **Resend** | Transactional email, and inbound support mail into the shared inbox | off until a key and a verified sender |
| **AssemblyAI / OpenAI audio** | Transcription behind `internal/transcribe` | off |
| **S3-compatible storage** | Recordings instead of local disk (Supabase Storage works) | off |
| **MCP server** | Ten tools for assistants (`cmd/mcp` or hosted at `/mcp`); two change statuses and tags behind an opt-in `write` permission; remote assistants sign in through OAuth with an admin's approval | local or hosted |
| **Public API** | Scoped, expiring, address-limited keys for reads and for intake | on |

The rule that holds across all of them: **a quote, a name or an email never goes to a tracker or a
CRM.** Issues carry the request title, the link and counts; the customer's words stay here.

### Getting data in without an integration

Most tools do not need a connector. Four paths already accept anything:

- `POST /v1/ext/feedback` — a conversation or a ticket from any tool, with the other side's id so it
  is stored once (a webhook or a Zapier/Make step is enough)
- `POST /v1/ext/transcripts` — a call transcript from any recorder
- **Support email** — forward a support address into the inbox
- **Website chat** — an origin-restricted widget, rate-limited per address
- **CSV import** with strict validation for people, accounts and requests

### Not built yet, and how they would feed in

Kept honest in `docs/INTEGRATIONS-BACKLOG.md`, which has effort, order and what each needs. The
short version:

| Group | Examples | What it would add | Today |
|---|---|---|---|
| Help desks | Intercom, Zendesk, Help Scout, Freshdesk, Gist | capture solved conversations automatically | send the thread to `/v1/ext/feedback` from an automation |
| Call tools | Gong, Fathom, Fireflies, Grain, tl;dv, Zoom, Meet | transcripts arrive on their own | send the transcript to `/v1/ext/transcripts` |
| Forms and surveys | Typeform, Google Forms, SurveyMonkey | free-text answers land in the review queue | post answers to `/v1/ext/feedback` |
| Reviews | G2, Capterra, Trustpilot, app stores, Product Hunt | new reviews captured | paste, or send each (check the site's terms first) |
| Team chat as a source | Microsoft Teams, Discord | collect feedback where people already talk | outbound notifications already work |
| Identity | Okta, Entra ID, OneLogin, Google Workspace | auto-join by company domain, SCIM | company sign-in exists (off by default) |
| Data in and plugins | Segment, a browser extension, WordPress, Shopify | capture from anywhere, publish the form | the form is embeddable today |
| Marketplaces | Zapier, Make, the Slack app directory, assistant connector directories | distribution | generic web-request steps work |

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

**Everything in containers:** `deploy/docker-compose.local.yml` runs the web app, the API, the worker
and a local identity stand-in against a hosted Postgres — see `docs/DEPLOY.md`.

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

Three ways, smallest first.

**Local demo stack** (`deploy/docker-compose.local.yml`): web, API, worker and an identity stand-in,
all on localhost, talking to a hosted Postgres. Sign-in costs no network round-trip and page loads are
milliseconds, which is what you want for a demo. `docker compose -f deploy/docker-compose.local.yml
up -d --build`, then http://localhost:3000.

**One VPS** (`deploy/docker-compose.yml` + `deploy/nginx.conf`): API and worker behind the nginx you
already run, web on Vercel. Step by step in `docs/DEPLOY.md`.

**From the images directly**: `make images` builds the API/worker and web images.

Whichever way, production needs an https Postgres with `pgvector`, JWKS settings for the identity
provider, `ALLOWED_ORIGINS`, `UNSUBSCRIBE_SECRET`, `PUBLIC_BASE_URL` and `TRUSTED_PROXY_HOPS`; the API
and the worker run the same binary with different `APP_MODE`. Heavy jobs run on the `research` queue (`WORKER_QUEUES`). Recordings go to an
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
