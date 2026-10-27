# Shared cache (Redis)

The API keeps no state of its own. Anything worth remembering between requests goes through `internal/cache`, backed by Redis when `REDIS_URL` is set. Local: `make dev-redis`, then `REDIS_URL=redis://127.0.0.1:63790`. Without `REDIS_URL` everything works as before, straight from Postgres.

## Rules
- **Only a cache.** Postgres is the source of truth. Every caller works with an empty or missing cache; unset `REDIS_URL` gives `cache.Nop`.
- **Fail open.** Calls time out at 50 ms; three failures in a row skip Redis for 5 s. A caller hanging up is not counted as a failure. An outage costs speed, never availability, so Redis is not a `/readyz` check. The breaker opening and closing is logged, and `/metrics` shows `app_cache_events_total` (hit, miss, error, skipped) and `app_cache_breaker_open`.
- **Signed values.** What the cache holds decides who may do what (a role, an API key's permissions, a plan), so every stored value carries an HMAC of its key and value (`cache.Sign`, secret derived from `UNSUBSCRIBE_SECRET`). A value written by anyone else, copied to another key, or altered is treated as missing. Someone who can write to Redis can still delete entries or replay an old valid one until it expires, but cannot invent access.
- **TLS in production.** `REDIS_URL` (and `REDIS_RATE_URL`) must start with `rediss://` when `APP_ENV=production`. Set a memory limit and an eviction policy on the Redis itself (`maxmemory`, `allkeys-lru`); nothing in the app can do that for you.
- **Rate limits can have their own Redis** (`REDIS_RATE_URL`), so a flood of cache entries can never evict their counters.
- **No personal data, no secrets.** Ids, roles, plan state, origins, key permissions and counters only. Never quotes, emails, names, message text, API secrets or integration credentials. Keys are named by hash or id, never by the caller. Errors about the address never repeat it (it contains the password).
- **Tenant isolation.** Every key that holds workspace data includes the workspace id (and the person when it is per person). "Not a member" is never cached.
- **Invalidate on the write, after the commit.** Each item below lists the writes that delete it. If Redis cannot take a delete right then, it is logged and retried in the background for about 25 seconds (`cache.Persist`); if it never succeeds the entry expires on its own.
- **One lookup for a crowd.** When a hot entry expires, requests that miss together share a single database lookup (`cache.Load`).
- Setting a key can race a delete by a few milliseconds (a reader loads the old value, the writer commits and deletes, the reader then stores the old value). The TTL bounds that to 30 to 60 seconds.

## What uses it
| Use | Key | TTL | Deleted by |
|---|---|---|---|
| Rate limits | `rl:{name}:{hash}` | window | expires; falls back to Postgres `rate_hit`, then a per-process count |
| Role in a workspace | `tenant:{ws}:{user}` | 30 s | `team.SetRole`, `team.Remove`, `workspaces.Delete`, `cmd/accountdeletion` |
| Billing account | `plan:{ws}` (raw account; what it allows is worked out on every read, so a grace period ends on time) | 60 s | every billing write: Stripe webhook, reconcile job, customer creation; `workspaces.Delete` |
| API key (assistants, `/v1/ext`, MCP) | `apikey:{hash}`: id, workspace, scopes, allowed addresses, expiry. The address rule is checked on every call; the TTL never exceeds the key's own expiry | 30 s | `apikey.Revoke`, `team.Remove`, OAuth disconnect and token rotation, `workspaces.Delete`, `cmd/accountdeletion` |
| Quiet chat polls | `chatver:{ws}:{visitor}` + `chatidle:{ws}:{visitor}`: a poll that found nothing is remembered with a version; a visitor message or team reply sets a new version. At most 600 new markers a minute per workspace (the widget token is public) | 60 s / 1 h | `ChatSend`, `Reply` |

Also in this work (not Redis):
- Per-request memo: the module gate and the handler share one membership lookup (`tenantMemoKey`).
- `GET /v1/workspaces/{id}/shell` returns everything the navigation draws in one call; the layout and `getWorkspace` use it.
- API key usage entries are written in one batch per workspace every 250 ms (`apikey.StartLog`), each with the time it happened. What is left is flushed on shutdown, and one bad entry cannot lose its neighbours. A crash can lose up to a quarter of a second of entries.
- Public release notes and the public roadmap are deliberately **not** cached in the web app. A copy kept in one web instance cannot promise that someone who has just published a note, taken one down, or voted sees that change, because their next request may reach another instance (a browser test that publishes a note and opens the public page caught exactly this). The slug and note id are checked before they reach the API.

## Known limits
- If Redis flaps, a rate-limit window can be counted partly in Redis and partly in Postgres, so a caller can briefly exceed a limit by up to twice. Counters restart if Redis restarts without persistence.
- A role, key or plan change made by hand in the database (not through the app) is seen after the entry expires, up to 30 to 60 seconds.

## Not cached on purpose
- Plan or spend checks for AI calls (`GetAISpend`): it is a money limit, and a stale number could let spend through.
- Integration credentials: sealed secrets stay out of Redis.
- Public site `slug` lookups: one trivial query; invalidating on slug rename, key rotation and workspace delete costs more than it saves.

Config: `REDIS_URL`, `REDIS_RATE_URL` (optional), `REDIS_KEY_PREFIX` (default `app`; set it when one Redis serves several environments). `cmd/accountdeletion` reads the same variables to drop entries when it removes a person, and says so when it cannot.
