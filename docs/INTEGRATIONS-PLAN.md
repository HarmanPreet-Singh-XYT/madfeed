# Integrations plan

Status: plan only, nothing here is built. Order is the order I would build in. Each step ships on its own, with tests and a gate note, and nothing is sent to a customer without an approved state.

## Principle
Do not match a rival's count. Build a few generic connections that cover many tools, then add native connectors only for the tools customers ask for. Every native connector is a new outside service and a new subprocessor, so the owner approves each one first (see AGENTS.md "Ask the owner before").

## Already built
Slack, GitHub Issues, Stripe billing (all tested only against local stand-ins in `internal/devfakes`), public API with scoped keys, MCP (local and hosted, OAuth), website feedback form, website chat, surveys, email in (provider-neutral signed JSON), recording and transcript upload.

## Order

### 1. Outbound webhooks (BUILT, see `docs/webhooks.md`)
- **What:** a workspace admin adds a URL and picks events (new request, status change, shipped, release note published, survey answer, new proposal). Each delivery is a signed JSON POST.
- **Covers:** Zapier, Make, Pabbly, Integrately, OttoKit, Teams, Discord, anything with a webhook URL.
- **How:** River job per delivery, HMAC signature header with timestamp, retries with backoff, delivery log with status and last error, auto-pause after repeated failure, secret shown once. URL must be https and must not resolve to a private address (SSRF guard, checked at send time too).
- **Privacy:** payloads carry ids and short titles, not quotes or emails by default. Customer text goes only if the admin turns it on per endpoint.
- **New vendor:** none.
- **Tests:** signature check, retry and pause, SSRF refusal, viewer cannot manage, other-workspace sweep, delivery log never stores secrets.
- **Size:** small.

### 2. Inbound feedback endpoint and mapping recipes (BUILT, see `docs/recipes/`)
- **What:** one endpoint per workspace (scoped key) that takes text plus optional person, account, source and link, and puts it in the review queue like any other source. Email forward-in uses the existing signed email route.
- **Covers:** Intercom, Zendesk, Help Scout, Freshdesk, Gist, Typeform, Google Forms, SurveyMonkey, review sites (via the customer's own automation).
- **How:** reuse ingest. Add a `source` label per sender, an idempotency key so retries do not duplicate, size limit, redaction as today. Write one short recipe per tool in `docs/recipes/` (field mapping and screenshots-free steps).
- **New vendor:** none.
- **Tests:** duplicate key ignored, oversize refused, key scope enforced, redaction applied, lands in the queue with the right source.
- **Size:** small to medium.

### 3. Call transcript import (BUILT, see `docs/recipes/calls.md`; API only, no screen)
- **What:** accept a transcript (text, VTT or SRT, or JSON with speaker turns) through the API or by webhook, so no audio and no transcription cost.
- **Covers:** Gong, Fathom, Fireflies, Grain, tl;dv, Zoom, Google Meet exports.
- **How:** parse into the existing timed-transcript shape, speakers kept, then the normal extraction path. Per-tool recipe notes for where each exports from.
- **New vendor:** none.
- **Tests:** each format parses, speaker labels kept, verbatim-quote guarantee still holds against the stored text, big file limits.
- **Size:** medium.

### 4. Linear and Jira (BUILT, see `docs/gates/linear.md`; ClickUp, Asana and Azure DevOps not built)
- **What:** send a request to the tracker, link to an existing issue, sync status back to the request.
- **How:** follow the GitHub Issues connector (same table shape for links, same status mapping screen). Linear first (simple API, webhooks). Jira Cloud second (OAuth 2.0 3LO, more setup).
- **New vendor:** yes, one per tracker. Owner approval and a subprocessor entry each.
- **Tests:** local stand-in per tracker as for GitHub, status round trip, token never logged, disconnect removes the stored token.
- **Later, same pattern:** ClickUp, Asana, Azure DevOps.
- **Size:** medium each.

### 5. HubSpot, then Salesforce (account value)
- **What:** pull accounts, contacts and deal value so impact comes from real deals instead of the CSV import.
- **How:** read-only sync on a schedule, matched to people by confirmed email and to accounts by domain or external id. Never writes back in the first version.
- **New vendor:** yes. Needs OAuth apps and a review by each provider.
- **Tests:** value summed over distinct accounts still holds, duplicate contacts merged only by exact match, disconnect keeps imported rows but stops syncing.
- **Size:** large each. Do only when a customer asks.

### 6. Team sign-in with OIDC
- **What:** one generic OpenID Connect option, which covers Okta, Entra ID, OneLogin and Google Workspace.
- **How:** depends on how sign-in is hosted (Supabase today), so check what it supports before building. Enterprise feature; leave until someone needs it.
- **Size:** medium, mostly configuration and testing.

### 7. Native helpdesk and call-tool connectors (only on demand)
- Intercom and Zendesk first (ticket links back to the request, feedback captured from closed tickets), then Help Scout and Freshdesk.
- Gong and Fathom next if transcript import (step 3) proves too manual.
- Each one: owner approval, subprocessor entry, local stand-in, privacy review of what is pulled.

## Not planned for now
- Browser extension, Segment, Google Analytics: the API and inbound endpoint already cover the data.
- App store and review-site scrapers: scraping terms vary; use the customer's own automation into step 2.
- Marketplace listings (Zapier app, Slack directory): after steps 1 and 2 are used by real customers.

## Cross-cutting rules for every step
- Contract first: change `api/openapi.yaml`, regenerate.
- Admin-only to configure; viewers get 403 on every mutating route (the sweep enforces it).
- Secrets encrypted at rest, shown once, never in logs, URLs or bundles; `.env.example` lists names only.
- Customer data only goes to routes allowed to receive it.
- Every connector has a stand-in for tests, a disconnect path that deletes stored credentials, and an entry in `docs/OWNER-TODO.md` for the real-service check that only the owner can do.
- Clean room: no competitor names or text in code, UI or docs.
