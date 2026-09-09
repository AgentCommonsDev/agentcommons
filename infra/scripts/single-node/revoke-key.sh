#!/usr/bin/env bash
# Runs on the host as root (ship it with infra/scripts/single-node-run.sh). Revokes an
# organization API key that the bootstrap minted, through the owner's session, and deletes
# the key file, so a temporary key such as an end-to-end probe leaves no copy on the host.
#
#   revoke-key.sh --organization zpghl --key lead-e2e --reason "end-to-end check complete"
set -euo pipefail
usage() {
  echo "Usage: $0 --organization SLUG --key NAME --reason TEXT" >&2
  exit 2
}
organization= key= reason=
while [ $# -gt 0 ]; do
  case $1 in
  --organization) organization=${2:?} && shift 2 ;;
  --key) key=${2:?} && shift 2 ;;
  --reason) reason=${2:?} && shift 2 ;;
  *) usage ;;
  esac
done
[ -n "$organization" ] && [ -n "$key" ] && [ -n "$reason" ] || usage

app=${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}
state_dir=/root/agentcommons
local_api=http://127.0.0.1:3000
cd "$app"
public_url=$(sed -n "s/^PUBLIC_URL='\(.*\)'$/\1/p" .env)
[ -n "$public_url" ] || {
  echo "PUBLIC_URL is missing from $app/.env" >&2
  exit 1
}
[ -s "$state_dir/owner-$organization.json" ] || {
  echo "No owner state for $organization; run the bootstrap for it first." >&2
  exit 1
}
api() { # api <cookie> <method> <path> [json body] -> body then status line
  local cookie=$1 method=$2 path=$3 body=${4:-}
  curl -sS --max-time 30 -X "$method" "$local_api$path" -H "Origin: $public_url" \
    -H "Cookie: $cookie" -H 'Content-Type: application/json' ${body:+--data "$body"} \
    -w '\n%{http_code}'
}
email=$(jq -r .email "$state_dir/owner-$organization.json")
password=$(jq -r .password "$state_dir/owner-$organization.json")
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
curl -fsS -X POST "$local_api/auth/sign-in/email" -H "Origin: $public_url" \
  -H 'Content-Type: application/json' -D "$headers" -o /dev/null \
  --data "$(jq -cn --arg email "$email" --arg password "$password" '$ARGS.named')"
cookie=$(awk 'tolower($1) == "set-cookie:" { sub(/;.*/, "", $2); printf "%s%s", (n++ ? "; " : ""), $2 }' "$headers")
[ -n "$cookie" ] || {
  echo "Owner sign-in returned no session." >&2
  exit 1
}
ids=$(api "$cookie" GET "/api/v1/me/keys?limit=50" | sed '$d' | jq -r --arg key "$key" '.items[] | select(.name == $key and .enabled) | .id')
if [ -z "$ids" ]; then
  echo "No enabled API key named $key; nothing to revoke."
else
  for id in $ids; do
    status=$(api "$cookie" DELETE "/api/v1/me/keys/$id" "$(jq -cn --arg reason "$reason" '$ARGS.named')" | tail -n 1)
    [ "$status" = 200 ] || {
      echo "Revoking key $key ($id) returned HTTP $status" >&2
      exit 1
    }
    echo "Revoked API key $key ($id): $reason"
  done
fi
curl -sS -X POST "$local_api/auth/sign-out" -H "Origin: $public_url" -H "Cookie: $cookie" --data '{}' -o /dev/null || true
if [ -e "$state_dir/$key-key" ]; then
  rm -f "$state_dir/$key-key"
  echo "Deleted $state_dir/$key-key"
fi
