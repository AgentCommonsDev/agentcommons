# Shared by the on-host single-node scripts. Source it from the script's own directory:
# single-node-run.sh ships it next to the script it runs, and apply.sh finds it in the
# released tree. Runs as root on the host; do not execute it. The stack directory, the
# `setting` reader and the Compose steps come from the released tree's self-host library,
# which the generic updater shares (ADR 0059).
set -euo pipefail

. "${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}/scripts/self-host/lib.sh"
state_dir=/root/agentcommons
local_api=http://127.0.0.1:3000
public_url=

# require_public_url: the API accepts credential requests only from its own origin.
require_public_url() {
  public_url=$(setting PUBLIC_URL)
  [ -n "$public_url" ] || {
    echo "PUBLIC_URL is missing from $app/.env" >&2
    exit 1
  }
}
# require_owner_state ORG: the bootstrap's owner credential file must exist.
require_owner_state() {
  [ -s "$state_dir/owner-$1.json" ] || {
    echo "No owner state for $1; run the bootstrap for it first." >&2
    exit 1
  }
}
# cookie_from HEADERS_FILE: joins the response's Set-Cookie values into one Cookie value.
cookie_from() {
  awk 'tolower($1) == "set-cookie:" { sub(/;.*/, "", $2); printf "%s%s", (n++ ? "; " : ""), $2 }' "$1"
}
# owner_sign_in ORG: signs in with the stored owner credential and prints the session
# cookie. On failure the error body (which carries no credential) is shown.
owner_sign_in() {
  local email password headers response status cookie
  email=$(jq -r .email "$state_dir/owner-$1.json")
  password=$(jq -r .password "$state_dir/owner-$1.json")
  headers=$(mktemp)
  response=$(mktemp)
  status=$(curl -sS -o "$response" -D "$headers" -w '%{http_code}' -X POST "$local_api/auth/sign-in/email" \
    -H "Origin: $public_url" -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg email "$email" --arg password "$password" '$ARGS.named')") || status=000
  cookie=$(cookie_from "$headers")
  if [ "$status" != 200 ] || [ -z "$cookie" ]; then
    echo "Owner sign-in for $1 failed with HTTP $status: $(head -c 600 "$response")" >&2
    rm -f "$headers" "$response"
    exit 1
  fi
  rm -f "$headers" "$response"
  printf '%s' "$cookie"
}
# api COOKIE METHOD PATH [JSON]: one API call as the signed-in owner; prints the body,
# then the HTTP status on its own line.
api() {
  local cookie=$1 method=$2 path=$3 body=${4:-}
  curl -sS --max-time 30 -X "$method" "$local_api$path" -H "Origin: $public_url" \
    -H "Cookie: $cookie" -H 'Content-Type: application/json' ${body:+--data "$body"} \
    -w '\n%{http_code}'
}
# sign_out COOKIE: ends the owner session; a failure on the way out is ignored.
sign_out() {
  curl -sS -X POST "$local_api/auth/sign-out" -H "Origin: $public_url" -H "Cookie: $1" --data '{}' -o /dev/null || true
}
# render_env FILE: the stack's .env from its SSM SecureString parameters, which AWS_REGION
# and AGENTCOMMONS_PARAMETER_PATH name. Values are single-quoted so Compose reads them
# literally; the stack refuses quotes and line breaks. COMPOSE_FILE is not included: the
# caller appends the list compose_files derives from the rendered settings.
render_env() {
  : "${AWS_REGION:?Set AWS_REGION}" "${AGENTCOMMONS_PARAMETER_PATH:?Set AGENTCOMMONS_PARAMETER_PATH}"
  aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$AGENTCOMMONS_PARAMETER_PATH" \
    --recursive --with-decryption --output json |
    jq -r '.Parameters[] | (.Name | split("/") | last) as $key | .Value as $value
      | if ($value | test("[\u0027\r\n]")) then error("Parameter \($key) contains a quote or line break")
        else "\($key)=\u0027\($value)\u0027" end' >"$1"
  [ -s "$1" ] || {
    echo "No parameters found under $AGENTCOMMONS_PARAMETER_PATH" >&2
    return 1
  }
}
# running_database_mode: the database the host runs on today, from the durable marker the
# last apply wrote, else the previous .env, else the bundled db volume of an install that
# predates the marker; empty on a fresh host. A release unpacks into a fresh tree, so the
# marker and the volume are what survive it (ADR 0063).
database_mode_file=${AGENTCOMMONS_DATABASE_MODE_FILE:-$state_dir/database.mode}
running_database_mode() {
  local mode=""
  [ ! -s "$database_mode_file" ] || mode=$(tr -d '[:space:]' <"$database_mode_file")
  [ -n "$mode" ] || [ ! -f "$app/.env" ] || mode=$(setting AGENTCOMMONS_DATABASE "$app/.env")
  if [ -z "$mode" ] && [ -f "$app/.env" ]; then mode=bundled; fi
  if [ -z "$mode" ] && docker volume inspect "${COMPOSE_PROJECT_NAME:-agentcommons}_agentcommons-db" >/dev/null 2>&1; then mode=bundled; fi
  printf '%s' "$mode"
}
# record_database_mode ENV_FILE: remembers the mode ENV_FILE runs on for the next release.
record_database_mode() {
  local mode
  mode=$(setting AGENTCOMMONS_DATABASE "$1")
  install -d -m 0700 "$(dirname "$database_mode_file")"
  printf '%s\n' "${mode:-bundled}" >"$database_mode_file"
}
# keep_bundled_database NEW OLD EXTERNAL: a database move is an operator step (ADR 0063).
# When the freshly rendered NEW names an external database while the running OLD still uses
# the bundled container, NEW keeps OLD's database settings so this release stays on the
# bundled db, and the full external render is left in EXTERNAL for migrate-database.sh.
keep_bundled_database() {
  local new=$1 old=$2 external=$3 key value
  cp "$new" "$external"
  for key in AGENTCOMMONS_DATABASE DATABASE_URL DATABASE_MIGRATION_URL DATABASE_TRACE_CONTROL_URL \
    CLICKHOUSE_POSTGRES_HOST CLICKHOUSE_POSTGRES_PORT POSTGRES_PASSWORD; do
    value=""
    [ ! -f "$old" ] || value=$(sed -n "s/^$key=//p" "$old" | tail -n 1)
    if [ -z "$value" ]; then
      # No previous .env survives a release unpack: rebuild the bundled values from the
      # rendered ones, which differ from the container's only in the host and the mode.
      case $key in
      AGENTCOMMONS_DATABASE) value="'bundled'" ;;
      DATABASE_URL | DATABASE_MIGRATION_URL | DATABASE_TRACE_CONTROL_URL)
        value=$(sed -n "s/^$key=//p" "$new" | tail -n 1 | sed -E "s#@[^/@]+/#@db:5432/#; s#[?&]sslmode=[^&']*##; s#[?&]uselibpqcompat=[^&']*##; s#'\?'#'#") ;;
      CLICKHOUSE_POSTGRES_HOST) value="'db'" ;;
      CLICKHOUSE_POSTGRES_PORT) value="'5432'" ;;
      *) continue ;;
      esac
    fi
    grep -v "^$key=" "$new" >"$new.tmp" || true
    printf '%s=%s\n' "$key" "$value" >>"$new.tmp"
    mv "$new.tmp" "$new"
  done
  echo "The stack's parameters name an external database at $(setting CLICKHOUSE_POSTGRES_HOST "$external"); this release keeps the bundled db container. Run single-node/migrate-database.sh to cut over (external settings kept in $external)."
}
# compose_files ENV_FILE: the Compose file list the settings in ENV_FILE select: Caddy
# always, the ClickHouse Cloud file for TRACE_STORE=clickhouse-cloud and, last so its
# resets win, the external-database file for AGENTCOMMONS_DATABASE=external (ADR 0063).
compose_files() {
  # The single-node host always runs the updater timer; the overlay lets Admin -> Status
  # show its last check and result (ADR 0059).
  local files=docker-compose.yml:docker-compose.caddy.yml:docker-compose.updater.yml
  [ "$(setting TRACE_STORE "$1")" != clickhouse-cloud ] || files=$files:docker-compose.clickhouse-cloud.yml
  [ "$(setting AGENTCOMMONS_DATABASE "$1")" != external ] || files=$files:docker-compose.external-database.yml
  printf '%s' "$files"
}
# probe_control_dictionary: one dictGet proves the trace store reaches the PostgreSQL
# control dictionary (the local container through its own client and credentials, Cloud
# over HTTPS). Prints the looked-up value; fails when the lookup fails.
probe_control_dictionary() {
  local query
  query="SELECT dictGet('$(setting CLICKHOUSE_DATABASE).session_scope','purged',('probe',toUUID('00000000-0000-0000-0000-000000000000'))) FORMAT TSV"
  if [ "$(setting TRACE_STORE)" = clickhouse-cloud ]; then
    curl -fsS --max-time 30 -H "X-ClickHouse-User: $(setting CLICKHOUSE_MIGRATION_USER)" \
      -H "X-ClickHouse-Key: $(setting CLICKHOUSE_MIGRATION_PASSWORD)" "$(setting CLICKHOUSE_URL)/" \
      --data-binary "$query"
  else
    compose exec -T clickhouse sh -c 'exec clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "$1"' -- "$query"
  fi
}
