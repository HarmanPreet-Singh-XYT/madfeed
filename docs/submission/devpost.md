# Devpost submission — madfeed

Track: **Best Apps and Agents**
Repository: `https://github.com/HarmanPreet-Singh-XYT/madfeed` (AGPL-3.0)
Demo: interactive preview (sample data) + a 3-minute walkthrough of a real run

---

## Elevator pitch (one line)

Customer conversations in, cited requests out — every request carries the customer's exact
words, or it does not exist.

## What it is

madfeed reads the conversations a product team already has — support chat, email, call
transcripts, pasted threads, tickets, survey free text — and turns them into prioritised requests
where **every claim is backed by a verbatim quote from a real customer**, stored at the byte
offsets where it appears in the source.

The model proposes; the code disposes. A suggestion survives only if its quote appears word for
word in the conversation, checked in Go and again by a Postgres trigger on write. Extracted
statements that fail the check are refused, not stored. The same rule runs through grounded Q&A
(answer with a stored quote, or refuse), the review queue, decision briefs and the workspace
export.

## The problem

Feedback tools summarise. A summary is convenient and unarguable, which is the problem: six weeks
later nobody can say who asked, what they said, or whether a request came from one loud account or
forty quiet ones. Teams end up making roadmap decisions from paraphrase, and then can't defend
them.

## How it works

1. **Intake** — paste, CSV, upload, website chat, email, or the public API. Text is chunked with
   overlap so a sentence cut by a boundary is whole in at least one window.
2. **Extraction** — a model returns structured statements (`need`, `bug`, `praise`, `question`)
   with a quote, a title and a confidence. Greetings, small talk and non-feedback are dropped by
   the prompt and by the verbatim check.
3. **Review** — a person accepts or dismisses each suggestion. Accepted ones become requests with
   cited evidence; duplicates are matched against existing requests.
4. **Impact** — value is summed over *distinct* accounts behind a request, maintained by trigger,
   so one big customer cannot be counted forty times.
5. **Close the loop** — approved drafts are generated from each person's own quotes, sent, logged,
   and marked "told about this". Nothing is sent from an unapproved state; that is enforced inside
   the send function, not the UI.

## How Nebius Token Factory and NVIDIA Nemotron are used

Every model call goes through one provider seam (`api/internal/ai`). Features ask for a tier;
configuration maps each tier to an ordered list of routes; the router falls back on outages, rate
limits and bad keys and records every attempt.

| Tier | Model on Nebius Token Factory | Used for | Why this tier |
|---|---|---|---|
| `small` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | match/dedupe judgement, feeling labels | the highest-volume calls; cheap per token |
| `mid` | `nvidia/nemotron-3-super-120b-a12b` | extraction, grounded Q&A, reply drafts | the reasoning that decides what survives |
| `large` | `nvidia/Nemotron-3-Ultra-550b-a55b` | decision briefs | few, expensive, high-stakes |

The point of the split is economic: the cheap model filters the noise, so the expensive model only
ever sees text that already survived a citation check. That is also why the cost table is a feature
— Quality shows which model did what, how many calls, failures and what it cost, read from the
`ai_event` row written for every single call.

Token Factory is OpenAI-compatible, so the adapter is 15 lines on top of the OpenAI client, with
JSON mode and the real schema sent per request; output is validated against the same JSON Schema
before it is accepted.

## How Tavily is used

On a request, **Check public sources** runs two Tavily searches — the request's title, and how other
products solve the same thing — and has Nemotron read every returned title and snippet. The answer is
one of four verdicts (`already_supported`, `known_issue`, `demand_signal`, `no_signal`) with a one-sentence reading
and the links it rests on, plus up to three **patterns**: one line each on how other products solve
it, with the page it came from. That is the design conversation, with receipts.

It is used three narrow ways, not one: **search** on the request, **extract** of the first result so
the verdict rests on the page rather than on a snippet, and **search on a company** in the company
drawer, by the name and domain in the workspace's own directory — never by anything a customer said.
Company research refuses a name collision: if the results are a different company that shares the
name, it says so and cites nothing.

Why this is the right job for a web search in a feedback tool: a request is not always a feature. It
is often a **documentation gap** ("this already exists, here is the page") or a **known public issue**
("the vendor already lists this error"). Telling those apart stops a team from building
something that already works.

It is built to the same rule as everything else here:

- The model may cite **only URLs the search returned**. An invented or altered link is rejected the
  same way a hallucinated quote is (`ErrInvalidOutput`), so the answer cannot carry a broken citation.
- The search query is the request's **neutral title, never a customer quote** — the query leaves the
  building to a third party, so a customer's words never do.
- The result is stored **separately from evidence** and labelled "Not customer evidence". A docs page
  is never added up with what a customer said.

