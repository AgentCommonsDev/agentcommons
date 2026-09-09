#!/usr/bin/env bash
# Runs one of the on-host scripts in infra/scripts/single-node/ on the single-node host.
#
#   PULUMI_STACK=zpghl infra/scripts/single-node-run.sh isolation-check.sh --organization zpghl
#
# The script is shipped from this checkout through the release bucket and executed as
# root through SSM Run Command; its output is printed here.
set -euo pipefail
. "$(dirname "$0")/single-node/lib.sh"

name=${1:?Usage: single-node-run.sh <script in infra/scripts/single-node/> [args...]}
shift
[[ $name =~ ^[a-z0-9-]+\.sh$ ]] || {
  echo "Name a script file in infra/scripts/single-node/, for example isolation-check.sh" >&2
  exit 2
}
ship_run "$repo/infra/scripts/single-node/$name" "$@"
