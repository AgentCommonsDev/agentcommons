# Shared by the on-host single-node scripts. Source it from the script's own directory:
# single-node-run.sh ships it next to the script it runs, and apply.sh finds it in the
# released tree. Runs as root on the host; do not execute it.
set -euo pipefail

app=${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}
state_dir=/root/agentcommons
local_api=http://127.0.0.1:3000
public_url=

# setting KEY: one value from the rendered .env (apply.sh single-quotes every value).
setting() {
  sed -n "s/^$1='\(.*\)'\$/\1/p" "$app/.env"
}
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
