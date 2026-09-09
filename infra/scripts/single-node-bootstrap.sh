#!/usr/bin/env bash
# Seeds the first owner and organization on the single-node host, enrolls Google
# sign-in domains for it (ADR 0049) and optionally mints organization API keys.
#
#   PULUMI_STACK=zpghl infra/scripts/single-node-bootstrap.sh \
#     --admin owner@example.com --organization team --name "Team" \
#     --domain example.com --domain example.org --key ci-probe
#
# Ships this checkout's infra/scripts/single-node/bootstrap.sh to the host through the
# release bucket and runs it there through SSM Run Command, so the bootstrap tooling
# follows the operator's checkout while the application code stays the released one.
# Secrets (the owner setup link and password, minted keys) never appear in command
# output; the host keeps them under /root/agentcommons (owner-<organization>.json and
# <key>-key). Safe to re-run.
set -euo pipefail
. "$(dirname "$0")/single-node/lib.sh"

[ $# -gt 0 ] || {
  echo "Usage: single-node-bootstrap.sh --admin EMAIL --organization SLUG --name NAME [--domain DOMAIN]... [--key NAME]..." >&2
  exit 2
}
ship_run "$repo/infra/scripts/single-node/bootstrap.sh" "$@"
