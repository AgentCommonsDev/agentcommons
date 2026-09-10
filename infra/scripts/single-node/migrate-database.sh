#!/usr/bin/env bash
# Runs on the host as root (ship it with infra/scripts/single-node-run.sh). Moves the
# control database from the bundled db container to the external PostgreSQL the stack's
# parameters now name (an Aurora cluster after `pulumi up` with database.kind
# aurora-serverless-v2; ADR 0063), or points the stack back at the container.
#
#   migrate-database.sh [--organization SLUG]   # cut over; SLUG adds a session list as the owner
#   migrate-database.sh --rollback              # .env back to the bundled db and restart
#
# Cutover: renders the stack's current parameters into .env.external and requires them to
# say AGENTCOMMONS_DATABASE=external while the running .env says bundled; stops the API
# (downtime starts); copies roles and data with scripts/self-host/migrate-database.sh, whose
# dump stays under /var/lib/agentcommons/database-migration-<time>/; keeps the old .env as
# .env.bundled and installs the new one; starts the stack, whose migration re-points the
# ClickHouse control dictionaries and tables at the new host; then checks /ready, one
# dictionary lookup and, with --organization, a session list. If the stack does not come
# up, .env.bundled is restored and the bundled stack restarted. Expected downtime: a few
# minutes. Rollback keeps the db volume the bundled service never lost; the parameters in
# SSM still name the external database, so set database.kind back to bundled and run
# `pulumi up` before the next release re-renders .env.
set -euo pipefail
. "$(dirname "$0")/host-lib.sh"
usage() {
  echo "Usage: $0 [--organization SLUG] | --rollback" >&2
  exit 2
}
mode=cutover organization=
while [ $# -gt 0 ]; do
  case $1 in
  --rollback) mode=rollback && shift ;;
  --organization) organization=${2:?} && shift 2 ;;
  *) usage ;;
  esac
done
enter_stack
logs=/var/log/agentcommons
install -d -m 0750 "$logs"
log="$logs/database-$mode-$(date -u +%Y%m%dT%H%M%SZ).log"
lock_stack

# start_stack LABEL: starts the stack on the current .env and fails loudly with the log tail.
start_stack() {
  echo "Starting the stack on the $1 database (log: $log)"
  if ! stack_up start "$log"; then
    tail -n 80 "$log" >&2
    return 1
  fi
}
# check_reads: a dictionary lookup through the trace store and, with --organization, a
# session list as the owner prove both stores read the control database.
check_reads() {
  local lookup cookie response status
  lookup=$(probe_control_dictionary) || {
    echo "ClickHouse could not read the PostgreSQL control dictionary." >&2
    return 1
  }
  echo "ClickHouse reads the control dictionary (probe returned $lookup)"
  [ -n "$organization" ] || return 0
  require_public_url
  require_owner_state "$organization"
  cookie=$(owner_sign_in "$organization")
  response=$(api "$cookie" GET "/api/v1/sessions?limit=1")
  sign_out "$cookie"
  status=$(tail -n 1 <<<"$response")
  [ "$status" = 200 ] || {
    echo "The session list answered HTTP $status: $(sed '$d' <<<"$response" | head -c 400)" >&2
    return 1
  }
  echo "The session list answers for $organization ($(sed '$d' <<<"$response" | jq -r '.items | length') item shown)"
}

if [ "$mode" = rollback ]; then
  [ -s .env.bundled ] || {
    echo "No $app/.env.bundled to restore; the cutover keeps the previous .env there." >&2
    exit 1
  }
  [ "$(setting AGENTCOMMONS_DATABASE .env.bundled)" = bundled ] || {
    echo "$app/.env.bundled does not describe the bundled database." >&2
    exit 1
  }
  echo "Stopping the API (downtime starts)"
  compose stop api >>"$log" 2>&1
  mv .env .env.external
  mv .env.bundled .env
  record_database_mode .env
  start_stack bundled
  check_reads
  echo "Rolled back to the bundled db container (its volume was kept). Set database.kind to bundled and run pulumi up, or the next release re-renders the external .env (kept as $app/.env.external)."
  exit 0
fi

[ "$(setting AGENTCOMMONS_DATABASE)" = bundled ] || {
  echo "The stack already runs on an external database ($(setting CLICKHOUSE_POSTGRES_HOST))." >&2
  exit 1
}
umask 077
render_env .env.external
printf "COMPOSE_FILE='%s'\n" "$(compose_files .env.external)" >>.env.external
[ "$(setting AGENTCOMMONS_DATABASE .env.external)" = external ] || {
  rm -f .env.external
  echo "The stack's parameters still describe the bundled database; run pulumi up with database.kind aurora-serverless-v2 first." >&2
  exit 1
}
source_url=$(setting DATABASE_MIGRATION_URL)
target_url=$(setting DATABASE_MIGRATION_URL .env.external)
work="$state_root/database-migration-$(date -u +%Y%m%dT%H%M%SZ)"
network=$(compose config --format json | jq -er '.networks.default.name')
echo "Moving the control database to $(setting CLICKHOUSE_POSTGRES_HOST .env.external)"
echo "Stopping the API (downtime starts)"
compose stop api >>"$log" 2>&1
AGENTCOMMONS_DOCKER_NETWORK=$network "$app/scripts/self-host/migrate-database.sh" copy \
  --source "$source_url" --target "$target_url" --work "$work"
compose stop db >>"$log" 2>&1
cp .env .env.bundled
mv .env.external .env
if ! start_stack external; then
  echo "The stack did not come up on the external database; restoring the bundled .env." >&2
  mv .env .env.external.failed
  mv .env.bundled .env
  record_database_mode .env
  start_stack bundled || true
  exit 1
fi
check_reads
record_database_mode .env
echo "The control database now runs at $(setting CLICKHOUSE_POSTGRES_HOST); dump kept in $work, previous .env in $app/.env.bundled (rollback: $0 --rollback)."
