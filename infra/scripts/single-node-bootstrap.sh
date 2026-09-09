#!/usr/bin/env bash
# Seeds the first owner and organization on the single-node host and enrolls Google
# sign-in domains for it (ADR 0049).
#
#   PULUMI_STACK=zpghl infra/scripts/single-node-bootstrap.sh \
#     --admin owner@example.com --organization team --name "Team" \
#     --domain example.com --domain example.org
#
# Runs infra/scripts/single-node/bootstrap.sh on the host through SSM Run Command.
# Secrets (the owner setup link and password) never appear in command output; the host
# keeps them in /root/agentcommons/owner-bootstrap.json. Safe to re-run.
set -euo pipefail
. "$(dirname "$0")/single-node/lib.sh"

[ $# -gt 0 ] || {
  echo "Usage: single-node-bootstrap.sh --admin EMAIL --organization SLUG --name NAME [--domain DOMAIN]..." >&2
  exit 2
}
printf -v remote '%q ' /opt/agentcommons/app/infra/scripts/single-node/bootstrap.sh "$@"
ssm_run "AgentCommons bootstrap" "$remote"