It changes two screens, not one: the request itself, and **Quality**, where every request is rolled up
by verdict and the **Already possible** ones are listed as documentation work instead of roadmap
work.

Measured on live calls: "Stripe webhook signature verification fails" → `known_issue` with the real
Stripe documentation page; "Dark theme feature request" → `demand_signal` with the forum thread asking
for it; "Dark mode" → `already_supported` with three sources and three patterns, and it appears in
the Already possible list.

## What was built during the submission period

The whole product: Go API and worker, Next.js client, schema, migrations, contract, tests. The
commit history is the record.

## Numbers from a real run (on the video)

- A 6-message support conversation, containing a bug, a request, a compliment, two greetings and
  "hope you had a good weekend".
- → **3 proposals, 3 verbatim quotes, 0 uncited statements**, small talk discarded.
- → 1 accepted → request "CSV export failure" with cited evidence at byte spans 99–190, verified.
- Extraction call: `nvidia/nemotron-3-super-120b-a12b`, 391 in / 670 out, **$0.000720**, ~2 s.
- Grounded Q&A refuses rather than guesses: 20/20 unanswerable and 20/20 false-premise questions
  refused on a small synthetic set.

## Engineering that is not visible in a demo

- Tenant isolation is structural: every table has `workspace_id` and row-level security; every
  request runs in a transaction that sets the workspace; a new table without a policy fails tests.
- Every stored quote is checked three times: by the extractor, by the service, and by a database
  trigger.
- Contract first: `openapi.yaml` generates the Go stubs and the TypeScript client; isolation and
  role sweeps are generated from the same contract, including "another workspace" and "lower role".
- Customer text is treated as hostile: instructions separated from data, secrets redacted before
  any vendor call, MCP answers withhold quotes that look like prompt injection.
- Retention deletes on a schedule; personal data is erased across every tool when a person is
  deleted.

## What is not finished (stated on purpose)

- Email delivery, Slack, GitHub and Stripe have been exercised against local stand-ins only.
- Transcription ran once end to end against AssemblyAI (13-second clip, diarized, three cited
  proposals extracted from it); not tried at scale. Meaning-based matching is off by default.
- Feeling labels have human agreement on a small sample, not the planned 200 labels.
- No hosted production deployment yet: the local stack and container images are what exist.

## Feedback on Nebius Token Factory, AI Cloud and NVIDIA models

Used Token Factory's OpenAI-compatible API for every model call in this project (three Nemotron
models across three tiers, chat completions with JSON mode and a per-request JSON Schema).

**What worked well**

- The OpenAI wire format meant a working adapter in an afternoon. Base URL plus key, nothing else.
- JSON mode plus schema-constrained output held up: extraction returned valid JSON every time, and
  the quotes it produced matched the source character for character.
- Three model sizes with a huge price spread (0.06 → 1.00 per 1M input) is exactly the shape a
  product wants; tiering is a first-class design decision, not a workaround.
- Latency was consistently sub-second for short prompts, which makes the review queue feel instant.
- Per-token usage came back on every response, so cost accounting needed no estimation.

**What needs work**

- **Model id casing is inconsistent and undocumented.** `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`,
  `nvidia/nemotron-3-super-120b-a12b` and `nvidia/Nemotron-3-Ultra-550b-a55b` are all live at the
  same time. Guessing the wrong case returns `404 The model ... does not exist` with no hint that
  casing is the problem. Ids should be case-insensitive, or the error should suggest the closest
  match. This cost me two failed runs.
- **Reasoning tokens consume `max_tokens` silently.** A 20-token budget returned an empty
  `content` with `finish_reason: "stop"` — not a truncation error, an empty answer. A one-word
  reply used 57 completion tokens, 56 of them reasoning. Either expose a separate reasoning budget
  or fail loudly when reasoning consumes the whole allowance.
- **Pricing is hard to find from the API surface.** The model catalog page renders client-side, so
  prices had to be confirmed from third-party listings. A `GET /v1/models` field with current
  prices would remove a whole class of guesswork.
- **Onboarding is Discord-led.** A `curl` of `/v1/models` right after key creation, with ids and
  prices in the response, would get a builder to hello-world faster than any doc page.

**Would I build with it again?** Yes — the tiering story is the reason. The friction was all in
discovery (which id, which case, which price), not in the API itself.

---

## Suggested Devpost fields

- **Project name**: madfeed
- **Tagline**: Every request carries the customer's exact words, or it does not exist.
- **Built with**: Go, PostgreSQL, pgvector, Next.js, TypeScript, Nebius Token Factory, NVIDIA
  Nemotron, Tavily, AssemblyAI, Docker
- **Links**: repository (AGPL-3.0), 3-minute video, interactive preview
- **Testing instructions**: sign in with the demo account printed on the submission; the workspace
  opens on the review queue with one conversation already ingested.
