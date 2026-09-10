#!/usr/bin/env bash
# Copies the AgentCommons control database (schemas public, pgboss and trace_control, the
# roles ac_app and ac_trace_control with their settings; `pnpm db:migrate` sets the role
# passwords afterwards) from one PostgreSQL to another and compares the two, for moving a
# self-hosted stack's PostgreSQL out of the
# Compose stack onto a managed server such as Amazon Aurora (ADR 0063). pg_dump, pg_restore
# and psql run from the postgres:16 image, so nothing is installed on the host; the tool
# containers join the stack's Compose network, where the bundled db service and the managed
# endpoint are both reachable (AGENTCOMMONS_DOCKER_NETWORK overrides the network).
#
#   migrate-database.sh copy   --source URL --target URL --work DIR   # dump, restore, compare
#   migrate-database.sh verify --source URL --target URL              # compare row counts only
#
# URLs are the migration (master) role's libpq URLs on each side; a uselibpqcompat parameter
# from the stack's .env is dropped for the libpq tools. The target must be an empty database
# owned by the connecting role (on Aurora, the master user) with no ac_app or
# ac_trace_control role yet; the restore runs in one transaction, so a failure leaves it
# empty for another attempt. The dump stays in DIR (mode 700) as the rollback copy. Stop the
# API before copying so the comparison is exact.
set -euo pipefail

command_name=${1:-}
[ -n "$command_name" ] && shift || true
source_url= target_url= work=
image=${AGENTCOMMONS_POSTGRES_IMAGE:-postgres:16}
network=${AGENTCOMMONS_DOCKER_NETWORK:-${COMPOSE_PROJECT_NAME:-agentcommons}_default}
usage() {
  echo "Usage: $0 copy --source URL --target URL --work DIR | verify --source URL --target URL" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case $1 in
  --source) source_url=${2:?} && shift 2 ;;
  --target) target_url=${2:?} && shift 2 ;;
  --work) work=${2:?} && shift 2 ;;
  *) usage ;;
  esac
done
case $command_name in
copy) [ -n "$source_url" ] && [ -n "$target_url" ] && [ -n "$work" ] || usage ;;
verify) [ -n "$source_url" ] && [ -n "$target_url" ] || usage ;;
*) usage ;;
esac
[ -n "$work" ] || work=$(mktemp -d "${TMPDIR:-/tmp}/agentcommons-database-verify.XXXXXX")

# libpq_url URL: the URL without the node-postgres-only uselibpqcompat parameter.
libpq_url() {
  printf '%s' "$1" | sed -E 's/([?&])uselibpqcompat=[^&]*(&|$)/\1/; s/[?&]$//'
}
# url_user URL: the role the URL connects as (the restore's --role).
url_user() {
  printf '%s' "$1" | sed -E 's#^[a-z]+://([^:/@]+).*#\1#'
}
install -d -m 0700 "$work"
umask 077
# Credentials reach the tool containers through an env file, never through argv.
{
  printf 'SOURCE_URL=%s\n' "$(libpq_url "$source_url")"
  printf 'TARGET_URL=%s\n' "$(libpq_url "$target_url")"
  printf 'TARGET_ROLE=%s\n' "$(url_user "$target_url")"
  printf 'PGCONNECT_TIMEOUT=15\n'
} >"$work/urls.env"
# pg_tool COMMAND...: one of the PostgreSQL client tools in a throwaway container.
pg_tool() {
  docker run --rm -i --network "$network" --env-file "$work/urls.env" -v "$work:/work" "$image" "$@"
}
# sql_on SIDE: runs the SQL on stdin against SOURCE or TARGET, one value per line.
sql_on() {
  pg_tool sh -c "exec psql \"\$${1}_URL\" -v ON_ERROR_STOP=1 -qAt -f -"
}
schemas="('public','pgboss','trace_control')"
# counts SIDE: "schema.table count" per base table, so both sides can be diffed.
counts() {
  sql_on "$1" <<SQL
SELECT table_schema || '.' || table_name || ' ' ||
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema IN $schemas AND table_type = 'BASE TABLE'
ORDER BY 1;
SQL
}
compare() {
  counts SOURCE >"$work/counts.source"
  counts TARGET >"$work/counts.target"
  [ -s "$work/counts.source" ] || {
    echo "The source has no tables in public, pgboss or trace_control." >&2
    return 1
  }
  if diff -u "$work/counts.source" "$work/counts.target" >"$work/counts.diff"; then
    echo "Row counts match for $(wc -l <"$work/counts.source") tables ($(awk '{ n += $2 } END { print n + 0 }' "$work/counts.source") rows)."
  else
    cat "$work/counts.diff" >&2
    echo "Row counts differ between source and target." >&2
    return 1
  fi
}

