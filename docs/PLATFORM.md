# The platform, in words

Written 2026-10-24 from the code as it stands. It describes what exists, what it does, what has and has not been proven, and what is switched off. It is not a roadmap (see `docs/INTEGRATIONS-PLAN.md`, `docs/MCP-PLAN.md` and `synthesis/`) and it does not invent a product name: the product has none yet, so it is called "the platform" here.

---

## 1. What it is, and for whom

A closed-source, bootstrapped web service that turns what customers say into decisions, and then tells the customers who asked what happened.

Customers talk to a company in many places: support chats and emails, sales and interview calls, survey answers, forms, messages in team chat, meetings that are recorded. Nobody reads all of it, so product decisions rest on memory and on whoever spoke loudest. The platform reads it all, puts the exact words behind every claim, weights requests by who is asking and what they are worth, and closes the loop with personal, owner-approved messages when something ships.

The people it is built for are the product manager or founder of a small business-software company (roughly 5 to 100 people) who has no research team and no revenue-operations team; their sales and success teammates who bring evidence and want to know what happened to what they raised; and executives who read.

The one idea underneath everything: **a person said this, in this source, at this moment, about this request.** Every request, number, label, answer, brief and message points back at the stored quote that justifies it, and the platform refuses to say anything it cannot cite.

### The chain it completes
1. Conversations come in (pasted, uploaded, recorded, emailed, chatted, surveyed, posted by other tools).
2. The AI reads each one and proposes requests with the exact supporting sentence. A person accepts, edits, merges or dismisses.
3. Accepted evidence builds requests, each showing who asked, which account they belong to, and what that account is worth.
4. People decide: statuses, a public roadmap, decision briefs, questions answered from the stored quotes.
5. When a request ships, the platform drafts a personal message to each person who asked, in their own words. The owner reviews and approves; only then does anything go out. A release note and a public page can say it too.

---

## 2. Current state, honestly

