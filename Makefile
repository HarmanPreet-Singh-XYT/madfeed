.PHONY: images deploy-drill hosted-restore-drill security backup-drill eval eval-gate dev-db migrate dev-role devauth api web check api-check web-check generate check-generated
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
	cd api && gofmt -l . | (! grep .) && go vet ./... && go test -p 4 -race ./... && (command -v govulncheck >/dev/null && govulncheck ./... || echo "govulncheck not installed: go install golang.org/x/vuln/cmd/govulncheck@latest")
web-check:     ## everything CI runs for the web client (browser tests are separate: make e2e)
	cd web && npm run lint && npm run typecheck && npm test && npm audit --omit=dev --audit-level=high
generate:      ## regenerate Go stubs and the TypeScript client from api/openapi.yaml
	cd api && go generate ./... && cd ../web && npm run generate:api
check-generated: ## fail if generated code is stale relative to the contract
	@mkdir -p /tmp/gen-check && cp api/internal/api/api.gen.go /tmp/gen-check/a.go && cp web/lib/api/schema.gen.d.ts /tmp/gen-check/s.ts
	@$(MAKE) -s generate >/dev/null
	@diff -q /tmp/gen-check/a.go api/internal/api/api.gen.go && diff -q /tmp/gen-check/s.ts web/lib/api/schema.gen.d.ts && echo "generated code is up to date"
e2e:           ## browser tests against the real stack (needs Docker; builds the web app)
	$(MAKE) dev-db migrate dev-role
	cd web && npx playwright test
check: api-check web-check check-generated

eval: ## measure the AI features with a real model against api/eval/thresholds.json (needs AI_CONFIG, EVAL_ADMIN_URL, EVAL_APP_URL; costs a few cents)
	cd api && go run ./cmd/eval

eval-gate: ## prove the eval protects something: deliberately worse prompts must FAIL (exit 1)
	cd api && go build -o /tmp/eval-bin ./cmd/eval && (/tmp/eval-bin -degrade; test $$? -eq 1)

backup-drill: ## dump the local database, restore it into a clean one and prove the copy is equivalent
	./scripts/backup-drill.sh

# G115 (int to int32 conversions for database columns) is excluded: every such value is bounded
# by earlier validation (text 1 MB, page sizes 100, contract-checked); see docs/gates/gate-5.md.
security: ## static security analysis of the Go code, plus dependency audits
	cd api && go run github.com/securego/gosec/v2/cmd/gosec@latest -quiet -exclude-generated -exclude=G115 -exclude-dir=cmd/devauth -exclude-dir=cmd/devmail -exclude-dir=cmd/devmodel -exclude-dir=internal/devfakes -exclude-dir=cmd/devslack -exclude-dir=cmd/devgithub -exclude-dir=cmd/devlinear -exclude-dir=cmd/devjira -exclude-dir=cmd/devhubspot -exclude-dir=cmd/devclickup -exclude-dir=cmd/devasana -exclude-dir=cmd/devazure -exclude-dir=cmd/devsalesforce -exclude-dir=cmd/devstripe ./...
	cd api && govulncheck ./...
	cd web && npm audit --audit-level=high

hosted-restore-drill: ## dump the hosted database (read-only) and restore it into a clean local one
	./scripts/hosted-restore-drill.sh

images: ## build the API/worker and web container images
	docker build -t feedback-api:local api
	docker build -t feedback-web:local web

deploy-drill: images ## run the images the way production would, break one on purpose, roll back
	./scripts/deploy-drill.sh
