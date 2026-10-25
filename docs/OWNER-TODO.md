# Things only you can do (or decide)

Kept current as work proceeds. Tick items off as you go. Nothing here blocks local development.

## A. To sign off Gate 5 (quality and hardening)

- [ ] **Staging environment.** Decide where this runs (host for the API and worker, host for the web app, hosted Postgres you already have in Supabase). Then I can deploy the images (`make images`) and run the full regression there. Costs money; your call.
- [ ] **Cold test.** One person who has never seen the product does tasks F1 to F4 while you watch, no help. Script and note sheet: `docs/gates/cold-test.md`. Pass: all four done, at most two hints.
- [ ] **Screen-reader pass.** 30 minutes with VoiceOver (and NVDA if you have Windows). Checklist at the bottom of `docs/gates/cold-test.md`.
- [ ] **Alert channel.** Create a Slack (or compatible) incoming webhook and put it in `.env` as `ALERT_WEBHOOK_URL`. I will then fire a test alert and confirm it arrives.
- [ ] **Human security review** (optional but recommended before real customers). The AI review found nothing critical; a person with security experience reading `docs/gates/gate-5.md` and the code would add independence.

## B. Accounts, keys and decisions for real (non-local) behaviour

- [ ] **Sign-in against your Supabase project:** a confirmed test user, plus `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `web/.env.local`. Then I run the real sign-in end to end.
- [ ] **Transcription:** choose the vendor (the code speaks the OpenAI-compatible protocol), add `OPENAI_API_KEY`, and set `TRANSCRIBE_PRICE_PER_MINUTE_USD` so spend is counted against the allowance.
- [ ] **File storage for recordings:** the S3-compatible adapter is built and tested against a stand-in. In Supabase: create a private bucket, create S3 access keys (Storage > S3 connection), and set `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` (backend only). Then I run the real-bucket test and the 1 GB upload.
- [ ] **Email (Resend):** a sender domain with SPF/DKIM/DMARC set up, `RESEND_API_KEY`, and the webhook secret (`RESEND_WEBHOOK_SECRET`, the full `whsec_...` value) with the webhook URL pointed at `/v1/webhooks/resend`. Then one real test: does mail land in an inbox, and does a bounce suppress the address.
- [ ] **Production settings to set:** `APP_ENV=production`, `TRUSTED_PROXY_HOPS` (how many proxies of yours sit in front of the API; 0 if none), `UNSUBSCRIBE_SECRET` (32+ random characters), https `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `PUBLIC_API_URL` for the embed snippet shown in Settings.
- [x] Hosted database migrated to version 33 and re-checked (2026-10-23).
- [ ] **Backups:** check your Supabase plan's own backup schedule and retention. The restore drill proves our data restores; it does not prove the provider keeps copies.
- [ ] **1 GB upload test** on the real storage and host (only possible once they exist).

## C. Known gaps I chose to leave; decide whether they matter

- [ ] **Form lock-out by someone holding the key and many addresses:** can still fill the daily cap of 200 and block the real form for a day. A captcha service would close it; decide if it matters. (AI spend from forms is already capped to 100 reads a day.)
- [ ] **Metrics are exposed but nothing reads them yet:** set `METRICS_TOKEN`, point a monitoring service at `/metrics` (Grafana Cloud, Better Stack, etc.; your choice of vendor) and decide alert rules. No distributed tracing (alerts and request ids exist).

## D. Phase 6 decisions (outward surfaces); each blocks one item

- [ ] **Voter accounts (votes and the sign-up page are built):** in Supabase, decide: email confirmation on (recommended) and a sender/SMTP so confirmation emails actually arrive, password rules (the page asks for 10+ characters), and optionally a captcha to slow bots. Then one real test: sign up, get the email, confirm, vote. **Also check that a confirmed Supabase account's token carries `user_metadata.email_verified: true`** (decode one at jwt.io or ask me to): verified voting by email match depends on it, and an unconfirmed address must show `false`.

