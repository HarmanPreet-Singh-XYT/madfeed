.PHONY: dev-db api web check api-check web-check generate check-generated
dev-db:        ## start local Postgres (pgvector)
	docker compose up -d db
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
