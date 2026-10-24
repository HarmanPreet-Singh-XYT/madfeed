# Gate 0 record (in progress)

Date: 2026-10-22    Commit: uncommitted    Environment: local (macOS, Docker Desktop, Go 1.27.3, Node 26)
Status: **PARTIAL.** Local pieces proven; Supabase, AI-provider, storage and email pieces not yet run.

## Passed locally (evidence = test names in `api/`)

| Gate item (`07` Phase 0) | Result | Evidence |
|---|---|---|
| Tenant isolation | PASS | `internal/store` `TestTenantCannotReadOrChangeAnotherTenantsRows`: B cannot read, list, update, delete or insert into A's rows. Mutation check: replacing the `request` policy with `true` made 3 tests fail; restored. |
| No tenant context = no access | PASS | `TestNoTenantContextSeesNothingAndWritesNothing`, `TestTenantSettingDoesNotLeakToNextPoolUser` (settings are transaction-local, 20 pooled reads see nothing) |
| New table without RLS fails the suite | PASS | `TestEveryTableIsTenantScopedWithForcedRLS` (RLS enabled + forced, at least one policy, `workspace_id` column) |
| Role bypass | PASS | `TestBackendRoleIsRestricted`: backend role is not superuser, not BYPASSRLS, owns no tables. `service_role` is not referenced anywhere in `api/` or `web/` (web test enforces). |
| Job queue | PASS | `internal/jobs`: job fails twice then succeeds, 3 attempts, side effect ran exactly once; a rolled-back transaction leaves no job (transactional enqueue). Not yet tested: killing the worker mid-job, two workers. |
| JWT verification | PASS | `internal/auth`: expired, wrong audience, wrong issuer, no expiry, bad subject, wrong key, tampered, garbage, empty, `alg: none`, HS256 key-confusion all rejected; rotated key accepted without restart. Tested against a fake JWKS server, not real Supabase. |
| Next.js boundary | PASS | `web/tests/boundary.test.ts` fails if database or service-role code is imported |
| Security headers | PASS | API (`httpx` tests, curl check) and web (`web/tests/security-headers.test.ts`) |
| Dependency hygiene (local) | PASS | `govulncheck`: 0 affecting code. Fixed by pinning Go 1.27.3 (10 stdlib advisories on 1.27.1) and bumping `moby/go-archive`. Open, not called: GO-2026-5932 (`x/crypto/openpgp`, no fix). `npm audit` clean. |
| Contract | PASS | `api/openapi.yaml` (OpenAPI 3.0.3) generates Go stubs (oapi-codegen, strict server) and a typed TypeScript client (openapi-typescript + openapi-fetch). `make check-generated` fails on stale output (mutation-checked). Live responses validated against the spec (`internal/api` `TestLiveResponsesMatchSpec`); requests that don't match the spec are rejected before reaching a handler. The generated client called the running Go API in a Vitest run (`API_URL=... npm test`). Not yet called from a Next.js page or through the browser (CORS untested end to end). |
| AI provider abstraction | PASS (fakes) | `internal/ai`: tier routing from config, fallback on outage/rate limit only (not on bad request or refusal), every attempt recorded with provider, model, tokens and cost, bad config fails at startup |
| LangChain adapter + 3 providers | PASS (canned vendor responses) | `internal/ai/langchain` wraps any langchaingo model: system/user/assistant messages, model and max-token options, token usage incl. cached tokens, structured output validated against the JSON Schema (invalid or non-JSON output rejected), standardised errors mapped to ours, own-context cancellation stops instead of falling back. Providers wired: Anthropic, OpenAI, Gemini (`google`), DeepSeek (OpenAI-compatible client, tested against a fake server), enabled by API key; routes carry an `allow_customer_data` flag enforced by the router (tested); tiers/routes/prices in a config file that refuses placeholder model ids. Wire tests run the real OpenAI and Anthropic client code against canned responses and found two bugs now fixed: Anthropic usage keys and input-excludes-cache semantics (cost was wrong), and OpenAI/Anthropic errors arriving as untyped text (now classified by HTTP status). Gemini wiring builds but its responses and error format are unverified. **No real vendor call has been made**: run `go run ./cmd/aismoke` with keys and a real `config/ai.json`. |
| Email abstraction | PASS (fake server) | `internal/email` + `resend` adapter: idempotency key required, transient vs permanent errors classified, error text never echoes recipients |
| Race checks | PASS | all Go tests run with `-race` |
| Latest-dependency spike, local steps | PASS | `goose` migration with RLS, `sqlc` query inside tenant-scoped transaction, River job, Postgres 18 + pgvector 0.8.7 in Docker, API container image builds |

## Not yet run (need accounts, keys or more work)