## D0. Billing, Slack and GitHub (all built and tested only against stand-ins)
I chose Stripe, Slack and GitHub Issues to proceed. If you want different ones, say so; the rest is unaffected.
- [ ] **Decide the plans** (names, prices, what each includes) in a file: copy `docs/plans.example.json`, set `PLANS_CONFIG`.
- [ ] **Stripe (test mode first):** create the products and prices; put the price ids in the plans file; set `STRIPE_SECRET_KEY` (sk_test_...), add a webhook endpoint `<PUBLIC_API_URL>/v1/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`, `invoice.paid`, `charge.refunded` and set `STRIPE_WEBHOOK_SECRET`; configure the Customer Portal (plan changes, cancellation, card updates). Then run a real test-mode checkout, an upgrade, a failed card (4000 0000 0000 0341), a cancel and a refund. Billing stays off until the key is set.
- [ ] **Slack:** create an app (api.slack.com/apps); bot scopes `channels:history`, `channels:read`, `channels:join`; redirect URL `<PUBLIC_BASE_URL>/integrations/slack/callback`; event subscriptions URL `<PUBLIC_API_URL>/v1/integrations/slack/events` with `message.channels`, `app_uninstalled`, `tokens_revoked`; set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
- [ ] **Both need `SECRETS_KEY`** (`openssl rand -base64 32`): back it up; losing it means every connection must be set up again.
- [ ] **GitHub:** each workspace admin makes a fine-grained token for one repository (issues: read and write), pastes it in Settings, then adds the webhook shown there (content type JSON, "Issues" events). Prefer a private repository.

## D1. Verified voting (built)
- [ ] To let your own users vote without an account: Settings > Verified voting > create a signing secret (shown once), keep it on your server, and make the roadmap link with the example code shown there. Tell me if you want the example in another language.
- [ ] Import your customers into People (CSV) so email matches work.

## D1b. Using the API and MCP server (built)
- [ ] Settings > API keys and AI assistants: make a key, build the program (`cd api && go build -o feedback-mcp ./cmd/mcp`), and add it to your assistant's settings with the example shown there. Treat keys like passwords: give each only the permissions it needs, set an expiry, and limit it to known addresses where you can. Assistants that take a web address can use `<your API address>/mcp` with the key. Assistants that require sign-in (OAuth) can use `<your API address>/mcp` with no key: they send the admin to the approval page, and Settings lists what is connected with a Disconnect button. Needs `PUBLIC_API_URL` and `PUBLIC_BASE_URL` set to the real addresses. Try it once with a real assistant after deploying (it is only tested against a script that plays the assistant). Migration 34 must be applied to the hosted database before then. Quote flagging is best-effort: it catches obvious attempts only.

## D2. Using the weekly digest (built, off by default)
- [ ] It needs email to be set up (section B). Then, in Settings > Weekly digest: pick the day and hour (UTC), list up to 10 recipients, tick that they agreed, and save. Use "Preview" first. Nothing is sent until you do this.

## E. Housekeeping

- [ ] **Rotate the `app_api` database password** you pasted into chat earlier, once convenient, and update `.env`. (Passwords shared in a conversation should be treated as exposed.)
- [ ] **Name the product.** Nothing is named yet; I have not invented one.
- [ ] **Push the repository somewhere** (I have only committed locally and will not push without your say-so). CI is manual-only by your instruction.

## E. Phase 7 (surveys)

- [ ] **Apply migrations 35 to 38 to the hosted database** (tell me when; I will re-run the exposure checks).
- [ ] **Add `surveys` to your plans file** for the plans that should include it (the example plans have it on Team and Business).
- [ ] **Send one real invitation** to yourself once Resend is set up: check it lands, the link works from the email, and the unsubscribe link stops the next one.
- [ ] **Decide the defaults** I picked: at most 2,000 invitations per survey, 2,000 new responses a day on a public link and 10 a day from one address, free-text answers removed (not anonymised) when a person is deleted.
- [ ] **Read a few real survey answers through extraction** once a real model is connected, to see whether the suggestions are good.

## F. Survey limits noted on 2026-10-24 (nothing is blocked; decide when it matters)

