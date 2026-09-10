#!/usr/bin/env bash
# Publishes one commit to the single-node host and applies it there.
#
#   PULUMI_STACK=zpghl infra/scripts/single-node-release.sh <commit-ish> [--build]
#
# Uploads `git archive` of the commit to the stack's private release bucket, points
# `current` at it, then runs the host's release wrapper through SSM Run Command: it
# unpacks the source, renders .env from SSM SecureString parameters, pulls the published
# image (`--build` builds it on the host instead, for a host without registry access),
# applies both database migrations and restarts the API behind Caddy. Re-running with
# the same commit re-applies configuration only. Between releases the host installs new
# published images on its own (scripts/self-host/agentcommons-update.sh, ADR 0059).
set -euo pipefail
. "$(dirname "$0")/single-node/lib.sh"

ref=${1:?Usage: single-node-release.sh <commit-ish> [--build]}
build=
case ${2:-} in
"") ;;
--build) build="AGENTCOMMONS_BUILD=true " ;;
*)
  echo "Unknown option: $2 (only --build is accepted)" >&2
  exit 2
  ;;
esac
commit=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
archive=$(mktemp "${TMPDIR:-/tmp}/agentcommons-release.XXXXXX")
trap 'rm -f "$archive" "$archive.commit"' EXIT
# The archive carries the commit so an on-host build stamps the image with it.
printf '%s\n' "$commit" >"$archive.commit"
git -C "$repo" archive --format=tar.gz --add-file="$archive.commit" -o "$archive" "$commit"
rm -f "$archive.commit"
aws s3 cp --region "$region" --only-show-errors "$archive" "s3://$bucket/releases/$commit.tar.gz"
printf '%s\n' "$commit" | aws s3 cp --region "$region" --only-show-errors - "s3://$bucket/current"
echo "Published $commit to s3://$bucket/releases/$commit.tar.gz"
ssm_run "AgentCommons release $commit" "${build}/usr/local/bin/agentcommons-release $commit"
