# Product (working name)

Conversation → cited requests → decision → personal reply when it ships.

| Folder | What |
|---|---|
| `web/` | Next.js client |
| `api/` | Go API and worker |
| `synthesis/` | Research, spec, blueprint, test plan |
| `docs/` | Engineering principles, gate records |

## Run locally
```
cp .env.example .env
make dev-db      # Postgres + pgvector in Docker
make migrate     # schema + job-queue migrations
make dev-role    # restricted login role the API uses (once)
make devauth     # fake identity provider on :9999 (dev only), in its own terminal
# then run the API with DATABASE_URL, SUPABASE_JWKS_URL and JWT_ISSUER from .env.example
make api         # http://localhost:8080/healthz
make web         # http://localhost:3000

# get a token for a user:  curl 'localhost:9999/token?sub=<any uuid>'
make check       # lint, types, tests, audits (what CI runs)
```
Contributors and AI agents: read `AGENTS.md` and `docs/engineering-principles.md` first.