- [ ] **"One person" on a public survey link** cannot be proven. Caps (per browser, per address a day, per link a day) bound the abuse; personal links (email or by hand) give exactly one answer per person. Proving it would mean making each visitor confirm an email address, which sends mail to strangers; decide if that is wanted.
- [ ] **Branching** looks at earlier ratings and choices only, now up to four conditions combined with "all" or "any" (never at free text: I advise against it). Say if you want more.
- [ ] **Reminders are capped at two per person, three days apart** (code defaults; no setting yet).
- [ ] **Real email**: no survey invitation or reminder has gone through a real provider.
- [ ] **Hosted database is at migration 34**; surveys need 35 to 38 (tell me to apply them).

## G. Phase 8 (research depth)

- [ ] **Label 200 quotes yourself** (Quotes > Tags over time > Label quotes), then connect a real model (`AI_CONFIG`) and press "Let the model label" until the quotes are covered. The page then shows how often the model matched you. Until that is 200+ quotes at 80% or better, treat feeling labels as a guess. This is the one Gate 8 item I cannot do for you.
- [ ] **Apply migration 39** to the hosted database (with 35 to 38; tell me).
- [ ] **Read a findings document through the shared link once** before relying on it: customers' words can name people.

## H. Phase 9 (support desk and chat)

- [ ] **Incoming email**: choose how customers' email reaches the inbox. The product accepts signed JSON at the address shown in Settings > Inbox (format and signing are written there and in `docs/gates/gate-9.md`). Resend's receiving feature or any mail service with a webhook can feed it, probably through a small adapter I can write once you pick the service. Also set `SUPPORT_REPLY_TO` to the address customers' answers should go to.
- [ ] **Sending domain**: replies come from `EMAIL_FROM_ADDRESS`; SPF, DKIM and DMARC must be set up on that domain (same as for the other email) before real customers get replies. Then one real round trip: customer email in, reply out, their answer joining the same conversation.
- [ ] **Try the chat on a real page** of your site (add the site under Settings > Inbox, paste the snippet) and watch it on a phone.
- [ ] **Apply migration 40** (with 35 to 39) to the hosted database; tell me.
- [ ] **Apply migration 42** (names, saved replies, first-reply times) and 43 (chat files) with 35 to 41. Tell each teammate to set their name under Inbox > Your name, saved replies and target; until then they show as "a teammate".
- [ ] Decide the reply target (Inbox > desk setup; off by default).


## I. Meaning-based matching and search (added 2026-10-24)

- [ ] **Add `OPENAI_API_KEY`** (embeddings, model `text-embedding-3-small`, 512 numbers per text). Without it nothing breaks: the review queue shows no "may be the same as" hint and Quotes says search by meaning is not set up. OpenAI becomes a subprocessor for statement and quote text: add it to the subprocessor list and check zero-retention terms.
- [ ] **Add `ASSEMBLYAI_API_KEY`** for transcription (set `TRANSCRIBE_PROVIDER=openai` to use OpenAI instead). Check the current per-hour price and set the cost-log price; AssemblyAI becomes a subprocessor (recordings), and the adapter asks it to delete each transcript after use.
- [ ] **Apply migration 41** (needs the `vector` extension; Supabase has it) with 35 to 40; tell me and I will re-run the exposure checks.
- [ ] **Judge the suggestions on real data.** Matching only ever suggests (never merges), needs the judge's confidence at 0.80 or more, and prefers a miss to a wrong merge. After a week of real use, tell me how often "may be the same as" was wrong; I can raise the bar or run an eval.
- [ ] Search by meaning indexes a workspace's quotes the first time someone uses it (about 2 US cents per 100,000 short quotes); the cost shows in the AI cost log as task `embedding`.

## J. Chat files (added 2026-10-24)

- [ ] Files in website chat work both ways: pictures (PNG, JPEG, GIF, WebP), PDFs and plain text, 5 MB each, 3 per message, 200 MB in total per workspace. They are stored in the database (migration 43), checked by what the bytes really are, and always delivered as a download. **They are not scanned for viruses**: a visitor can send a harmless-looking PDF that is not harmless. Decide if you want a scanner before real customers use it, and tell the team to open files with care.
- [ ] Email conversations do not carry files (neither in nor out); say if you want that.
- [ ] Uploaded files are customer data: they go when the conversation or the person is deleted. Text inside a file is not scanned for secrets the way typed messages are.

## K. Outbound webhooks (added 2026-10-24)

