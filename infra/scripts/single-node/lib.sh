# Shared by the operator-side single-node scripts. Source it; do not execute it.
# Resolves the stack's outputs and runs commands on the host through SSM Run Command,
# so the host needs no SSH. Requires pulumi (logged in to the stack's backend, with
# PULUMI_CONFIG_PASSPHRASE_FILE set for the passphrase provider), aws, jq and git.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
stack=${PULUMI_STACK:?Set PULUMI_STACK to the single-node stack name}
for tool in pulumi aws jq git; do
  command -v "$tool" >/dev/null || {
    echo "Missing tool: $tool" >&2
    exit 1
  }
done

outputs=$(pulumi -C "$repo/infra" stack output --stack "$stack" --json)
output() {
  jq -er --arg key "$1" '.[$key] // empty' <<<"$outputs" || {
    echo "Stack $stack has no output '$1'. Is deployment single-node and has 'pulumi up' completed?" >&2
    exit 1
  }
}
region=$(output region)
instance=$(output instanceId)
bucket=$(output releaseBucket)

# ssm_run <comment> <command>: runs one shell command on the host and prints its output.
ssm_run() {
  local comment=$1 command=$2 id status
  id=$(aws ssm send-command --region "$region" --instance-ids "$instance" \
    --document-name AWS-RunShellScript --comment "$comment" --timeout-seconds 600 \
    --parameters "$(jq -cn --arg command "$command" '{commands: [$command], executionTimeout: ["5400"]}')" \
    --query Command.CommandId --output text)
  echo "SSM command $id on $instance: $comment"
  while :; do
    status=$(aws ssm get-command-invocation --region "$region" --command-id "$id" \
      --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)
    case $status in
    Pending | InProgress | Delayed) sleep 10 ;;
    *) break ;;
    esac
  done
  aws ssm get-command-invocation --region "$region" --command-id "$id" --instance-id "$instance" --output json |
    jq -r '.StandardOutputContent, (if .StandardErrorContent != "" then "--- stderr ---\n" + .StandardErrorContent else empty end)'
  [ "$status" = Success ] || {
    echo "SSM command $id finished with status $status" >&2
    return 1
  }
}

# ship_run <local script> <args...>: copies a script from this checkout, with the on-host
# library it sources, to the host through the release bucket and runs it there as root, so
# operator tooling follows the checkout while the application stays the released code.
# Arguments are quoted for the remote shell.
ship_run() {
  local script=$1 name lib arguments
  shift
  lib=$(dirname "$script")/host-lib.sh
  bash -n "$script"
  bash -n "$lib"
  name=$(basename "$script")
  aws s3 cp --region "$region" --only-show-errors "$lib" "s3://$bucket/scripts/host-lib.sh"
  aws s3 cp --region "$region" --only-show-errors "$script" "s3://$bucket/scripts/$name"
  printf -v arguments '%q ' "$@"
  ssm_run "AgentCommons $name" "aws s3 cp --region $region --only-show-errors s3://$bucket/scripts/host-lib.sh /opt/agentcommons/host-lib.sh && aws s3 cp --region $region --only-show-errors s3://$bucket/scripts/$name /opt/agentcommons/$name && chmod 0700 /opt/agentcommons/host-lib.sh /opt/agentcommons/$name && /opt/agentcommons/$name $arguments"
}
