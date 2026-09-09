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

app=${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}
state_dir=/root/agentcommons
bootstrap=${AGENTCOMMONS_BOOTSTRAP:-/opt/agentcommons/bootstrap.sh}
local_api=http://127.0.0.1:3000
cd "$app"
public_url=$(sed -n "s/^PUBLIC_URL='\(.*\)'$/\1/p" .env)
[ -n "$public_url" ] || {
  echo "PUBLIC_URL is missing from $app/.env" >&2
  exit 1
}
[ -x "$bootstrap" ] || {
  echo "Run the bootstrap first; $bootstrap is missing." >&2
  exit 1
}
[ -s "$state_dir/owner-$organization.json" ] || {
  echo "No owner state for $organization; run the bootstrap for it first." >&2
  exit 1
}
"$bootstrap" --admin "$probe_admin" --organization "$probe" --name "Isolation probe" >/dev/null

api() { # api <cookie> <method> <path> [json body]
  local cookie=$1 method=$2 path=$3 body=${4:-}
  curl -sS --max-time 30 -X "$method" "$local_api$path" -H "Origin: $public_url" \
    -H "Cookie: $cookie" -H 'Content-Type: application/json' ${body:+--data "$body"} \
    -w '\n%{http_code}'
}
sign_in() { # sign_in <organization> -> cookie
  local email password headers cookie
  email=$(jq -r .email "$state_dir/owner-$1.json")
  password=$(jq -r .password "$state_dir/owner-$1.json")
  headers=$(mktemp)
  curl -fsS -X POST "$local_api/auth/sign-in/email" -H "Origin: $public_url" \
    -H 'Content-Type: application/json' -D "$headers" -o /dev/null \
    --data "$(jq -cn --arg email "$email" --arg password "$password" '$ARGS.named')"
  cookie=$(awk 'tolower($1) == "set-cookie:" { sub(/;.*/, "", $2); printf "%s%s", (n++ ? "; " : ""), $2 }' "$headers")
  rm -f "$headers"
  [ -n "$cookie" ] || {
    echo "Sign-in for $1 returned no session." >&2
    exit 1
  }
  printf '%s' "$cookie"
}
count_sessions() { # count_sessions <cookie> -> "<rest count> <sql count>"
  local rest sql
  rest=$(api "$1" GET "/api/v1/sessions?limit=50" | sed '$d' | jq -er '.items | length')
  sql=$(api "$1" POST /api/v1/query '{"sql":"SELECT count() AS n FROM sessions"}' | sed '$d' | jq -er '.rows[0][0]')
  printf '%s %s' "$rest" "$sql"
}

main_cookie=$(sign_in "$organization")
probe_cookie=$(sign_in "$probe")
trap 'for c in "$main_cookie" "$probe_cookie"; do curl -sS -X POST "$local_api/auth/sign-out" -H "Origin: $public_url" -H "Cookie: $c" --data "{}" -o /dev/null || true; done' EXIT
read -r main_rest main_sql <<<"$(count_sessions "$main_cookie")"
read -r probe_rest probe_sql <<<"$(count_sessions "$probe_cookie")"
echo "$organization sees $main_rest sessions (REST) and $main_sql (SQL); $probe sees $probe_rest (REST) and $probe_sql (SQL)."
status=0
[ "$probe_rest" = 0 ] && [ "$probe_sql" = 0 ] || {
  echo "LEAK: the probe organization can see sessions." >&2
  status=1
}
if [ "$main_rest" -gt 0 ]; then
  first=$(api "$main_cookie" GET "/api/v1/sessions?limit=1" | sed '$d' | jq -er '.items[0].id')
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
