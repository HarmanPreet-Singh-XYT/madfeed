# Integrations backlog

The integrations that are **not built**, kept in one place with what each would do, how it works today, a suggested order and what building it needs. Written 2026-10-24. What is built is in `docs/PLATFORM.md` (section 12) and `docs/INTEGRATIONS-PLAN.md`; the built-but-switched-off ones are in `docs/OWNER-TODO.md` (sections L to T).

**Rule for every item:** a new outside service is a new vendor. It needs the owner's yes before it is built, a local stand-in for tests, a switch in `INTEGRATIONS_ENABLED` (off until tried against the real service), and an entry on the subprocessors page if customer data goes to it. Customer quotes, names and emails never go to a tracker or CRM.

**Effort:** S about a day, M a few days, L a week or more. **Today** says how a customer gets the same result without it.

## A. Native capture from help desks (suggested first)
| Tool | What it adds | Today | Effort |
|---|---|---|---|
| Intercom | Capture closed conversations automatically; link a ticket to a request | Send the thread to `/v1/ext/feedback` from an automation | M |
| Zendesk | Same; capture after a ticket is solved | Same | M |
| Help Scout | Same | Same | M |
| Freshdesk | Same | Same | M |
| Gist | Same | Same | S |

Shape: an admin connects with a token; a webhook or poll finds solved conversations; the thread is sent through the existing inbound path with the other tool's id (so it is stored once); a ticket link is kept on the request. Reuse the tracker-driver ideas (sealed credentials, switch, stand-in).

## B. Native capture from call tools (suggested second)
Gong, Fathom, Fireflies, Grain, tl;dv, Zoom, Google Meet. Adds: transcripts arrive without anyone sending them. Today: send the transcript to `/v1/ext/transcripts`. Effort: M each. Gong and Fathom first. Zoom and Google Meet may need their own recording/transcript permissions and an app review by the vendor (longer lead time).

## C. Forms and surveys
Typeform, Google Forms, SurveyMonkey: capture free-text answers automatically. Today: post answers to `/v1/ext/feedback` from the tool's webhook or an automation. Effort: S to M each.

## D. Reviews
G2, Capterra, Trustpilot, Apple App Store, Google Play, Product Hunt, Salesforce AppExchange: capture new reviews. Today: paste or send each. Effort: M each, and some have terms that restrict automated collection, so check each one's terms first.

## E. Team chat as a source
Microsoft Teams and Discord as places to *collect* feedback (outbound notifications already work). Effort: M each.

## F. Identity
- Okta, Entra ID, OneLogin, Google Workspace: group import and joining a workspace automatically by company domain; SCIM. Company sign-in itself is built (through Supabase) and switched off. Effort: L.
- Salesforce authorisation-code sign-in (the built one uses client credentials). Effort: M.
- Jira Server and Data Center (the built one is Jira Cloud). Effort: M.

## G. Data in and plugins
Segment, Google Analytics, a browser extension to capture from any page, WordPress and Shopify plugins for the form and chat. Effort: M to L each. Most useful: the browser extension.

## H. Marketplaces and listings
- Zapier, Make, OttoKit, Pabbly, Integrately apps (today the inbound endpoint and webhooks work with their generic web-request steps).
- The Slack app directory.
- The connector directories of the AI assistants (Claude, ChatGPT, Cursor and others).
All need the product name, a public domain, a privacy policy and terms that a lawyer has read, and the vendor's review. Do these after the name exists.

## I. More trackers and CRM extras
- Trackers: Monday, Trello, Shortcut; Notion and Confluence export. Effort: S each now that the tracker driver framework exists (`internal/integrations/tracker.go`).
- CRMs: write-back (deliberately not planned until a customer asks), value from open deals or a custom field, more CRMs (Pipedrive, Zoho). Effort: S to M each; they share `internal/integrations/crm.go`.

## Suggested order
1. Intercom and Zendesk (A), the most requested and the most manual today.
2. Gong and Fathom (B).
3. The browser extension (G).
4. Typeform and Google Forms (C).
5. Marketplace listings (H) once there is a name.
Re-order by what customers ask for; the public integrations page says the same.

## Before any of them
Switch on, and try with a real account, the eight that are already built and off (Linear, Jira, ClickUp, Asana, Azure DevOps, HubSpot, Salesforce, company sign-in): `docs/OWNER-TODO.md` sections L to T.