| Item | Blocked on |
|---|---|
| Sign-in through real Supabase Auth; verify its JWKS and signing-key mode | Supabase project |
| Supabase exposure test (publishable key, formerly anon, denied on every table and bucket) | Supabase project |
| Pooler behaviour: pgx statement caching off, River on a direct/session connection | Supabase project |
| Real calls through `internal/ai` for each enabled provider (structured output, streaming); fallback across two real providers | API keys for at least two providers; adapters (router and fakes are built and tested) |
| Storage upload/fetch with signed URLs | Supabase project |
| Resend send/receive, SPF/DKIM/DMARC, idempotent retry, inbound support | `RESEND_API_KEY`, sender domain (adapter built, tested against a fake server only) |
| Credential-type tests (publishable key, secret key, webhook signature) | not built yet |
| CI catches a deliberate type/lint error; deploy and rollback; dependency-bot PR | CI is manual-only and nothing is deployed; no remote |
| Worker killed mid-job; two workers | more tests |
| Manual L8 script (sign up, workspace, invite, delete with typed confirmation) | auth and UI not built |

## Findings worth keeping
- `sqlc` infers the wrong type for a row-value keyset comparison; explicit casts (`sqlc.arg(x)::timestamptz`) fix it.
- River tables live in their own `river` schema so they stay out of the tenant-table check and any auto-generated API.
- The backend login role is created outside migrations (no password in the repo); migrations only create the NOLOGIN `app_backend` group role.

## Decision
Proceed with the local build; repeat the "not yet run" rows once the Supabase project exists. Gate 0 does not close until they pass.

## Update 2026-10-23 (hosted Supabase checked)
Environment: Supabase project, session pooler (the direct host is IPv6-only and this dev machine has no IPv6 route).
- Migrations 1 to 8 applied to the hosted database; all 19 app tables have row-level security forced.
- **Exposure test, publishable key (REST + RPC + storage): PASS after a fix.** It found that goose's own `goose_db_version` table was readable and writable (insert, update, delete, truncate) with the public key. Migration `00008_lock_public_roles` revokes all public-role access, sets default privileges so future tables are not granted, and enables row-level security on it. Retested: every app table, `goose_db_version` (read and delete), the public-slug function and storage are denied or empty.
- Application role `app_api`: not superuser, does not bypass RLS, member of `app_backend`; sees 0 rows with no tenant set. Cross-tenant check on the hosted database (own workspace visible, other tenant's invisible, insert into another tenant's id refused by policy; rolled back, nothing left behind): PASS.
- `public_workspace_id()` (SECURITY DEFINER) runs as `app_api` on Supabase: PASS (closes the "does the owner bypass RLS there" question for this function).
- API against the hosted database with the real JWKS: `/healthz` and `/readyz` 200; no token, garbage token and the publishable key used as a token all 401.
- Real user sign-in (a genuine Supabase access token accepted end to end): NOT DONE; needs a test user.
- Not done: pooler transaction mode, storage bucket policies, backup and restore drill, deploy and rollback drill.
- DeepSeek key works (`cmd/aismoke`: all three tiers answered, about $0.0001).

## Update 2026-10-23 (later): hosted database at migration 10; real sign-in code
- Migrations 9 and 10 applied to the hosted database. Re-ran the exposure test: the publishable key holds no privilege on any public table or function (checked from the catalog and through the REST API for the new tables), row-level security is forced on all 28 app tables, the three `SECURITY DEFINER` functions are not visible through the public API and work as `app_api`.
- Email-and-password sign-in is built in the web app (server-side, httpOnly cookie, plain error messages that cannot be used to probe for accounts, publishable key only). It is tested against a local stand-in for Supabase's token endpoint (`api/cmd/devauth`), at desktop and phone size. **Not yet run against the real project**: that needs a confirmed test user. Sessions are renewed automatically: `proxy.ts` swaps in a fresh access token (using a second httpOnly refresh cookie) when fewer than 90 seconds remain, the upload route does the same so a long upload outlives one token, a dead refresh token clears the session, and sign-out removes both cookies. Tested against the stand-in with 100-second tokens at desktop and phone size. Supabase's real refresh-token rotation and reuse window are unverified.
- Bug found: the login page was rendered at build time, so the build's environment decided which form everyone saw (the development form could be frozen into a production build). It now renders per request.

## Update 2026-10-23 (latest): hosted database at migration 33
- Migrations 19 to 33 applied to the hosted database (forms, votes, digest, API keys, connections, issue links, billing, and the fixes found in review). Re-ran the exposure and isolation checks from the catalog: row-level security is forced on every app table; no table has forced RLS without a policy except the three closed ones (`goose_db_version`, `rate_limit`, `stripe_event`; the app role cannot read the last two); the public roles `anon` and `authenticated` hold no privilege on any public table and cannot run any `SECURITY DEFINER` function (19 of them, all with a pinned search path); the app role is not a superuser and does not bypass RLS. The only functions the public roles can run are two read-only settings helpers (`app_workspace_id`, `app_user_id`) and trigger functions (not callable through the API).
- Not re-checked through the REST API: the publishable key in `.env` was answered "Invalid API key" by the REST endpoint (so it was refused, but not for the reason being tested). The catalog check above is the real evidence.
