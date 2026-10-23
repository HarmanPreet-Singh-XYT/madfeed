#!/usr/bin/env bash
# Restore drill from the HOSTED database. Read-only on the hosted side.
#
#   make hosted-restore-drill        (needs DATABASE_ADMIN_URL in .env)
#
# Dumps the application's schemas (public, river) from the hosted Supabase
# database, restores them into a brand-new local database, and compares: row
# counts for every table, migration version, policies, forced-RLS tables.
# It proves a real backup of the real service can be restored somewhere clean.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env >/dev/null 2>&1; set +a
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is not set in .env}"
URL="${DATABASE_ADMIN_URL%%[[:space:]]*}"
COPY=hosted_restore_drill
local_psql() { docker compose exec -T db psql -U app -v ON_ERROR_STOP=1 -At "$@"; }
remote_psql() { docker compose exec -T db psql "$URL" -v ON_ERROR_STOP=1 -At "$@"; }

echo "1/4 dumping the hosted database (public and river schemas)"
docker compose exec -T db pg_dump "$URL" -Fc --no-owner --no-privileges -n public -n river > /tmp/hosted.dump
echo "    $(wc -c < /tmp/hosted.dump | tr -d ' ') bytes"

echo "2/4 restoring into a new empty local database ($COPY)"
local_psql -d postgres -c "DROP DATABASE IF EXISTS $COPY" -c "CREATE DATABASE $COPY" >/dev/null
local_psql -d "$COPY" -c "DROP SCHEMA public CASCADE" >/dev/null   # the dump brings its own
# The hosted roles may not exist locally; the restore only needs the application's own group role.
local_psql -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_backend') THEN CREATE ROLE app_backend NOLOGIN; END IF; END \$\$" >/dev/null
docker compose exec -T db pg_restore -U app -d "$COPY" --no-owner --no-privileges --exit-on-error < /tmp/hosted.dump 2>/tmp/restore.err || { echo "    restore reported problems:"; head -5 /tmp/restore.err; }

echo "3/4 comparing row counts table by table"
bad=0; n=0
for qualified in $(remote_psql -c "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','river') ORDER BY 1"); do
  a=$(remote_psql -c "SELECT count(*) FROM $qualified"); b=$(local_psql -d "$COPY" -c "SELECT count(*) FROM $qualified" 2>/dev/null || echo MISSING)
  n=$((n+1)); [ "$a" = "$b" ] || { echo "    MISMATCH $qualified: hosted $a, restored $b"; bad=1; }
done
echo "    $n tables compared"

echo "4/4 comparing schema guarantees"
q="SELECT (SELECT max(version_id) FROM goose_db_version), (SELECT count(*) FROM pg_policy), (SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relforcerowsecurity AND s.nspname IN ('public','river')), (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE NOT t.tgisinternal AND s.nspname IN ('public','river')), (SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public')"
a=$(remote_psql -c "$q"); b=$(local_psql -d "$COPY" -c "$q")
echo "    hosted: $a  restored: $b   (migration version | policies | forced-RLS tables | triggers | functions)"
[ "$a" = "$b" ] || bad=1

local_psql -d postgres -c "DROP DATABASE $COPY" >/dev/null
rm -f /tmp/hosted.dump /tmp/restore.err
if [ "$bad" = 0 ]; then echo "HOSTED RESTORE DRILL PASSED"; else echo "HOSTED RESTORE DRILL FAILED"; exit 1; fi
