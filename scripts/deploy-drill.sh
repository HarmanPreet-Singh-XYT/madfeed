#!/usr/bin/env bash
# Deploy and rollback drill, local. Run the built images the way a real
# environment would (production settings, non-root, read-only filesystem, no
# extra privileges), check health, ship a deliberately broken "new version",
# and confirm the old one keeps serving, the broken one is caught by its
# readiness check, an alert is raised, and containers stop cleanly.
set -uo pipefail
cd "$(dirname "$0")/.."
NET=$(docker compose ps -q db >/dev/null 2>&1; docker inspect "$(docker compose ps -q db)" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
[ -n "$NET" ] || { echo "start the database first: make dev-db"; exit 1; }
DBURL='postgres://app_api:dev-api-password@db:5432/app?sslmode=disable'
ADMIN='postgres://app:dev-only-password@db:5432/app?sslmode=disable'
SECRET=$(openssl rand -hex 24)
fail=0
ok()   { echo "  ok   $*"; }
bad()  { echo "  FAIL $*"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
cleanup() { docker rm -f drill-api drill-worker drill-web drill-api-new >/dev/null 2>&1; }
trap cleanup EXIT; cleanup

hardened=(--read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp)
env_common=(-e APP_ENV=production -e ALLOWED_ORIGINS=https://app.example.test -e PUBLIC_BASE_URL=https://app.example.test
  -e UNSUBSCRIBE_SECRET="$SECRET" -e SUPABASE_JWKS_URL=https://auth.example.test/jwks.json -e JWT_ISSUER=https://auth.example.test/auth/v1
  -e AI_DAILY_BUDGET_USD=5)

echo "1/6 migrating with the image's own migration tool"
out=$(docker run --rm --network "$NET" -e DATABASE_ADMIN_URL="$ADMIN" --entrypoint /app/migrate feedback-api:local 2>&1 | tail -1)
check "database is up to date ($out)" '[[ "$out" == *"up to date"* ]]'

echo "2/6 starting the API (production settings, hardened)"
docker run -d --name drill-api --network "$NET" --network-alias api "${hardened[@]}" "${env_common[@]}" -e APP_MODE=api -e DATABASE_URL="$DBURL" -p 127.0.0.1:18180:8080 feedback-api:local >/dev/null
for i in $(seq 1 30); do curl -sf -m 2 http://127.0.0.1:18180/healthz >/dev/null && break; sleep 1; done
check "alive: /healthz" 'curl -sf -m 3 http://127.0.0.1:18180/healthz | grep -q ok'
check "ready: /readyz (database reachable)" 'curl -sf -m 3 http://127.0.0.1:18180/readyz >/dev/null'
check "runs as a non-root user" '[ "$(docker inspect drill-api --format "{{.Config.User}}")" = "nonroot:nonroot" ]'
check "refuses an unsigned request" '[ "$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://127.0.0.1:18180/v1/workspaces)" = 401 ]'
check "sends security headers" 'curl -sI -m 3 http://127.0.0.1:18180/healthz | grep -qi "^strict-transport-security"'

echo "3/6 starting the worker and the web app"
# Production insists the worker has an AI configuration (that refusal is the point); give it the development one.
docker run -d --name drill-worker --network "$NET" "${hardened[@]}" "${env_common[@]}" -v "$PWD/api/config/ai.dev.json:/config/ai.json:ro" -e AI_CONFIG=/config/ai.json -e OPENAI_API_KEY=drill -e OPENAI_BASE_URL=http://127.0.0.1:1/v1 -e APP_MODE=worker -e DATABASE_URL="$DBURL" -e ADDR=:8081 -p 127.0.0.1:18181:8081 feedback-api:local >/dev/null
docker run -d --name drill-web --network "$NET" --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp --tmpfs /app/.next/cache -e API_URL=http://api:8080 -e SUPABASE_URL=https://auth.example.test -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_drill -p 127.0.0.1:13100:3000 feedback-web:local >/dev/null
for i in $(seq 1 40); do curl -sf -m 2 http://127.0.0.1:18181/healthz >/dev/null && curl -sf -m 2 http://127.0.0.1:13100/login >/dev/null && break; sleep 1; done
check "worker is alive" 'curl -sf -m 3 http://127.0.0.1:18181/healthz | grep -q worker'
check "web app serves the sign-in page" 'curl -sf -m 5 http://127.0.0.1:13100/login | grep -q "Sign in"'
check "web app sends a content security policy" 'curl -sI -m 5 http://127.0.0.1:13100/login | grep -qi "^content-security-policy"'
check "web app shows the real sign-in form, not the development one" 'curl -sf -m 5 http://127.0.0.1:13100/login | grep -q "Email address" && ! curl -sf -m 5 http://127.0.0.1:13100/login | grep -q "Your name"'

echo "4/6 shipping a deliberately broken new version (wrong database password)"
docker run -d --name drill-api-new --network "$NET" "${hardened[@]}" "${env_common[@]}" -e APP_MODE=api -e DATABASE_URL='postgres://app_api:wrong@db:5432/app?sslmode=disable' -p 127.0.0.1:18182:8080 feedback-api:local >/dev/null
sleep 4
check "the broken version is alive (so it would not be restarted in a loop)" 'curl -sf -m 3 http://127.0.0.1:18182/healthz >/dev/null'
check "...but its readiness check says NOT ready, so no traffic would be sent to it" '[ "$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://127.0.0.1:18182/readyz)" = 503 ]'
check "the readiness answer does not reveal internals" '! curl -s -m 3 http://127.0.0.1:18182/readyz | grep -qi "password\|wrong\|pq:\|SQLSTATE"'
echo "  ...waiting for the dependency watcher (two failed checks, 30 s apart)"
for i in $(seq 1 80); do docker logs drill-api-new 2>&1 | grep -q '"alert":"dependency_down"' && break; sleep 1; done
check "an alert named dependency_down was raised and logged" 'docker logs drill-api-new 2>&1 | grep -q "\"alert\":\"dependency_down\""'
check "the alert does not contain the password" '! docker logs drill-api-new 2>&1 | grep -q "wrong"'

echo "5/6 rolling back: remove the broken version; the old one never stopped serving"
start=$(date +%s)
docker rm -f drill-api-new >/dev/null
check "old version still ready after the rollback" 'curl -sf -m 3 http://127.0.0.1:18180/readyz >/dev/null'
echo "  rollback took $(( $(date +%s) - start )) s"

echo "6/6 stopping cleanly"
t0=$(date +%s); docker stop drill-api >/dev/null; code=$(docker inspect drill-api --format '{{.State.ExitCode}}'); t1=$(date +%s)
check "the API exited with code 0 within 10 s of SIGTERM (took $((t1-t0)) s, code $code)" '[ "$code" = 0 ] && [ $((t1-t0)) -le 10 ]'
t0=$(date +%s); docker stop drill-worker >/dev/null; code=$(docker inspect drill-worker --format '{{.State.ExitCode}}'); t1=$(date +%s)
check "the worker exited with code 0 within 10 s (took $((t1-t0)) s, code $code)" '[ "$code" = 0 ] && [ $((t1-t0)) -le 10 ]'

[ "$fail" = 0 ] && echo "DEPLOY DRILL PASSED" || { echo "DEPLOY DRILL FAILED"; exit 1; }
