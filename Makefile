.PHONY: dev-db migrate dev-role devauth api web check api-check web-check generate check-generated
dev-db:        ## start local Postgres (pgvector)
	docker compose up -d db
migrate:       ## apply schema + job-queue migrations to the local database (privileged role)
	cd api && DATABASE_ADMIN_URL="postgres://app:dev-only-password@127.0.0.1:54322/app?sslmode=disable" go run ./cmd/migrate
dev-role:      ## create the restricted application login role in the local database (once)
	docker compose exec -T db psql -U app -d app -c "DO \$$\$$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_api') THEN CREATE ROLE app_api LOGIN PASSWORD 'dev-api-password' IN ROLE app_backend NOSUPERUSER NOBYPASSRLS; END IF; END \$$\$$;"
devauth:       ## local stand-in for the identity provider (dev only): JWKS + token minting on :9999
	cd api && go run ./cmd/devauth
api:           ## run the API locally
	cd api && go run ./cmd/server
web:           ## run the web client
	cd web && npm run dev
api-check:     ## everything CI runs for the backend
	cd api && gofmt -l . | (! grep .) && go vet ./... && go test -race ./... && (command -v govulncheck >/dev/null && govulncheck ./... || echo "govulncheck not installed: go install golang.org/x/vuln/cmd/govulncheck@latest")
web-check:     ## everything CI runs for the web client
	cd web && npm run lint && npm run typecheck && npm test && npm audit --omit=dev --audit-level=high
generate:      ## regenerate Go stubs and the TypeScript client from api/openapi.yaml
	cd api && go generate ./... && cd ../web && npm run generate:api
check-generated: ## fail if generated code is stale relative to the contract
	@mkdir -p /tmp/gen-check && cp api/internal/api/api.gen.go /tmp/gen-check/a.go && cp web/lib/api/schema.gen.d.ts /tmp/gen-check/s.ts
	@$(MAKE) -s generate >/dev/null
	@diff -q /tmp/gen-check/a.go api/internal/api/api.gen.go && diff -q /tmp/gen-check/s.ts web/lib/api/schema.gen.d.ts && echo "generated code is up to date"
check: api-check web-check check-generated