if [ "$command_name" = verify ]; then
  compare
  exit
fi
echo "Checking the target is empty"
tables=$(printf 'SELECT count(*) FROM pg_tables WHERE schemaname IN %s;\n' "$schemas" | sql_on TARGET)
roles=$(printf "SELECT count(*) FROM pg_roles WHERE rolname IN ('ac_app','ac_trace_control');\n" | sql_on TARGET)
[ "$tables" = 0 ] && [ "$roles" = 0 ] || {
  echo "The target already holds $tables tables in public/pgboss/trace_control and $roles application roles; drop them (DROP SCHEMA ... CASCADE, DROP ROLE ...) or point at an empty database." >&2
  exit 1
}
echo "Copying the application roles"
# The application roles with their attributes and settings, rebuilt from pg_roles, which
# any role may read (pg_dumpall needs a superuser for pg_authid and names NOSUPERUSER,
# which only a superuser may alter). Passwords are not copied: `pnpm db:migrate`, the next
# runbook step, sets them from the URLs before the API starts.
sql_on SOURCE >"$work/roles.sql" <<'SQL'
SELECT statement FROM (
  SELECT 1 AS phase, rolname, format('CREATE ROLE %I %s %s %s %s;', rolname,
    CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END,
    CASE WHEN rolinherit THEN 'INHERIT' ELSE 'NOINHERIT' END,
    CASE WHEN rolcreaterole THEN 'CREATEROLE' ELSE 'NOCREATEROLE' END,
    CASE WHEN rolcreatedb THEN 'CREATEDB' ELSE 'NOCREATEDB' END) AS statement
  FROM pg_roles WHERE rolname IN ('ac_app', 'ac_trace_control')
  UNION ALL
  SELECT 2, r.rolname, format('ALTER ROLE %I SET %I = %L;', r.rolname,
    split_part(setting, '=', 1), substr(setting, strpos(setting, '=') + 1))
  FROM pg_roles r
  JOIN pg_db_role_setting s ON s.setrole = r.oid AND s.setdatabase = 0
  CROSS JOIN unnest(s.setconfig) AS setting
  WHERE r.rolname IN ('ac_app', 'ac_trace_control')
) statements ORDER BY phase, rolname, statement;
SQL
grep -q '^CREATE ROLE ac_app ' "$work/roles.sql" && grep -q '^CREATE ROLE ac_trace_control ' "$work/roles.sql" || {
  echo "The source has no ac_app and ac_trace_control roles; is it a migrated AgentCommons database?" >&2
  exit 1
}
sql_on TARGET <"$work/roles.sql"
echo "Dumping the source database into $work/control.dump"
pg_tool sh -c 'exec pg_dump -d "$SOURCE_URL" -Fc --no-owner -f /work/control.dump'
echo "Restoring into the target as $(url_user "$target_url") in one transaction"
pg_tool sh -c 'exec pg_restore -d "$TARGET_URL" --no-owner --role="$TARGET_ROLE" --single-transaction --exit-on-error /work/control.dump'
printf 'ANALYZE;\n' | sql_on TARGET
compare
echo "Copy complete; the dump stays in $work until you remove it."
