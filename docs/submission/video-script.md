# Video script — 3 minutes, hard stop at 2:50

Rules that matter: judges may stop at three minutes, and they said the aha should land in the first
30 seconds. Say the model names out loud and put them on screen — judges often skim with sound off.
Do not tour the product; one flow, start to finish.

Record at 1080p, cursor visible, no dead air, no music. Keep every screen on one sentence you can
say out loud.

| Time | On screen | Say (roughly) |
|---|---|---|
| 0:00–0:12 | Editor with a messy 6-message support thread. Paste it. | "This is a real support conversation. A bug, a request, a compliment, and small talk." |
| 0:12–0:30 | Review queue fills: 3 cards appear. | "Three proposals. Every one carries the customer's exact words. Greetings and 'hope you had a good weekend' are gone — not summarised, discarded." |
| 0:30–0:42 | Click one card: quote highlighted inside the conversation. | "The model proposes, the code disposes. If the quote doesn't appear word for word at the stored byte offsets, it never becomes evidence. Checked in Go, and again by a Postgres trigger." |
| 0:42–0:55 | Accept → request "CSV export failure" with cited evidence. | "Accept it, and the request carries the receipt. One conversation in, one request out — with proof." |
| 0:55–1:10 | One slide: the problem. | "Feedback tools summarise, and a summary is unarguable. Six weeks later nobody can say who asked, or whether it was one loud customer or forty quiet ones." |
| 1:10–1:30 | Quality screen, "Which model did what" table, with real rows. | "Every call is on the record: model, calls, failures, cost. This is read from the database, not a slide." |
| 1:30–1:50 | Terminal: the Token Factory request, provider `nebius`, model id, usage. | "Everything runs on Nebius Token Factory, OpenAI-compatible, three NVIDIA Nemotron models." |
| 1:50–2:15 | Back to Quality, the tier story. | "Nano does the high-volume filtering and dedupe. Super does the extraction — this call cost 0.0007 dollars. Ultra is only spent on briefs. Cheap model eats the noise, expensive model sees what survived." |
| 2:15–2:35 | Grounded Q&A: ask a question the data cannot answer. | "Ask it something it can't answer and it refuses instead of inventing. Twenty out of twenty unanswerable questions refused, in the eval." |
| 2:35–2:55 | Request page → **Check public sources** → verdict, sentence, one link. | "Before we build it, Tavily checks whether it's already documented or already reported. It can only cite links the search actually returned — and it's kept separate from what customers said." |
| 2:55–3:00 | Repo page: README, license, checks. | "AGPL-3.0, contract-first, tenant isolation by row-level security. Commit history is the record." |

## Before you hit record

- `make api`, `make worker`, `make web` running; the `E2E ingest check` workspace already seeded
  with one cited request and real `ai_event` rows.
- Quality page open in a second tab, scrolled to "Which model did what".
- A request with a real product title (e.g. "Stripe webhook signature verification fails") opened
  with the Public sources card in view, and `TAVILY_API_KEY` set on the API — the check needs a live
  search, so confirm it answers before recording.
- Terminal at the `aismoke` output or a `curl` to `/v1/models` ready.
- Sign-in pre-done, no password typing on camera.
- Close every other tab, silence notifications, hide the bookmarks bar.

## If the live run fails

Fall back to the preview build (`make preview`, http://localhost:3100/mock) and say so on screen:
"this is the interactive preview on sample data; the real run is at 0:12." Honest beats a stall.

## Upload

YouTube, public or unlisted-but-link-visible, under 3 minutes, title with the project name, link
pasted into the Devpost form.