- [ ] Migration 44 (outbound_endpoint, outbound_delivery) joins the hosted ones still to apply (35 to 44).
- [ ] Needs `SECRETS_KEY` set on the API and the worker (already needed for Slack and GitHub). The worker sends; with no worker running, messages wait.
- [ ] Tried only against local receivers. Try one real automation service (create a catch-hook address there, add it, press "Send a test") and tell me what it shows.
- [ ] A release note scheduled for later sends no message when it goes public (it becomes public by the clock, not by an event). Say if you want one.

## L. Linear issues (added 2026-10-24)

- [ ] **Vendor and subprocessor.** Linear is a new outside service. Request titles and counts (never quotes, names or emails) go to the customer's own Linear workspace with a key the customer makes; nothing goes to Linear from us otherwise. Say yes or no to listing it as a service the product talks to, and add it to any subprocessor list you publish. It was built on your "go for next" after the plan named it as needing your approval; tell me if you meant otherwise and I will take it out.
- [ ] Migration 45 joins the hosted ones still to apply (35 to 45).
- [ ] Built and tested only against a local stand-in written from Linear's public documentation (key sent without "Bearer", GraphQL at /graphql, webhook headers `Linear-Signature`, `Linear-Delivery`, a `webhookTimestamp` in the body, issue `state.type`). **Try it with a real Linear team**: connect with a personal key, make a webhook for the Issue resource, paste its signing secret, open an issue from a request, complete it in Linear, and watch the request move.
- [ ] Linear shows the webhook's signing secret itself, so an admin pastes it back after making the webhook; until then changes made in Linear are not followed (the screen says so).
- [ ] A personal key acts as the person who made it. A shared "bot" account with access to just that team is better.
- [ ] One issue tracker per workspace (GitHub or Linear). Say if you need both at once.

## M. Assistants that can change things (added 2026-10-24)

- [ ] Migration 46 (the `write` permission, and two more kinds of activity) joins the hosted ones still to apply (35 to 46).
- [ ] Assistants can now, with an opt-in `write` permission, change a request's status (never into or out of shipped) and add tags. Decide whether you want that offered at all; if not, say so and I will remove the permission from the screens. Keys and assistants made before have no such permission.
- [ ] Not tried with a real assistant (Claude, ChatGPT, Cursor). Try one end to end, including the approval page that now lists "Change statuses and add tags".

## N. Jira issues (added 2026-10-24)

- [ ] **Vendor and subprocessor.** Jira Cloud (Atlassian) is another outside service, used the same way as Linear and GitHub: request titles and counts go to the customer's own Jira with a token the customer makes. Same question as section L: confirm you want it listed, and tell me if you did not mean it to be built.
- [ ] Migration 47 joins the hosted ones still to apply (35 to 47).
- [ ] Built and tested only against a local stand-in written from Atlassian's public documentation (Basic auth with account email and API token on `https://<site>.atlassian.net`, REST version 2, `X-Hub-Signature: sha256=` and `X-Atlassian-Webhook-Identifier` on webhooks, `statusCategory` for done). **Try it with a real Jira Cloud project**: connect, make the webhook in Jira's System settings with the URL and secret shown, open an issue from a request, move it to Done, and watch the request move.
- [ ] Only Jira Cloud (not Server or Data Center). Authentication is an API token, which acts as the person who made it; a shared account made for this is better. Atlassian's sign-in app flow (OAuth) is not built; say if token-based is not acceptable to your customers.
- [ ] Jira's admin webhook screen decides which projects and events it sends; the screen tells the admin to send issue updated and issue deleted only.

## O. Chat notifications (added 2026-10-24)

