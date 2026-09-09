#!/usr/bin/env bash
# Runs on the host as root (ship it with infra/scripts/single-node-run.sh). Adds people to
# an organization with one role through the owner's session, the same call the People page
# makes, so an operator can seat an administrator before that person has signed in.
#
#   add-members.sh --organization zpghl --role admin someone@example.com [more emails]
set -euo pipefail
. "$(dirname "$0")/host-lib.sh"
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

cd "$app"
require_public_url
require_owner_state "$organization"
cookie=$(owner_sign_in "$organization")
body=$(jq -cn --arg role "$role" '$ARGS.positional | {emails: ., role: $role}' --args "${emails[@]}")
response=$(api "$cookie" POST /api/v1/admin/users "$body")
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
  status=$(api "$cookie" PATCH "/api/v1/admin/users/$(jq -r .id <<<"$member")/role" \
    "$(jq -cn --arg role "$role" --arg reason "add-members.sh" '$ARGS.named')" | tail -n 1)
  [ "$status" = 200 ] || {
    echo "Setting $existing to $role returned HTTP $status" >&2
    exit 1
  }
  echo "$existing: role set to $role"
done
sign_out "$cookie"
