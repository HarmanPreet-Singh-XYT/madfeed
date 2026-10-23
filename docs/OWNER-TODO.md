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
- [ ] **File storage for recordings:** a production bucket and its credentials (the code has a local-disk store only; an S3-compatible one needs writing once you pick the provider).
- [ ] **Email (Resend):** a sender domain with SPF/DKIM/DMARC set up, `RESEND_API_KEY`, and the webhook secret (`RESEND_WEBHOOK_SECRET`, the full `whsec_...` value) with the webhook URL pointed at `/v1/webhooks/resend`. Then one real test: does mail land in an inbox, and does a bounce suppress the address.
- [ ] **Production settings to set:** `APP_ENV=production`, `TRUSTED_PROXY_HOPS` (how many proxies of yours sit in front of the API; 0 if none), `UNSUBSCRIBE_SECRET` (32+ random characters), https `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `PUBLIC_API_URL` for the embed snippet shown in Settings.
- [ ] **Backups:** check your Supabase plan's own backup schedule and retention. The restore drill proves our data restores; it does not prove the provider keeps copies.
- [ ] **1 GB upload test** on the real storage and host (only possible once they exist).

## C. Known gaps I chose to leave; decide whether they matter

- [ ] **Form lock-out by someone holding the key and many addresses:** can still fill the daily cap of 200 and block the real form for a day. A captcha service would close it; decide if it matters. (AI spend from forms is already capped to 100 reads a day.)
- [ ] **No metrics or distributed tracing** (alerts and request ids exist).

## D. Phase 6 decisions (outward surfaces); each blocks one item

- [ ] **Public votes:** what identifies a voter? (a) email confirmation by link, which means sending an email to an address a visitor typed, a change to the "nothing sent without approval" rule; or (b) votes only from signed-in customers.
- [ ] **Billing:** payments provider (Stripe is the likely one), test keys, and the plans and prices.
- [ ] **Chat connector:** which tool (Slack likely) and a registered app.
- [ ] **Issue-tracker link:** which tracker (Linear, Jira or GitHub) and an account to test against.
- [ ] **Public API and MCP:** wanted now or later?
- [ ] **Weekly digest:** who receives it and when.

## E. Housekeeping

- [ ] **Rotate the `app_api` database password** you pasted into chat earlier, once convenient, and update `.env`. (Passwords shared in a conversation should be treated as exposed.)
- [ ] **Name the product.** Nothing is named yet; I have not invented one.
- [ ] **Push the repository somewhere** (I have only committed locally and will not push without your say-so). CI is manual-only by your instruction.
