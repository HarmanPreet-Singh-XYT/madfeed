# MCP server: gap and plan

Status: plan only, nothing here is built. Companion to `docs/INTEGRATIONS-PLAN.md`.

## What we have
`internal/mcpserver` (local `cmd/mcp` or hosted at `/mcp`) with four tools: `search_requests`, `get_request`, `ask_feedback` (cited answers or a refusal), `submit_feedback`. Remote assistants sign in through OAuth (`internal/oauth`) with an admin's approval, dynamic client registration, PKCE, and a one-hour access key that carries scopes, revocation, rate limits and an activity log. Quotes that look like prompt injection are withheld.

## The gap
A rival's server offers 60+ tools across ideas, comments, companies, users, segments, views, changelog, groups and insights, plus one-click listings in assistant marketplaces and per-role permissions. Ours is read-mostly and tiny. Most customers will only use a handful of tools, so the goal is the useful dozen, not the count.

## Order

### 1. Read tools (PARTLY BUILT 2026-10-24: `list_statuses`, `list_tags`, `list_release_notes`, `search_quotes`, and `statusId`/`tagId` filters on `search_requests`; the rest below is deliberately not built)
Add, each scoped like the existing read scope:
- `list_requests` with filters (status, area, tag, account, sort by value), paginated.
- `list_evidence` / `get_quote` for a request, always with the stored quote and its source.
- `list_people`, `get_person`, `list_accounts`, `get_account` (value and linked requests).
- `list_tags`, `list_areas`, `list_statuses`.
- `list_release_notes`, `get_survey_results` (counts only; free text stays quotes).
- `search_quotes` by meaning (uses the embeddings search already built).
- `list_proposals` (the review queue, read only).
Each tool: pagination and a size cap, quotes screened for injection, cross-workspace tests via the existing sweeps.

### 2. Safe write tools (PARTLY BUILT 2026-10-24: `set_request_status` and `tag_request` behind a new `write` permission; `create_request`, `add_evidence`, accepting suggestions and `link_issue` are deliberately NOT built)
- `create_request`, `add_evidence` (needs a chunk and a verbatim quote, same rule as everywhere), `add_to_request` (accept a suggested match).
- `set_status` (does not send anything; messages still wait for owner approval).
- `tag_request`, `link_issue` (GitHub today).
- Writes need a separate write scope the admin ticks at approval time. Every write is logged with the client name, and has an undo where the app already has one.

### 3. Approval-gated tools
Anything that could reach a customer or destroy data stays out of the server for now: sending messages, publishing release notes, merging requests, deleting. The assistant can prepare a draft; a person approves in the app. Revisit only if customers ask, and then as a "propose" tool that creates a pending item, never a direct action.

### 4. Connection experience
- Setup page in the app showing the server URL, scopes, and per-client steps (Claude, ChatGPT, Cursor, Copilot, Codex, Devin, generic OAuth).
- Clients that cannot register themselves (some need a fixed client id) get a pre-registered public client created by an admin, using PKCE and no secret where the client allows it.
- Show connected assistants with last-used time and one-click revoke (the grant model already supports this; check the screen exists).
- Marketplace listings (one-click connectors) only after the product name and domain exist, and after the owner approves each submission.

### 5. Roles
Map tools to the roles we already have (viewer reads, writer reads and writes, admin manages). A viewer's grant can never carry write scopes; the generated role sweeps must cover the new tools.

### 6. Quality
- A small eval: given a question set, does an assistant pick the right tool and cite? Run it with one real client before adding more tools.
- Keep tool descriptions short and distinct. Many overlapping tools make assistants pick worse; stop at roughly 25.

## Rules that stay
- Content from customers is untrusted: never lets a tool call trigger a send, a delete, or a scope change.
- Customer data only through routes allowed to carry it; no secrets, emails or tokens in logs or error text.
- No competitor text or credentials in code or docs. (The rival's help page shows fixed client ids and secrets for each assistant; we do not copy that approach for secrets, and our public clients use PKCE.)
- Owner approval before any marketplace submission or new vendor.

## Open questions for the owner
- Do you want write tools at all in the first release, or read-only first?
- Which assistants matter most (Claude, ChatGPT, Cursor)? Real-client testing is needed for each and needs your accounts.

## Built so far (2026-10-24)
Eight tools: `search_requests` (now filterable by status and tag), `get_request`, `ask_feedback`, `list_statuses`, `list_tags`, `list_release_notes`, `search_quotes` (by meaning, needs the quotes permission and the embeddings provider; quotes that look like instructions are withheld as everywhere else) and `submit_feedback`. All but the last are read-only and use the same keys and permissions as before (`requests`, `quotes`, `ask`, `submit`); the new server routes are `/v1/ext/statuses`, `/tags`, `/release-notes` and `/quotes/search`.

Left out on purpose: people, accounts and individual evidence listings (the keys never expose names or emails, and a list of people would), the review queue, and survey results. Revisit if an assistant use case needs them, with a permission of their own.

## Write tools built (2026-10-24)
A fifth permission, `write` ("Change statuses and add tags"), is off by default and has to be ticked for a key or approved for an assistant. With it:
- `set_request_status` changes a request's status. It refuses to move a request **into or out of** a shipped status, because that starts or withdraws messages to customers; a person does that in the app. Nothing else in the status change differs from a person doing it.
- `tag_request` adds one existing tag; the request's other tags stay (at most 10).
Both act as a member-level actor named by the key, are listed in the key's activity as "update", and answer 404 for anything in another workspace.

Left out on purpose: accepting or dismissing suggestions (the review queue is where a person decides; an assistant can add notes with `submit_feedback`), creating requests without cited evidence, and anything that deletes, merges, sends or publishes.
