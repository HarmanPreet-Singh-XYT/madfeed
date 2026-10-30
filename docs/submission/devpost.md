# Devpost submission — madfeed

Track: **Best Apps and Agents**
Repository: `https://github.com/HarmanPreet-Singh-XYT/madfeed` (AGPL-3.0)
Demo: interactive preview (sample data) + a 3-minute walkthrough of a real run

---

## Elevator pitch (one line)

Customer conversations in; requests out that carry the customer's exact words — and, before anyone
builds one, who else already ships it.

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
4. **Market context, automatically** — the moment a request exists, a background job searches the
   public web for it (Tavily) and records who else already ships it, with links. By the time the
   reviewer opens the request, the comparison is already there; nobody pressed a button.
5. **Decision brief** — the brief is written from that request's quotes *and* states in one sentence
   what other products do, taken from the stored sources. It is the document a team decides from,
   so it answers "should we build this", not only "what did customers say".
6. **Impact** — value is summed over *distinct* accounts behind a request, maintained by trigger,
   so one big customer cannot be counted forty times.
7. **Close the loop** — approved drafts are generated from each person's own quotes, sent, logged,
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

It runs on its own. Accepting a suggestion creates a request, and a job immediately searches for that
request — so a reviewer opens a proposal and already sees "Productboard ships this", with the link,
without pressing anything. The **decision brief** then states what other products do in one sentence,
which is the difference between a summary of complaints and a build-or-don't recommendation.

Underneath, **Who else ships it** runs two Tavily searches — the request's title, and the title with
"competitor product how it works" — reads the first result in full with Tavily Extract, and has
Nemotron answer one question: **has someone already built this, and how?**

- `others_ship_it` — one or more other products offer it; the summary names them (Productboard for CSV
  export; monday.com, Manifestly and Atlassian for SAML single sign-on)
- `prior_art` — no product, but write-ups or open-source projects describe how it is done
- `no_signal` — nothing found

plus up to three one-line patterns on how a named product does it, each with its page.

Why this belongs in a feedback tool: the most expensive mistake is building something a competitor
already shipped, badly, last year. The check is one search away from the request, so the comparison
happens before the planning meeting rather than after.

The same client answers a second question on a company — what the web says about it, by name and
domain from the workspace's own directory, never a customer's words — and it refuses to describe a
different company that shares the name.

It changes more than one screen: the request, and **Quality**, where every request is rolled up by
verdict and the ones others already ship are listed as **Already built elsewhere**.

It is built to the same rule as everything else here:

- The model may cite **only URLs the search returned**; an invented link is refused like a
  hallucinated quote, and a pattern citing an unknown page is dropped.
- The search query is the request's **neutral title, never a customer quote**.
- The result is stored **separately from evidence** and labelled "Not customer evidence".

## What was built during the submission period

The whole product: Go API and worker, Next.js client, schema, migrations, contract, tests. The
commit history is the record.

## Numbers from a real run (on the video)

- A 6-message support conversation, containing a bug, a request, a compliment, two greetings and
  "hope you had a good weekend".
- → **3 proposals, 3 verbatim quotes, 0 uncited statements**, small talk discarded.
- → 1 accepted → request "CSV export failure" with cited evidence at byte spans 99–190, verified.
- Extraction call: `nvidia/nemotron-3-super-120b-a12b`, 391 in / 670 out, **$0.000720**, ~2 s.
- The market check ran by itself on that request. Live verdicts from the same workspace: CSV export →
  *Productboard*; SAML single sign-on → *monday.com, Manifestly, Atlassian*; dark mode → *Dark Reader,
  chrome web store*; and for one request honestly `no_signal`.
- The generated brief carried it: *"AppSheet publishes a troubleshooting guide that documents CSV
  export failures caused by missing locale settings and a two-minute time limit."*
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
- The automatic market check is capped at 20 per workspace per day, because each one is two searches
  plus a model call. A person pressing the button is not capped by that.
- Verdicts are not deterministic: identical requests run minutes apart can differ, because the search
  result set moves. The answer is timestamped and a re-check is explicit.
- Company research refuses a name collision ("the results describe several companies called X") rather
  than resolving it; disambiguating by domain is the obvious next step.
- We did not use Nebius AI Cloud, Serverless Endpoints or Serverless Jobs. Inference is a REST call to
  Token Factory, so there is no local GPU work to offload; the work that would justify Serverless Jobs
  is bulk re-embedding a corpus after a model change, which this project does not yet do.
- No hosted production deployment yet: the local stack and container images are what exist.

## Feedback on Nebius Token Factory, AI Cloud and NVIDIA models

**Model quality 9/10 · recommend Nebius 9/10 · experience vs other clouds 8/10.** We ran Nano for
high-volume filtering, Super for extraction and grounded Q&A, Ultra for briefs, out of the box with
versioned prompts and validation in code (no fine-tuning).

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
- **Tagline**: Every request carries the customer's exact words — and a note on who else already ships it.
- **Built with**: Go, PostgreSQL, pgvector, Next.js, TypeScript, Nebius Token Factory, NVIDIA
  Nemotron, Tavily, AssemblyAI, Docker
- **Links**: repository (AGPL-3.0), 3-minute video, interactive preview
- **Testing instructions**: sign in with the demo account on the submission. The sample workspace has
  8 requests, three suggestions in the review queue from a transcribed call, four requests whose
  "Who else ships it" card is already filled, and a finished decision brief. Nothing is staged: press
  "Check again" on any request and it re-runs a live search.
