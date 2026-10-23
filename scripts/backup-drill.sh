#!/usr/bin/env bash
# Backup and restore drill, against the LOCAL development database.
#
#   make backup-drill
#
# Dumps the database, restores the dump into a brand-new empty database, and
# proves the copy is the same: every table has the same number of rows, the
# migration version matches, row-level security and its policies are intact,
# and the application's restricted role can read a tenant's data through them.
# A backup that has never been restored is a hope, not a backup.
set -euo pipefail

cd "$(dirname "$0")/.."
DB=app
COPY=app_restore_drill
psql_in() { docker compose exec -T db psql -U app -v ON_ERROR_STOP=1 -At "$@"; }

echo "1/5 dumping $DB"
docker compose exec -T db pg_dump -U app -Fc --no-owner "$DB" > /tmp/drill.dump
echo "    $(wc -c < /tmp/drill.dump | tr -d ' ') bytes"

echo "2/5 restoring into a new empty database ($COPY)"
psql_in -d postgres -c "DROP DATABASE IF EXISTS $COPY" -c "CREATE DATABASE $COPY"
docker compose exec -T db pg_restore -U app -d "$COPY" --no-owner --exit-on-error < /tmp/drill.dump

echo "3/5 comparing row counts table by table"
tables=$(psql_in -d "$DB" -c "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','river') AND c.relkind='r' ORDER BY n.nspname, c.relname" )
bad=0; n=0
for t in $tables; do
  schema=public; psql_in -d "$DB" -c "SELECT 1 FROM pg_tables WHERE schemaname='river' AND tablename='$t'" | grep -q 1 && schema=river
  a=$(psql_in -d "$DB" -c "SELECT count(*) FROM $schema.$t"); b=$(psql_in -d "$COPY" -c "SELECT count(*) FROM $schema.$t")
  n=$((n+1)); if [ "$a" != "$b" ]; then echo "    MISMATCH $schema.$t: $a vs $b"; bad=1; fi
done
echo "    $n tables compared"

echo "4/5 comparing schema guarantees"
q="SELECT (SELECT max(version_id) FROM goose_db_version), (SELECT count(*) FROM pg_policy), (SELECT count(*) FROM pg_class WHERE relforcerowsecurity), (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal), (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')"
a=$(psql_in -d "$DB" -c "$q"); b=$(psql_in -d "$COPY" -c "$q")
echo "    original: $a  restored: $b   (migration version | policies | forced-RLS tables | triggers | functions)"
[ "$a" = "$b" ] || bad=1

echo "5/5 reading a tenant's data as the application's restricted role through row-level security"
ws=$(psql_in -d "$COPY" -c "SELECT workspace_id FROM request GROUP BY workspace_id ORDER BY count(*) DESC LIMIT 1")
if [ -n "$ws" ]; then
  # one transaction: become the application role, say which workspace, count
  count_as() { psql_in -d "$COPY" -c "BEGIN" -c "SET LOCAL ROLE app_backend" "$@" -c "SELECT count(*) FROM request" -c "COMMIT" | tail -2 | head -1; }
  seen=$(count_as -c "SELECT set_config('app.workspace_id','$ws',true)" >/dev/null; count_as -c "SELECT set_config('app.workspace_id','$ws',true)")
  none=$(count_as)
  total=$(psql_in -d "$COPY" -c "SELECT count(*) FROM request WHERE workspace_id='$ws'")
  other=$(psql_in -d "$COPY" -c "SELECT count(*) FROM request WHERE workspace_id<>'$ws'")
  echo "    with a workspace set: $seen of $total requests (and $other belong to others, hidden); with none set: $none (must be 0)"
  [ "$seen" = "$total" ] && [ "$none" = "0" ] && [ "$total" -gt 0 ] || bad=1
else
  echo "    the database has no requests to read; seed some first"; bad=1
fi

psql_in -d postgres -c "DROP DATABASE $COPY" >/dev/null
rm -f /tmp/drill.dump
if [ "$bad" = 0 ]; then echo "RESTORE DRILL PASSED"; else echo "RESTORE DRILL FAILED"; exit 1; fi
