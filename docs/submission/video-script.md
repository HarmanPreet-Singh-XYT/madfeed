# Video script — 3 minutes, hard stop at 2:50

Rules from the judges: aha in the first 30 seconds, one thing done well beats a big stack, show which
model does what, do not read slides. Say the model names out loud and put them on screen.

## Before you record (10 minutes)

- `docker compose -f deploy/docker-compose.local.yml up -d` and open http://localhost:3000
- Sign in with the name **demo** — it lands in the sample workspace (8 requests, one recording,
  4 public-source verdicts, models-used rows already present)
- Have the conversation to paste ready on the clipboard (6 messages: a bug, a request, a compliment,
  two greetings)
- Tabs in this order: **app**, **terminal**, **repo page**. Nothing else.
- Hide the bookmarks bar (⌘⇧B) and the Dock; turn on Do Not Disturb; close Slack
- Browser zoom 100%, window about 1440×900 so text is legible at 1080p

Record with ⌘⇧5 → *Record Selected Portion* (or QuickTime → New Screen Recording), microphone on,
1080p. One take is fine: a small stumble costs less than a polished lie.

## The run (2:50)

| Time | On screen | Do | Say (roughly) |
|---|---|---|---|
| 0:00–0:20 | Requests → add → paste | Paste, submit; the queue fills in ~10 s | "This is a real support conversation: a bug, a request, a compliment, and small talk. Watch what survives." |
| 0:20–0:40 | Review queue | Point at three cards | "Three proposals. Every one carries the customer's exact words. The greetings and 'hope you had a good weekend' aren't summarised — they're discarded. A quote that isn't verbatim can never be stored; a database trigger refuses it." |
| 0:40–1:00 | Accept one → request page | Accept, show the quote highlighted in the conversation | "Accept it, and the request carries the receipt: who said it, when, in which conversation." |
| 1:00–1:25 | Same request → **Who else ships it** | Scroll to the card, point at the verdict and the named competitor | "Before anyone builds it, it asks: who else already ships this? Tavily searches twice — the request, and how competitors did it — reads the top page in full, and Nemotron names the product." |
| 1:25–1:45 | Same card → sources / **How others do it** | Point at a link, then a pattern | "It may only cite links the search actually returned. If the model invents a URL, the answer is refused — the same rule as the quotes." |
| 1:45–2:10 | **Quality** | *Which model did what* → verdict roll-up → *Already built elsewhere* | "Every call is on the record: Nano for high-volume filtering, Super for extraction, Ultra only for briefs. And this is the payoff — these are already shipped by someone else, with links, before we spend a sprint on them." |
| 2:10–2:30 | **People → Companies** → open one | Open the drawer; press *Research this company*, or show one already run | "Same client, different question: what the web says about this company, by name and domain only — never anything a customer said. And it won't describe a company that merely shares the name." |
| 2:30–2:42 | **Ask** | Ask something the data cannot answer | "Ask it something it can't answer and it refuses instead of inventing. Twenty out of twenty, in the eval." |
| 2:42–2:55 | Terminal (`aismoke`, pre-run) or the repo page | Show the three tiers answering, then README/licence | "Everything runs on Nebius Token Factory — three Nemotron models, each call priced and logged. AGPL-3.0, contract-first API, tenant isolation in the database." |

## Do not show

Dashboard tour, surveys, billing, SSO, settings, MCP setup, the integrations list. Each costs a second
of aha and buys nothing.

## If something fails

- Public check says `not_configured` → the key isn't on that API; don't film the screen
- Public check is slow (>10 s) → keep talking over it, or cut the beat
- Extraction doesn't finish → keep the take, use the queue you already have, say "still processing"
- Nothing works → `make preview` (http://localhost:3100/mock) and say on camera it's sample data

## Upload

YouTube, public (or unlisted with the link in the form), under 3 minutes, title
`madfeed — cited customer feedback`, no music, no third-party logos.