- **Built:** every phase of the build plan (0 to 9) and everything after it: matching, desk features, chat files, survey branching, outbound webhooks, inbound endpoints, transcript import, several issue trackers, CRM account value, MCP tools, single sign-on. About 233 API operations, 52 database migrations, around 40 backend packages, and 40-odd web pages.
- **Proven by tests, locally:** everything above, with a fake AI provider, a local mail stand-in, and local stand-ins for each outside service. The last full run: all Go tests pass, `make check` and `make security` are clean, and the browser suite (desktop and phone widths, with accessibility scans) passes: 112 tests, 4 skipped.
- **Not proven against the real world:** nothing has run against real OpenAI or AssemblyAI keys, real Resend delivery, real Slack, GitHub, Stripe, Linear, Jira, ClickUp, Asana, Azure DevOps, HubSpot or Salesforce accounts, or real Supabase sign-in. Quality of the AI (extraction, briefs, feelings, matching suggestions) has been measured only on small synthetic sets.
- **Hosted database:** at migration 34 of 52. Migrations 35 to 51 are written and tested but not applied there (a deliberate hold; applying them is the owner's call).
- **Switched off by default:** every outside service except Slack and GitHub, and company sign-in. They are built; they wait for the owner to approve the vendor and try it for real.
- **Not signed off:** the Phase 5 gate (it still needs a staging environment, the cold test with a stranger, a screen-reader pass and a connected alert channel). The full list of what needs a person, an account or a decision is `docs/OWNER-TODO.md`.

---

## 3. People, workspaces and roles

- A **workspace** is one company's space. Everything inside it belongs to it alone; nothing crosses to another workspace. People can belong to several.
- **Roles:** *admin* (everything, including billing, connections, keys, publishing settings), *member* (can add, review, reply, edit), *viewer* (can read and search, cannot change anything). The server enforces these on every route; a generated test calls every route as a stranger, an anonymous visitor and a viewer to prove it.
- **Sign-in:** email and password through Supabase, with sessions kept in a protected cookie and renewed automatically. Optional company sign-in (see section 14). A development-only sign-in exists for local work and is refused in production.
- **Names:** each teammate picks the name teammates see (only the sign-in service knows emails).

---

## 4. The pages a signed-in person sees

The workspace has one navigation bar. Each entry is a page:

| Page | What it is for |
|---|---|
| **Inbox** | The shared support desk: website chat and email conversations. Open a conversation to read the thread, reply, add private notes, hand it to a teammate, send a message to the review queue. The *Desk setup* page holds your display name, saved replies and the reply-time target. |
| **Add feedback** | Paste a conversation (with an optional person, account and source link), or upload a CSV or a recording. Shows what is being read and what came out. |
| **Review** | The queue of AI suggestions. Each shows the source text with the supporting sentence highlighted, a confidence, and whether it looks like a new request or evidence for an existing one (with a one-click "this may be the same as" suggestion). Accept, edit, merge, dismiss, undo, or bulk-accept above a chosen confidence. |
| **Requests** | The table of requests, with status, impact (quotes, people, accounts, value), filters, sorting by value or newest, and saved views you can share. A request page shows every piece of evidence with its quote, who said it, their account, the source and where in it; tags; the status control; the decision brief; the linked issue in a tracker; and who has been told. |
| **Recordings** | Upload call and interview recordings (large files supported, resumable), see the transcript with a player, speakers and timing, and AI-suggested highlights. |
| **Research** | Highlights and the tag codebook: create tags, merge them (with an exact undo), archive them, accept or dismiss suggested highlights. |
| **Quotes** | Every stored quote in a table or board, filterable by tag and feeling, searchable by meaning, with tag trends over time and a screen to label feelings by hand. |
| **Findings** | Documents that hold quote cards (always showing the stored quote) and can be shared by a revocable link. |
| **Ask** | Ask a question about what customers said. The answer cites stored quotes or says there is no evidence. |
| **Roadmap** | The internal view of what is planned, with the option to publish a public roadmap. |
| **Outreach** | The loop-closing messages: batches of personal drafts after a request ships, review, edit, approve, send log, "told about this" marks. |
| **Release notes** | Write, schedule and publish release notes linked to the requests they ship. |
| **Surveys** | Build, target, send and read surveys (see section 9). |
| **People** | People and accounts, with a strict CSV import (preview, mapping, line-by-line errors). |
| **Quality** | How right the platform's own suggestions are, plus spot-check reviews. |
| **Settings** | Everything configurable (see section 13). |

Other pages: a source page for any stored item (the original text with every quote located inside it), account setup after sign-up (create a workspace), sign-in, sign-up, and the assistant-approval page.

---

## 5. Getting feedback in

Every way in lands in the same place: a stored, untouchable source, split into chunks, redacted, and queued for reading.

- **Paste** a conversation, optionally naming the person and account and linking the original.
- **Upload** a recording (resumable, chunked, with a size cap per file and an upload allowance), transcribed with speaker labels. Transcription works through an OpenAI-style audio service or AssemblyAI. The transcript becomes a source with timed segments tied to words in the text.
- **Import** a CSV of people and accounts, with automatic column detection and a preview that names every bad row.
- **Website feedback form:** an embeddable form for the company's site (restricted to allowed web addresses, rate limited, with a hidden-field trap for bots).
- **Website chat:** a script and chat window for the company's site, with files in both directions.
- **Email:** forward or route customer email in as signed JSON from any mail provider.
- **Team chat:** Slack messages in one chosen channel arrive as feedback.
- **Other tools:** a public endpoint accepts notes from help desks, form tools and automation services (with a source label, link back, the other tool's id so a retry is stored once, and an email to attach it to a known person).
- **Call transcripts** from other tools (WebVTT, SRT, JSON speaker turns, plain text) through a second endpoint.
- **Surveys:** answers to free-text questions go to the review queue.

Before anything is stored, card numbers, keys and passwords are hidden. Whatever came in is kept exactly as it was (apart from that hiding); the AI never edits a source.

**Limits that protect cost:** a single text up to 200,000 bytes; 5 MB of new text per workspace per rolling day (a plan's AI allowance also applies); notes through the API are capped per key per day.

---

## 6. How the AI reads, and how it is kept honest

- **Extraction:** a model reads each source in chunks and proposes requests with the exact supporting quote and a confidence. A stored quote must appear word for word in its source at the stored position; a database trigger and two code checks enforce this, so a made-up quote cannot be stored.
- **Review queue:** machine output never becomes a request on its own. A person accepts, edits, merges or dismisses; everything is undoable.
- **Matching by meaning:** new suggestions are compared by meaning (embeddings) with existing requests. A small model must say clearly it is the same need, with high confidence, before a "this may be the same as" box appears. A person presses the button; nothing merges alone, because a wrong merge is worse than a miss.
- **Search by meaning:** the Quotes screen and an assistant tool find quotes that say the same thing in different words.
- **Decision briefs:** for a request, a larger model writes a brief that cites quotes; uncited claims are refused.
- **Ask:** questions are answered only from stored quotes, with citations, or refused ("no evidence"); false premises are refused too (measured once: 20 of 20 unanswerable and 20 of 20 false-premise questions refused, on a small synthetic set).
- **Feelings:** a model, or a person, labels the feeling of a quote; agreement between the two is measured. They are *not yet* measured against 200 human labels.
- **Highlight suggestions** for recordings use the tag codebook, with the same verbatim guarantee.
- **Prompt-injection care:** customer text is treated as untrusted. Quotes that look like instructions aimed at an AI are flagged and withheld from assistants; model output never triggers a send, a tool or a change.
- **Providers and cost:** all model calls go through one interface with three tiers (small for routing, mid for extraction and drafts, large for briefs and hard questions), configured per task, with failover. Every call records provider, model, prompt version, tokens, cost and whether customer data was in it, and customer data goes only to routes marked as allowed to receive it. Each workspace has a daily AI allowance; heavy jobs are queued and throttled per workspace.
- **Measuring itself:** an evaluation harness (`make eval`) scores extraction, questions, suggestions and feelings against thresholds; weekly spot checks sample answers and briefs for an admin to grade; the Quality page shows how often accepted suggestions were edited or dismissed.

---

## 7. Requests, evidence, people, accounts and value

- A **request** has a title, a status, tags, an area, an owner, and a set of **evidence rows**. Each evidence row is a stored quote, located in its source, tied to a person (and through them an account), with the confidence it was proposed at.
- **Impact** is calculated by the database as evidence is added: how many quotes, people and accounts, and the total value *summed over distinct accounts* (two people from one account count that account's value once).
- **People and accounts** come from CSV import, manual entry, the website chat/form, and (optionally) a CRM. An account has a name, domain, revenue, plan and renewal date.
- **Statuses** are customisable; each belongs to a bucket (open, active, done = shipped, closed). Moving into a "done" status starts the loop-closing batch. Moving out withdraws an unapproved batch.
- **Account value from a CRM:** HubSpot or Salesforce (both off by default) can fill in account value for people the platform already knows by email, from annual revenue or from closed-won deals, read-only, daily or on request (section 12).

---

## 8. Closing the loop

- When a request moves to a shipped status, the platform starts **one batch of drafts**, one for each person who asked, written from *their own* quotes.
- The owner reviews every message, edits it, and approves. **Nothing is sent to a customer without an approved state, and that rule is enforced inside the send function itself**, not only in the screens.
- Sending goes through one email interface (Resend), with an authenticated sender, a signed unsubscribe link in every message, an opt-out list that is honoured, and bounce and complaint handling through a signed webhook.
- Every send is logged; people who were told are marked on the request.
- **Release notes:** written by a person, linked to requests, published now or scheduled for an exact moment (time zones cannot move it), with a public page and a link to each note; unpublish any time.
- **Public roadmap and voting:** a public roadmap page where signed-in visitors vote; votes can be marked *verified* when the voter is a known customer, by a link signed by the company's own app or by a confirmed email.

---

## 9. Research, surveys and findings

- **Recordings and transcripts:** timed transcripts with a player; every highlight and quote maps to a moment.
- **Codebook:** tags with definitions and colours; merge two tags with an exact undo; archive and restore.
- **Highlights:** a person highlights text in a transcript or a conversation (verbatim guarantee), tags it; AI can suggest highlights from the codebook.
- **Quotes screen:** table and board of all quotes, tags over time, feeling labels, and meaning search. Stays under two seconds with 100,000 quotes.
- **Findings documents:** a write-up built from quote cards that always show the stored words. A document can be shared by a link that can be revoked; publishing requires the author to confirm they read the quotes.
- **Surveys:** NPS, CSAT, choice and free-text questions; an audience built from rules over people and accounts (tested against a brute-force reference); delivery by approved email invitations with reminders, by a public link, or embedded in a page; one final answer per person; follow-up questions that appear depending on up to four earlier ratings or choices combined with "all" or "any"; conditions locked once a survey is open. Free text goes to the review queue. A person's survey answers are removed or anonymised when the person is deleted. Results page with counts and answers.

---

## 10. The support desk

- **Channels:** website chat (a script and a window, restricted to allowed sites, rate limited) and email (signed JSON in, replies out by the worker).
- **Conversations:** list with filters, thread view, private notes, assign to a named teammate (a stale view is refused instead of overwriting), saved replies (up to 100), a reply box with a picker.
- **Two people cannot double-reply:** a conversation changed while you were reading is refused with a plain message.
- **Reply times:** median and slow-end first-reply time over 30 days, how many are waiting, the oldest waiting, and how many are past an optional target in hours.
- **Files in chat, both ways:** pictures, PDFs and plain text, 5 MB each, 3 per message, 200 MB per workspace; the type is checked by what the bytes are; files are always delivered as downloads; they are not virus scanned (an owner decision is listed).
- **Handoff to feedback:** send a customer's message to the review queue and see a live status card of what came of it.
- **Privacy:** visitors are identified by a hash of a browser key; a conversation, its files and its person are deleted together.

---

## 11. Public surfaces (no sign-in needed)

- Release-note page and each note (`/r/<slug>`), and the public roadmap with voting (`/r/<slug>/roadmap`).
- The feedback form (`/f/<token>`), the chat window (`/chat/<token>`), and surveys (`/s/<token>`, embeddable at `/embed/s/<token>`).
- Unsubscribe pages for messages and for the digest.
- Findings share links.
- Every public route is on an allowlist test, rate limited, and checked in the generated security sweep.

---

## 12. Integrations and what other tools can do

All of these are controlled by one setting (`INTEGRATIONS_ENABLED`, default only Slack and GitHub). A service that is off is hidden, answers "not found", and runs nothing; what was stored stays.

| Service | What it does | State |
|---|---|---|
| **Slack** | Messages in one chosen channel become feedback. | On by default; tested against a stand-in |
| **GitHub issues** | Open an issue for a request (title and counts only, never quotes, names or emails); the request follows the issue closing or reopening; conflicts are held back and shown, never overwritten. | On by default; stand-in |
| **Linear, Jira Cloud, ClickUp, Asana, Azure DevOps** | The same as GitHub, one tracker per workspace; ClickUp, Asana and Azure DevOps share a driver framework with a form drawn from what each asks for. | Built, off by default, stand-ins |
| **HubSpot, Salesforce** | Read-only account value for known people (annual revenue or won deals); never creates or removes a person, never writes to the CRM. | Built, off by default, stand-ins |
| **Stripe** | Plans and payments (checkout, portal, failed payments, refunds). | Built; stand-in |
| **Outbound webhooks** | Signed messages to addresses an admin adds: request created, status changed, suggestions ready, release note published, survey finished; retries with backoff, auto-pause after repeated failure, a delivery history. An address can also be a Slack, Discord or Teams channel and receive plain sentences with a link (titles are made safe: no mentions, no smuggled links). | Built and on |
| **Inbound endpoints** | Notes and call transcripts from help desks, form tools, automation services and call tools, with setup notes in `docs/recipes/`. | Built and on |
| **Email provider (Resend)** | Outgoing mail and bounce reports. | Built; stand-in |
| **OpenAI / AssemblyAI** | Embeddings; transcription. | Built; not run with real keys |

**For developers and assistants**
- **Public API keys:** per-workspace keys with five permissions (see requests, see quotes, ask questions, add notes, change statuses and add tags), optional expiry and address limits, rate limits, an activity log, and one-time display of the secret. Keys never expose names or email addresses.
- **MCP server (ten tools):** search and filter requests, get one request with its quotes, ask a cited question, list statuses, list tags, list release notes, search quotes by meaning, add a note to the review queue, change a request's status (never into or out of shipped), add a tag. Runs locally or hosted at `/mcp`. Remote assistants (Claude, ChatGPT, Cursor and others) connect through an OAuth approval page where an admin chooses what to allow; access can be disconnected at any time.
- **Webhooks and the API contract:** `api/openapi.yaml` is the contract; the web client and Go server stubs are generated from it.

---

## 13. Settings, billing and plans

- **Settings page (admin):** messages and release page (sender name, public address), feedback form (allowed sites, key), billing, inbox (chat and email), connections, messages to other tools (webhooks), API keys and connected assistants, verified voting, weekly digest, data export.
- **Plans:** Free, Team and Business, defined by a file (names, prices, what is included: AI allowance, recordings, API keys, public pages, digest, surveys, integrations). Stripe holds real prices. Limits are enforced on the server and the screens explain what is missing.
- **Weekly digest:** an optional emailed summary for the team, off by default, with per-person unsubscribe.
- **Data portability:** a full export of a workspace (companies, people, conversations, requests, quotes) and an import, so the data can be kept or moved.

---

## 14. Security, privacy and reliability

**Security**
- Every table carries the workspace and has row-level security forced; every request runs in a transaction that sets the workspace; the backend uses a non-bypass database role and never any "service role". A new table without a policy fails tests.
- Sign-in tokens are verified on every request (signature, expiry, audience, issuer); roles come from our own tables, never from the client.
- No secrets in code, logs, URLs or browser bundles; credentials kept for other services are sealed with a server key; secrets are shown once.
- Output safety: no raw HTML from users or models; strict content security policy; files always served as downloads.
- Rate limiting held in the database so it works across instances; origin checks on every embeddable surface.
- The dependency and code scanners (`govulncheck`, `gosec`, `npm audit`) run clean as part of `make security`.

**Privacy**
- Collect the minimum. Customer data is never used to train models; it goes only to routes marked as allowed to receive it.
- Deleting a person removes their quotes, conversations, transcripts, recordings, survey answers and files; deleting a recording or a conversation removes its content.
- Working data expires: questions and answers after 180 days, per-call AI cost records after 400, admin notices after 30, dismissed suggestions after 90.
- Logs hold identifiers, not content, emails or tokens; secrets and card-like numbers are removed before storage and before any model call.

**Reliability and availability**
- Slow work runs as retried, idempotent jobs in Postgres (River); side effects carry idempotency keys.
- Health endpoints, graceful shutdown, readiness-based deploys, a restore drill (local and against the hosted database) and a deploy drill with container images.
- If the AI is down, sources are still saved and queued; if email is down, approved messages wait.
- Alerts with request ids that follow work into background jobs (channel not yet connected); metrics at `/metrics`.

**Accessibility and usability**
- WCAG 2.2 AA is the target: semantic markup, keyboard operation, labelled controls, announced errors, contrast in light and dark, phone-width layouts. Browser tests run an accessibility scan on the main flows at desktop and phone width. A screen-reader pass by a person is still to do.
- Every screen has loading, empty, error and success states in plain language.

---

## 15. How it is built

- **Backend** (`api/`): Go; chi router; pgx and sqlc over PostgreSQL 18 (with pgvector for meaning search); goose migrations (forward-only); River for jobs; an OpenAPI-driven strict server. One binary runs as the API or as the worker (`APP_MODE`); the worker serves separate queues so heavy audio work never delays email.
- **Web** (`web/`): Next.js 16 and TypeScript; a client only, it never touches the database and calls the API; server components by default; uploads go through route handlers; Playwright (desktop and phone) and vitest for tests.
- **Packages** (each one job): intake, extraction, review, directory, workflow, outreach, release, research, insights, findings, survey, audience, inbox, match, embed, media, transcribe, storage, billing, apikey, oauth, mcpserver, hooks, integrations, publicsite, digest, audit, quality, ops, retention, ratelimit, redact, promptguard, secretbox, email, ai.
- **Principles** (non-negotiable, in `docs/engineering-principles.md`): security and privacy first, then reliability, then the rest; acceptance tests first; contract first; latest stable dependencies; AI and email only through their interfaces; clean room (no competitor code, text or names outside the research notes); ask the owner before anything outward-facing or hard to reverse.
- **Continuous integration** is manual only (a workflow run by hand), by choice.

---

## 16. What is deliberately not there (or not decided)

- A product name (undecided; the copy avoids inventing one).
- Real-service proof for every outside vendor, the real AI quality numbers, and real email delivery, and the hosted migrations 35 to 51.
- A virus scanner for chat files; files in email conversations; domain-based automatic joining after single sign-on; a sign-in flow (authorisation code) for Salesforce; generic OIDC beyond what Supabase offers; Jira Server or Data Center; the assistants' ability to accept suggestions, merge, delete, send or publish (kept with people on purpose).
- Several owner decisions are listed in `docs/OWNER-TODO.md` (sections A to T): vendors to approve, accounts to create, quality checks to run, and the choice of which switched-off services to turn on.
