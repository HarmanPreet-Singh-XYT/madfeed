# Gate 1 record (in progress): paste to request

Date: 2026-10-22    Environment: local (Docker Postgres 18 + pgvector)
Status: **BACKEND AND HTTP API BUILT, GATE OPEN.** No UI, no gold sets, no real model yet.

## Built and tested (against real Postgres, fake model)

| Gate 1 item (`07`) | Result | Evidence |
|---|---|---|
| Span integrity | PASS (synthetic) | Three independent checks: extractor (`extract`, verbatim `Locate`), worker (`spans.Validate` before insert), and a database trigger on `evidence` and `proposal` that compares the quote to the source bytes. `store` test: paraphrase, shifted offsets, case change, out-of-range, zero length and negative start are all rejected by the database, valid unicode (byte offsets) accepted. Fuzzing `spans` (Split tiling + Locate/Validate) ran millions of inputs with no failure. The 500-extraction run on real model output is still to do. |
| Source text immutable | PASS | trigger blocks UPDATE of `raw_text` (offsets depend on it) |
| Ingest robustness | PASS (partial) | empty, blank, invalid UTF-8, NUL byte, too long, long title, non-http(s) URL rejected with a safe message; CRLF normalised; same text twice stores once and queues no second job; failures write nothing. Not yet: property tests for huge inputs end to end, emoji-only, 1-char. |
| Transactional enqueue | PASS | source item, chunks and the extraction job commit together (checked in `river.river_job`) |
| Worker idempotency | PASS | partial failure keeps found proposals and retries; a re-run adds no duplicates; a finished item is skipped without a model call |
| Review queue behaviour | PASS | accept (with rename), merge into existing request, dismiss, undo (restores exact prior state; request kept if it has other evidence), bulk accept only at or above the threshold, double-accept refused, same quote cannot be linked twice |
| Authorization | PASS | other workspace gets "not found" on accept/dismiss/list; viewers can read but not ingest, accept, dismiss or undo; cross-tenant links are rejected by composite foreign keys |
| AI event logging | PASS | each model call writes an `ai_event` row with workspace, model, tokens, cost |
| Customer data routing | PASS | extraction requests are marked as customer data; routes not approved for it are never used |

## HTTP API (added)

| Item | Result | Evidence |
|---|---|---|
| Authentication on every route except health | PASS | `internal/api` `TestAuthenticationIsRequiredEverywhereExceptHealth`: no token, garbage token and malformed token all get 401 with `WWW-Authenticate`, and the body never says why. Mutation check: removing the middleware failed 6 tests. |
| Membership and roles from our tables, never from the client | PASS | non-members get 404 on every workspace route (indistinguishable from a missing workspace); viewers read but get 403 on ingest, accept, dismiss, undo. Mutation check: forcing admin failed the role test. |
| Request validation against the contract | PASS | unknown fields, wrong types, broken JSON, bad ids, out-of-range limits and bad enum values get 400 with a generic message |
| Error hygiene | PASS | no SQL, file paths or stack text in any error body; every error carries a request id; unknown errors are logged server-side only |
| Cost guard | PASS | per-workspace daily ingest cap (default 5 MB, counted in the database so it holds across instances) returns 429; other workspaces unaffected |
| Pagination | PASS | keyset cursor, no repeats across pages, bad cursor rejected |
| Real run | PASS | API against Docker Postgres with a local token service: health, 401s, create workspace, paste, duplicate paste, job queued, security headers. Worker not run (no AI key). |
| Contract | PASS | endpoints generated from `api/openapi.yaml`; TypeScript types regenerated; drift check green |

Dev tooling added: `cmd/migrate` (schema + job-queue migrations with a privileged URL), `cmd/devauth` (local-only token service so the web app can be built before Supabase exists).

## Not done yet (Gate 1 stays open)

| Item | Needs |
|---|---|
| Extraction quality on real conversations: gold set v1 (50 conversations, two reviewers), target >= 0.80 precision and >= 0.70 recall | partner-style data, a real model key and config |
| Matching (new request vs evidence for an existing one) and its gold set (100 pairs, false-merge <= 5%) | embeddings provider; not started. All proposals are currently `new_request`. |
| Prompt-injection suite (20 adversarial pastes) against a real model | real model; the prompt fences the data with a random marker and tells the model it is untrusted, but only a fake model has run |
| Latency and cost (p95 < 30 s for 2,000 words; 20 parallel pastes) | real model |
| Requests table, filters, saved views, request detail screens | web UI |
| Time-to-value stopwatch test (5 testers, < 5 min) | UI |
| Sample generator for first run | UI + model |

## Known limits worth remembering
- **Chunk boundaries (mitigated).** Each chunk is shown to the model with 400 bytes of neighbouring text on both sides (`extract.DefaultOverlap`), so a sentence cut by a boundary is whole in at least one window; spans are deduplicated across windows (the more confident one wins). Test: a quote forced across a boundary is lost with no overlap and recovered exactly once with overlap. A single statement longer than the overlap and also straddling a boundary can still be missed. A found quote may run into the next chunk; `chunk_id` points to where it starts and the span is authoritative.
- **Exact copying (mitigated).** If the model's quote differs only in case, whitespace, curly vs straight quotes or dashes, invisible characters, or edge punctuation, `spans.LocateLoose` maps it back to the source and the stored quote is the source's own text, never the model's. Refused: paraphrases, anything under 12 characters, fragments joined with "...", and quotes that occur more than once (ambiguous). Counters: `Result.Snapped` (how often the model was sloppy) and `Dropped.NotVerbatim` (how often it could not be matched at all). The prompt version is now `extract-v2`.
- Guarantee unchanged: every stored quote equals the source bytes at its span; the extractor, the worker and a database trigger each check it.
- Still unknown until a real model runs: the real snap rate and drop rate. If drops stay high, the next step is to have the model cite numbered sentences instead of copying text.
- The 6,000-byte chunk size, 400-byte overlap, 200 kB paste cap and 40 statements per chunk are starting guesses.
