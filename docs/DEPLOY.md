# Deploying to a VPS

Three containers on one machine behind the nginx you already run, database at Supabase. The web app
and the API are published on `127.0.0.1` only, so nothing is reachable except through nginx.

```
browser ──► nginx :443 ──► web 127.0.0.1:3000 ──► api 127.0.0.1:8080 ──► Supabase (pooler)
                     └───► api 127.0.0.1:8080            worker ────────► Supabase (session pooler)
```

## What you need first

- Docker and the compose plugin on the VPS.
- `app.example.com` and `api.example.com` pointing at it.
- A Supabase project with migrations applied (step 2) and a user to sign in with.
- nginx installed and running (you have this).

## 1. Code and config

```bash
git clone <repo> madfeed && cd madfeed
cp deploy/api.env.example deploy/api.env
cp deploy/web.env.example deploy/web.env
# edit both: every line marked REQUIRED in deploy/api.env has no default
```

`deploy/api.env` and `deploy/web.env` are git-ignored — they hold the one secret this system has
(`UNSUBSCRIBE_SECRET`), so they live on the server.

## 2. Migrations, once, with the privileged role

The API and worker never receive `DATABASE_ADMIN_URL`; migrations are a one-off run of the image's
second binary. Forward-only.

```bash
docker compose -f deploy/docker-compose.yml build api
docker compose -f deploy/docker-compose.yml run --rm \
  -e DATABASE_ADMIN_URL='postgres://postgres:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  --entrypoint /app/migrate api
# expect "successfully migrated database to version: 66" or "database is up to date"
```

## 3. Start the containers

```bash
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
```

## 4. Point nginx at them

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/madfeed.conf
sudo $EDITOR /etc/nginx/conf.d/madfeed.conf     # replace app.example.com / api.example.com
sudo certbot --nginx -d app.example.com -d api.example.com
sudo nginx -t && sudo systemctl reload nginx
```

The config already handles the things that bite later: `client_max_body_size` for pasted
conversations and recording chunks, `proxy_read_timeout 120s` so long AI calls are not cut at 60 s,
and buffering off for audio playback so seeking works.

## 5. Prove it, in this order

```bash
curl -sf https://api.example.com/healthz            # alive
curl -sf https://api.example.com/readyz             # database reachable
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.example.com/v1/workspaces             # expect 401: refuses unsigned requests
curl -sI https://api.example.com/healthz | grep -i strict-transport-security
```

Then in a browser: sign in, open the request list, open one request and read its cited evidence.
Those three screens are the whole product.

## Updating

```bash
git pull
docker compose -f deploy/docker-compose.yml run --rm -e DATABASE_ADMIN_URL=... --entrypoint /app/migrate api
docker compose -f deploy/docker-compose.yml up -d --build
```

The worker gets `stop_grace_period: 60s`, so an extraction or a send finishes before it dies.

## Pre-flight you can run locally

`make deploy-drill` builds the images, runs them with production settings and a read-only
filesystem, checks health, the 401, the security headers and the sign-in page, ships a deliberately
broken version (wrong database password), confirms its readiness check catches it, raises an alert
that does not leak the password, rolls back, and checks both processes stop cleanly on SIGTERM.
It passes on this repository as of 2026-10-30.

## Traps that cost time

- **Two pooler modes, two meanings.** `DATABASE_URL` may use the transaction pooler on `:6543`
  **with `DATABASE_POOLER=true`**; on `:5432` (session) leave `DATABASE_POOLER` unset. `:6543`
  without the flag fails on prepared statements. `DATABASE_DIRECT_URL` must always be the **session**
  pooler — River picks up jobs over `LISTEN/NOTIFY`. The direct `db.<ref>.supabase.co` host is
  IPv6-only and will not resolve on most VPSes.
- **`ALLOWED_ORIGINS` is compared exactly.** `https://app.example.com`, no trailing slash, no `*`.
- **The worker needs the production values too.** `APP_ENV=production` requires `ALLOWED_ORIGINS`,
  `UNSUBSCRIBE_SECRET`, `PUBLIC_BASE_URL`, `TRUSTED_PROXY_HOPS` and `AI_CONFIG` for **both** modes.
- **`TRUSTED_PROXY_HOPS` is per process.** `web` sees nginx (1). `api` sees the web app, and nginx on
  direct calls, which is why the example uses `2`. Get it wrong and every visitor shares one
  rate-limit bucket instead of failing loudly.
- **Distroless images have no shell, no curl and no package manager.** No compose `healthcheck` that
  shells out; use `/readyz` from outside, as in step 5.
- **`api/config/ai.json` is git-ignored** (per-developer). Deployed builds use
  `api/config/ai.production.json`, which is committed: model ids and prices only, key from env.
- **Recordings need somewhere to live.** `MEDIA_DIR=/data/media` uses the compose volume; setting
  all five `STORAGE_S3_*` values instead requires clearing `MEDIA_DIR`. They are mutually exclusive.

## What this shape cannot do

One machine: no redundancy, no rolling deploy, no horizontal scale. Fine for a demo or a first
customer — both services are stateless apart from the media volume, so moving the worker to its own
host later is a compose change, not a code change.
