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
- [ ] **Backups:** check your Supabase plan's own backup schedule and retention. The restore drill proves our data restores; it does not prove the provider keeps copies.
- [ ] **1 GB upload test** on the real storage and host (only possible once they exist).

## C. Known gaps I chose to leave; decide whether they matter

- [ ] **Form lock-out by someone holding the key and many addresses:** can still fill the daily cap of 200 and block the real form for a day. A captcha service would close it; decide if it matters. (AI spend from forms is already capped to 100 reads a day.)
- [ ] **Metrics are exposed but nothing reads them yet:** set `METRICS_TOKEN`, point a monitoring service at `/metrics` (Grafana Cloud, Better Stack, etc.; your choice of vendor) and decide alert rules. No distributed tracing (alerts and request ids exist).

## D. Phase 6 decisions (outward surfaces); each blocks one item

- [ ] **Voter accounts (votes and the sign-up page are built):** in Supabase, decide: email confirmation on (recommended) and a sender/SMTP so confirmation emails actually arrive, password rules (the page asks for 10+ characters), and optionally a captcha to slow bots. Then one real test: sign up, get the email, confirm, vote. **Also check that a confirmed Supabase account's token carries `user_metadata.email_verified: true`** (decode one at jwt.io or ask me to): verified voting by email match depends on it, and an unconfirmed address must show `false`.
- [ ] **Billing:** payments provider (Stripe is the likely one), test keys, and the plans and prices.
- [ ] **Chat connector:** which tool (Slack likely) and a registered app.
- [ ] **Issue-tracker link:** which tracker (Linear, Jira or GitHub) and an account to test against.

## D1. Verified voting (built)
- [ ] To let your own users vote without an account: Settings > Verified voting > create a signing secret (shown once), keep it on your server, and make the roadmap link with the example code shown there. Tell me if you want the example in another language.
- [ ] Import your customers into People (CSV) so email matches work.

## D1b. Using the API and MCP server (built)
- [ ] Settings > API keys and AI assistants: make a key, build the program (`cd api && go build -o feedback-mcp ./cmd/mcp`), and add it to your assistant's settings with the example shown there. Treat keys like passwords. Decide whether a hosted MCP endpoint with sign-in (for remote assistants) is wanted; it is not built.

## D2. Using the weekly digest (built, off by default)
- [ ] It needs email to be set up (section B). Then, in Settings > Weekly digest: pick the day and hour (UTC), list up to 10 recipients, tick that they agreed, and save. Use "Preview" first. Nothing is sent until you do this.

## E. Housekeeping

- [ ] **Rotate the `app_api` database password** you pasted into chat earlier, once convenient, and update `.env`. (Passwords shared in a conversation should be treated as exposed.)
- [ ] **Name the product.** Nothing is named yet; I have not invented one.
- [ ] **Push the repository somewhere** (I have only committed locally and will not push without your say-so). CI is manual-only by your instruction.
