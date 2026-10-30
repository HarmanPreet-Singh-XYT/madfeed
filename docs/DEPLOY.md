# Deploying

The web app lives on Vercel. The VPS runs two containers — the API and its worker — behind the nginx
you already have. The database is Supabase.

```
browser ──► Vercel (Next.js) ──► nginx :443 ──► api 127.0.0.1:8080 ──► Supabase (pooler)
                                                        worker ────────► Supabase (session pooler)
```

The API is published on `127.0.0.1` only, so it is reachable solely through nginx.

## What you need first

- Docker and the compose plugin on the VPS.
- `api.example.com` pointing at the VPS.
- A Supabase project with migrations applied (step 2) and a user to sign in with.
- The web app deployed on Vercel (step 4).

## 1. Code and config on the VPS

```bash
git clone <repo> madfeed && cd madfeed
cp deploy/api.env.example deploy/api.env
$EDITOR deploy/api.env      # every line marked REQUIRED has no default
```

`deploy/api.env` is git-ignored: it holds the one secret this system has (`UNSUBSCRIBE_SECRET`).

The two values people get wrong are `ALLOWED_ORIGINS` and `PUBLIC_BASE_URL` — both must be the
Vercel URL exactly (`https://madfeed.vercel.app`), not the API's own address.

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

## 3. Start the API and the worker

```bash
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps      # api and worker, both healthy in restart policy
```

## 4. Point nginx at the API

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/madfeed.conf
sudo $EDITOR /etc/nginx/conf.d/madfeed.conf     # replace api.example.com
sudo certbot --nginx -d api.example.com
sudo nginx -t && sudo systemctl reload nginx
```

The config already sets `client_max_body_size 32m` for pasted conversations and recording chunks,
`proxy_read_timeout 120s` so long AI calls are not cut at nginx's default 60 s, and buffering off for
audio playback so seeking works.

## 5. Point Vercel at the API

Vercel → Project → Settings → Environment Variables (Production), then redeploy — `SITE_*` values are
baked at build time:

```
API_URL=https://api.example.com
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TRUSTED_PROXY_HOPS=1
SITE_URL=https://madfeed.vercel.app
PUBLIC_WEB_URL=https://madfeed.vercel.app
APP_ENV=production
```

See `deploy/web.env.example` for the optional ones (contact emails, legal name, SSO).

## 6. Prove it, in this order

```bash
curl -sf https://api.example.com/healthz            # alive
curl -sf https://api.example.com/readyz             # database reachable
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.example.com/v1/workspaces             # expect 401: refuses unsigned requests
curl -sI https://api.example.com/healthz | grep -i strict-transport-security
```

Then in the browser, on the Vercel URL: sign in, open the request list, open one request and read its
cited evidence. Those three screens are the whole product.

## Updating

```bash
cd madfeed && git pull
docker compose -f deploy/docker-compose.yml run --rm -e DATABASE_ADMIN_URL=... --entrypoint /app/migrate api
docker compose -f deploy/docker-compose.yml up -d --build
```

The worker gets `stop_grace_period: 60s`, so an extraction or a send finishes before it dies.

## Pre-flight you can run locally

`make deploy-drill` builds the images, runs them with production settings on a read-only filesystem,
checks health, the 401, the security headers and the sign-in page, ships a deliberately broken
version (wrong database password), confirms readiness catches it, raises an alert that does not leak
the password, rolls back, and checks both processes stop cleanly on SIGTERM. It passes on this
repository as of 2026-10-30.

## Traps that cost time

- **Two pooler modes, two meanings.** `DATABASE_URL` may use the transaction pooler on `:6543`
  **with `DATABASE_POOLER=true`**; on `:5432` (session) leave `DATABASE_POOLER` unset. `:6543`
  without the flag fails on prepared statements. `DATABASE_DIRECT_URL` must always be the **session**
  pooler — River picks up jobs over `LISTEN/NOTIFY`. The direct `db.<ref>.supabase.co` host is
  IPv6-only and will not resolve on most VPSes.
- **`ALLOWED_ORIGINS` is the Vercel origin, compared exactly.** No trailing slash, never `*`. A
  mismatch shows up as CORS-looking failures on every page load.
- **The worker needs the production values too.** `APP_ENV=production` requires `ALLOWED_ORIGINS`,
  `UNSUBSCRIBE_SECRET`, `PUBLIC_BASE_URL`, `TRUSTED_PROXY_HOPS` and `AI_CONFIG` for **both** modes;
  the worker refuses to boot if you only set them on the API.
- **Distroless images have no shell, no curl, no package manager.** No compose `healthcheck` that
  shells out; use `/readyz` from outside, as in step 6.
- **`api/config/ai.json` is git-ignored** (per-developer). Deployed builds use
  `api/config/ai.production.json`, which is committed: model ids and prices only, key from env.
- **Recordings need somewhere to live.** `MEDIA_DIR=/data/media` uses the compose volume; setting
  all five `STORAGE_S3_*` values instead requires clearing `MEDIA_DIR`. They are mutually exclusive.
- **Vercel functions are not the worker.** Background jobs are picked up by this VPS worker only; if
  it is down, extraction queues up rather than running.

## What this shape cannot do

One VPS: no redundancy and no rolling deploy for the API. Both processes are stateless apart from
the media volume, so moving the worker to its own host later is a compose change, not a code change.