- [ ] Migration 48 (a `format` on outbound webhook addresses) joins the hosted ones still to apply (35 to 48).
- [ ] Post a test to a real Slack, Discord and Teams channel (Settings, "Messages to other tools", pick the channel type, paste the channel's incoming-webhook address, press "Send a test"). Teams' message shape is the one used by its "Workflows" webhooks; tell me if your tenant needs a different one.

## P. HubSpot account value (added 2026-10-24)

- [ ] **Vendor and subprocessor.** HubSpot is another outside service. Customers' email addresses are sent to the customer's own HubSpot to look people up; nothing is sent to HubSpot otherwise and nothing is written there. Confirm you want it listed, or tell me to take it out.
- [ ] Migration 49 joins the hosted ones still to apply (35 to 49).
- [ ] Built and tested only against a local stand-in written from HubSpot's public documentation (private-app bearer token; contacts batch read by email; associations v4 batch read for contact to company and company to deal; companies and deals batch read). **HubSpot's newer documentation shows date-versioned paths for associations; I used the long-standing `/crm/v4/associations/...` paths, which may need changing.** Try it with a real HubSpot account, with a private app that has only read scopes for contacts, companies and deals, and look at what it filled in.
- [ ] Decide what "value" should mean for your customers (annual revenue vs closed-won deals); both are offered. Other choices (open deals, a custom property) are not built.
- [ ] The first sync starts within a minute of connecting and then runs daily; people added later are picked up on the next run.
- [ ] Salesforce is not built. Say if you need it.

## Q. Switching built services on (added 2026-10-24)

Every outside service is behind one setting, `INTEGRATIONS_ENABLED` (a comma-separated list, on the API and the worker). **The default is `slack,github`, so Linear, Jira and HubSpot, though built, are OFF on a server that does not list them.** A service that is off is hidden from the settings screen, its routes and notifications answer "not found", it runs no background work, and anything already stored for it stays untouched so switching it on again picks up where it was. To turn on, for example, Linear and HubSpot: `INTEGRATIONS_ENABLED=slack,github,linear,hubspot` and restart. A typo in the list stops the server from starting. The browser tests turn everything on.

- [ ] Decide which of the built services you want on, once you have approved the vendor and tried it for real (sections L, N, P).

## R. ClickUp, Asana and Azure DevOps issues (added 2026-10-24; OFF by default)

Built and tested only against local stand-ins written from each vendor's public documentation, and switched off unless `INTEGRATIONS_ENABLED` lists them (section Q): `clickup`, `asana`, `azuredevops`. They share one driver framework (`internal/integrations/tracker.go`), one screen drawn from what each driver asks for, and the same rules as GitHub, Linear and Jira (title and counts only, one tracker per workspace, conflicts held back, nothing sent back).

- [ ] Migration 50 joins the hosted ones still to apply (35 to 50).
- [ ] **Vendors and subprocessors.** Each is another outside service used the same way as the others. Confirm or tell me to take them out.
- [ ] **ClickUp:** the notification is registered at ClickUp by us when the admin connects (so the API must be reachable on a public https address, `PUBLIC_API_URL`); signed with `X-Signature` (HMAC-SHA256 hex of the body). I could not confirm the exact shape of the response that carries the secret and handled both likely shapes.
- [ ] **Asana:** also registered by us; Asana introduces its signing secret in a handshake while the connect request waits. That secret is accepted only in the two minutes after connecting and only if none is known, so nobody can replace it. Asana's notifications do not say which way a task changed, so each is followed by one read of the task.
- [ ] **Azure DevOps:** Azure DevOps cannot register its own webhook through us and has no signing; the admin makes a service hook (Web Hooks, "Work item updated" and "deleted") with a password we generate and show once, sent as basic authentication over https. The states that count as "done" are set at connection (default Done, Closed, Resolved, Completed).
- [ ] Try each with a real account before switching it on.

## S. Salesforce account value (added 2026-10-24; OFF by default)

- [ ] Migration 51 joins the hosted ones still to apply (35 to 51). It also replaces the function the worker uses to find due HubSpot syncs with one that serves both CRMs.
- [ ] **Vendor and subprocessor**, as for HubSpot: customers' email addresses are sent to the customer's own Salesforce to look people up; nothing is written there. Confirm or tell me to take it out.
- [ ] Built against Salesforce's public documentation only: the client-credentials OAuth flow on a connected app (which Salesforce has to be set up to allow, with a "run as" user), read-only SOQL on REST API version 60.0, `AnnualRevenue` and `SUM(Amount)` of `IsWon` opportunities. **Try it with a real org** (a developer or sandbox org is enough) before switching it on.
- [ ] Say if your customers will need a sign-in flow (authorisation code) instead of client credentials; that is not built.
