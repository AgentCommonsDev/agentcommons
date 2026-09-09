#!/usr/bin/env bash
# Runs on the host as root (ship it with infra/scripts/single-node-run.sh). Proves
# organization isolation on the live instance: a second organization is created with the
# shipped bootstrap script, its owner signs in, and the API must show it none of the first
# organization's sessions, through the session list, the SQL endpoint and a direct fetch
# of one of those sessions. Exit 0 = isolated, 1 = a leak or an error, 2 = inconclusive
# because the first organization has no sessions yet.
#
#   isolation-check.sh --organization zpghl \
#     --probe-organization isolation-probe --probe-admin isolation-probe@example.com
set -euo pipefail
. "$(dirname "$0")/host-lib.sh"
usage() {
  echo "Usage: $0 --organization SLUG --probe-organization SLUG --probe-admin EMAIL" >&2
  exit 2
}
organization= probe= probe_admin=
while [ $# -gt 0 ]; do
  case $1 in
  --organization) organization=${2:?} && shift 2 ;;
  --probe-organization) probe=${2:?} && shift 2 ;;
  --probe-admin) probe_admin=${2:?} && shift 2 ;;
  *) usage ;;
  esac
done
[ -n "$organization" ] && [ -n "$probe" ] && [ -n "$probe_admin" ] || usage
[ "$organization" != "$probe" ] || usage

bootstrap=${AGENTCOMMONS_BOOTSTRAP:-/opt/agentcommons/bootstrap.sh}
cd "$app"
require_public_url
[ -x "$bootstrap" ] || {
  echo "Run the bootstrap first; $bootstrap is missing." >&2
  exit 1
}
require_owner_state "$organization"
"$bootstrap" --admin "$probe_admin" --organization "$probe" --name "Isolation probe" >/dev/null

count_sessions() { # count_sessions <cookie> -> "<rest count> <sql count>"
  local rest sql
  rest=$(api "$1" GET "/api/v1/sessions?limit=50" | sed '$d' | jq -er '.items | length')
  sql=$(api "$1" POST /api/v1/query '{"sql":"SELECT count() AS n FROM sessions"}' | sed '$d' | jq -er '.rows[0][0]')
  printf '%s %s' "$rest" "$sql"
}

main_cookie=$(owner_sign_in "$organization")
probe_cookie=$(owner_sign_in "$probe")
trap 'sign_out "$main_cookie"; sign_out "$probe_cookie"' EXIT
read -r main_rest main_sql <<<"$(count_sessions "$main_cookie")"
read -r probe_rest probe_sql <<<"$(count_sessions "$probe_cookie")"
echo "$organization sees $main_rest sessions (REST) and $main_sql (SQL); $probe sees $probe_rest (REST) and $probe_sql (SQL)."
status=0
[ "$probe_rest" = 0 ] && [ "$probe_sql" = 0 ] || {
  echo "LEAK: the probe organization can see sessions." >&2
  status=1
}
if [ "$main_rest" -gt 0 ]; then
  first=$(api "$main_cookie" GET "/api/v1/sessions?limit=1" | sed '$d' | jq -er '.items[0].session_id')
  code=$(api "$probe_cookie" GET "/api/v1/sessions/$first" | tail -n 1)
  echo "Direct fetch of a $organization session as $probe: HTTP $code"
  case $code in 403 | 404) ;; *)
    echo "LEAK: the probe organization could fetch a foreign session." >&2
    status=1
    ;;
  esac
else
  echo "Inconclusive: $organization has no sessions yet; rerun after the first upload."
  [ $status -eq 0 ] && status=2
fi
[ $status -eq 0 ] && echo "Isolation holds: $probe sees none of $organization's sessions."
exit $status
