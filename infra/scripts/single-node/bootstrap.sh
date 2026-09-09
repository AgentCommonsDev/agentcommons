#!/usr/bin/env bash
# Runs on the host as root (invoked by infra/scripts/single-node-bootstrap.sh). Seeds the
# first owner and organization with the operator seed command, then enrolls Google
# sign-in domains with the operator domain command, which requires an owner session:
# the owner's one-time setup link is completed with a generated password through the
# native password endpoints and the resulting session cookie is handed to the CLI. The
# link and password are kept only in /root/agentcommons/owner-bootstrap.json (mode 600)
# and are never printed. Re-running reuses that credential.
set -euo pipefail
usage() {
  echo "Usage: $0 --admin EMAIL --organization SLUG --name NAME [--domain DOMAIN]..." >&2
  exit 2
}
admin= organization= display=
domains=()
while [ $# -gt 0 ]; do
  case $1 in
  --admin) admin=${2:?} && shift 2 ;;
  --organization) organization=${2:?} && shift 2 ;;
  --name) display=${2:?} && shift 2 ;;
  --domain) domains+=("${2:?}") && shift 2 ;;
  *) usage ;;
  esac
done
[ -n "$admin" ] && [ -n "$organization" ] && [ -n "$display" ] || usage

app=${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}
state_dir=/root/agentcommons
state="$state_dir/owner-bootstrap.json"
local_api=http://127.0.0.1:3000
cd "$app"
compose() {
  docker compose -p agentcommons -f docker-compose.yml -f docker-compose.caddy.yml "$@"
}
operator() {
  compose exec -T api pnpm --filter @agentcommons/api exec tsx "$@" </dev/null | tail -n 1
}
# The API accepts credential requests only from its own origin.
post() {
  local path=$1 body=$2
  shift 2
  curl -fsS -X POST "$local_api$path" -H "Origin: $public_url" \
    -H 'Content-Type: application/json' --data "$body" "$@"
}
public_url=$(sed -n "s/^PUBLIC_URL='\(.*\)'$/\1/p" .env)
[ -n "$public_url" ] || {
  echo "PUBLIC_URL is missing from $app/.env" >&2
  exit 1
}
curl -fsS "$local_api/ready" >/dev/null || {
  echo "The API is not ready; run the release first." >&2
  exit 1
}
umask 077
install -d -m 0700 "$state_dir"

seed=$(operator src/seed.ts --admin "$admin" --organization "$organization" --name "$display")
jq -e '.organization_id and .user_id' <<<"$seed" >/dev/null || {
  echo "The seed did not return an organization." >&2
  exit 1
}
setup_url=$(jq -r '.setup_url // empty' <<<"$seed")
password=$([ -f "$state" ] && jq -r '.password // empty' "$state" || true)
if [ -z "$password" ]; then
  if [ -z "$setup_url" ]; then
    echo "The owner already has a credential and no stored password; issuing a new setup link."
    setup_url=$(operator src/recover.ts --email "$admin" | jq -r '.setup_url')
  fi
  token=$(sed -E 's#.*/reset-password/([^?/]+).*#\1#' <<<"$setup_url")
  [ -n "$token" ] && [ "$token" != "$setup_url" ] || {
    echo "Could not read the setup token from the seed output." >&2
    exit 1
  }
  password=$(openssl rand -base64 60 | tr -dc 'A-Za-z0-9' | head -c 40)
  post /auth/reset-password "$(jq -cn --arg token "$token" --arg newPassword "$password" '$ARGS.named')" -o /dev/null
fi
jq -n --arg email "$admin" --arg organization "$organization" --argjson seed "$seed" \
  --arg password "$password" --arg setup_url "$setup_url" --arg updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{email: $email, organization: $organization, organization_id: $seed.organization_id,
    user_id: $seed.user_id, setup_url: (if $setup_url == "" then null else $setup_url end),
    password: $password, updated_at: $updated_at}' >"$state.new"
mv "$state.new" "$state"

headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
post /auth/sign-in/email "$(jq -cn --arg email "$admin" --arg password "$password" '$ARGS.named')" -D "$headers" -o /dev/null
cookie=$(awk 'tolower($1) == "set-cookie:" { sub(/;.*/, "", $2); printf "%s%s", (n++ ? "; " : ""), $2 }' "$headers")
[ -n "$cookie" ] || {
  echo "Owner sign-in returned no session." >&2
  exit 1
}
for domain in ${domains[@]+"${domains[@]}"}; do
  result=$(printf '%s' "$cookie" | compose exec -T api sh -c '
    umask 077 && cat >/tmp/owner.cookie &&
      pnpm --filter @agentcommons/api exec tsx src/domain.ts --organization "$1" --domain "$2" --cookie-file /tmp/owner.cookie
    status=$?
    rm -f /tmp/owner.cookie
    exit $status' -- "$organization" "$domain" | tail -n 1)
  echo "Sign-in domain $domain: $result"
done
post /auth/sign-out '{}' -H "Cookie: $cookie" -o /dev/null || true
echo "Organization $organization ($(jq -r .organization_id <<<"$seed")) has owner $admin."
echo "The owner setup link and password are in $state on this host (root only)."
