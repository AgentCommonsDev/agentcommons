#!/usr/bin/env bash
# Publishes one commit to the single-node host and applies it there.
#
#   PULUMI_STACK=zpghl infra/scripts/single-node-release.sh <commit-ish>
#
# Uploads `git archive` of the commit to the stack's private release bucket, points
# `current` at it, then runs the host's release wrapper through SSM Run Command: it
# unpacks the source, renders .env from SSM SecureString parameters, rebuilds the image,
# applies both database migrations and restarts the API behind Caddy. Re-running with
# the same commit re-applies configuration only.
set -euo pipefail
. "$(dirname "$0")/single-node/lib.sh"

ref=${1:?Usage: single-node-release.sh <commit-ish>}
commit=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
archive=$(mktemp "${TMPDIR:-/tmp}/agentcommons-release.XXXXXX")
trap 'rm -f "$archive"' EXIT
git -C "$repo" archive --format=tar.gz -o "$archive" "$commit"
aws s3 cp --region "$region" --only-show-errors "$archive" "s3://$bucket/releases/$commit.tar.gz"
printf '%s\n' "$commit" | aws s3 cp --region "$region" --only-show-errors - "s3://$bucket/current"
echo "Published $commit to s3://$bucket/releases/$commit.tar.gz"
ssm_run "AgentCommons release $commit" "/usr/local/bin/agentcommons-release $commit"
