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
make api         # http://localhost:8080/healthz
make web         # http://localhost:3000
make check       # lint, types, tests, audits (what CI runs)
```
Contributors and AI agents: read `AGENTS.md` and `docs/engineering-principles.md` first.
