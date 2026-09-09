#!/usr/bin/env bash
# Runs on the host as root (ship it with infra/scripts/single-node-run.sh). Revokes an
# organization API key that the bootstrap minted, through the owner's session, and deletes
# the key file, so a temporary key such as an end-to-end probe leaves no copy on the host.
#
#   revoke-key.sh --organization zpghl --key lead-e2e --reason "end-to-end check complete"
set -euo pipefail
. "$(dirname "$0")/host-lib.sh"
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

cd "$app"
require_public_url
require_owner_state "$organization"
cookie=$(owner_sign_in "$organization")
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
sign_out "$cookie"
if [ -e "$state_dir/$key-key" ]; then
  rm -f "$state_dir/$key-key"
  echo "Deleted $state_dir/$key-key"
fi
