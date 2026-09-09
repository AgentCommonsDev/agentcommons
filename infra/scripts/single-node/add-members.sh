#!/usr/bin/env bash
# Runs on the host as root (ship it with infra/scripts/single-node-run.sh). Adds people to
# an organization with one role through the owner's session, the same call the People page
# makes, so an operator can seat an administrator before that person has signed in.
#
#   add-members.sh --organization zpghl --role admin someone@example.com [more emails]
set -euo pipefail
usage() {
  echo "Usage: $0 --organization SLUG --role owner|admin|member EMAIL [EMAIL...]" >&2
  exit 2
}
organization= role=
emails=()
while [ $# -gt 0 ]; do
  case $1 in
  --organization) organization=${2:?} && shift 2 ;;
  --role) role=${2:?} && shift 2 ;;
  -*) usage ;;
  *) emails+=("$1") && shift ;;
  esac
done
[ -n "$organization" ] && [ ${#emails[@]} -gt 0 ] || usage
case $role in owner | admin | member) ;; *) usage ;; esac

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
body=$(jq -cn --arg role "$role" '$ARGS.positional | {emails: ., role: $role}' --args "${emails[@]}")
response=$(curl -sS --max-time 30 -X POST "$local_api/api/v1/admin/users" -H "Origin: $public_url" \
  -H "Cookie: $cookie" -H 'Content-Type: application/json' --data "$body" -w '\n%{http_code}')
status=$(tail -n 1 <<<"$response")
[ "$status" = 200 ] || {
  echo "Adding members returned HTTP $status: $(sed '$d' <<<"$response")" >&2
  exit 1
}
# One line per address: added, existing or error. An existing member keeps their account and
# receives the requested role through the same role call the People page makes.
results=$(sed '$d' <<<"$response")
jq -r '.results[] | "\(.email): \(.status)\(if .error then " (" + .error + ")" else "" end)"' <<<"$results"
for existing in $(jq -r '.results[] | select(.status == "existing") | .email' <<<"$results"); do
  member=$(curl -sS --max-time 30 -G "$local_api/api/v1/admin/users" -H "Origin: $public_url" -H "Cookie: $cookie" \
    --data-urlencode "filters[email]=$existing" --data-urlencode "limit=1" | jq -c '.items[0] // empty')
  [ -n "$member" ] || {
    echo "$existing is not listed as a member." >&2
    exit 1
  }
  if [ "$(jq -r .role <<<"$member")" = "$role" ]; then
    echo "$existing already has role $role"
    continue
  fi
  status=$(curl -sS --max-time 30 -X PATCH "$local_api/api/v1/admin/users/$(jq -r .id <<<"$member")/role" \
    -H "Origin: $public_url" -H "Cookie: $cookie" -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg role "$role" --arg reason "add-members.sh" '$ARGS.named')" -o /dev/null -w '%{http_code}')
  [ "$status" = 200 ] || {
    echo "Setting $existing to $role returned HTTP $status" >&2
    exit 1
  }
  echo "$existing: role set to $role"
done
curl -sS -X POST "$local_api/auth/sign-out" -H "Origin: $public_url" -H "Cookie: $cookie" --data '{}' -o /dev/null || true
