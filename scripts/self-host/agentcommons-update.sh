#!/usr/bin/env bash
# Keeps a self-hosted AgentCommons stack on the latest published release.
#
#   agentcommons-update.sh            # hourly from the systemd timer; obeys AUTO_UPDATE in .env
#   agentcommons-update.sh --now      # check and update even when AUTO_UPDATE is not true
#   agentcommons-update.sh --status   # running version, configured image, last result
#   agentcommons-update.sh --dir DIR  # the stack directory (default /opt/agentcommons/app)
#
# Pulls the image docker-compose.yml resolves (AGENTCOMMONS_IMAGE, or the stable release),
# compares it with the running API container and, when it changed, keeps the current image
# as agentcommons:previous, starts the stack (migration first), waits for /ready and restores
# the previous image if the new one does not come up. A release that failed is skipped until a
# newer one is published. Runs as root on the host; the stack is a checkout with a .env.
#
# It never moves backwards: a floating tag such as :stable is installed only when the pulled
# image's release stamp (the OCI revision and created labels both build paths write) is a
# later build of another commit than the running image's. An older or equal build is held
# (last_result=held-newer-running), a rebuild of the running commit is not installed
# (same-release), and a stamp missing on either side holds too (held-unknown-age) rather
# than swapping blindly. AGENTCOMMONS_IMAGE set to a sha- tag or a digest is a pin and is
# installed as asked, older or not.
#
# It reads .env as the last release left it and never renders or edits it, so an update can
# change the image and nothing else: the database the stack runs on (ADR 0063), the Compose
# file list and every other setting stay exactly as applied. Every run records its outcome in
# $state_root/update-state (last_check, last_result, failures, ...), which --status prints and
# the API reports on Admin -> Status when docker-compose.updater.yml mounts the directory.
set -euo pipefail

mode=timer
while [ $# -gt 0 ]; do
  case $1 in
  --now) mode=now ;;
  --status) mode=status ;;
  --dir)
    shift
    export AGENTCOMMONS_APP_DIR=${1:?--dir needs a path}
    ;;
  --dir=*) export AGENTCOMMONS_APP_DIR=${1#--dir=} ;;
  -h | --help)
    sed -n '2,13p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown option: $1" >&2
    exit 2
    ;;
  esac
  shift
done
lib="${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}/scripts/self-host/lib.sh"
[ -f "$lib" ] || {
  echo "No AgentCommons checkout at ${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app} ($lib is missing)." >&2
  exit 1
}
. "$lib"
enter_stack

if [ "$mode" = status ]; then
  image=$(configured_image)
  running=$(running_image)
  pulled=$(local_image "$image")
  pinned=
  ! image_pinned "$image" || pinned=" (pinned: installed as is)"
  echo "stack:             $app"
  echo "running version:   $(running_version)"
  echo "running image:     $running"
  echo "running release:   $(release_of "$running")"
  echo "configured image:  $image$pinned"
  echo "pulled image:      $pulled"
  echo "pulled release:    $(release_of "$pulled")"
  echo "automatic updates: $(setting AUTO_UPDATE)"
  if [ -s "$state_root/update-state" ]; then
    echo "--- last run"
    cat "$state_root/update-state"
  fi
  exit 0
fi
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# record_outcome RESULT [KEY=VALUE...]: the run's result plus what an operator reads on Admin
# -> Status: last_ok when the check completed (up to date, updated, disabled, or a release
# held: failed earlier, not newer, the running commit rebuilt, or of unknown age), and the
# count of consecutive failed runs, reset by a completed check.
record_outcome() {
  local result=$1 failures
  shift
  case $result in
  unchanged | updated | skipped | disabled | same-release | held-newer-running | held-unknown-age)
    record_state "last_result=$result" "last_ok=$now" "failures=0" "$@"
    ;;
  *)
    failures=$(state_value failures)
    record_state "last_result=$result" "failures=$((${failures:-0} + 1))" "$@"
    ;;
  esac
}
if [ "$mode" = timer ] && [ "$(setting AUTO_UPDATE)" != true ]; then
  # Quiet on purpose: the timer fires hourly whether or not updates are wanted.
  record_state "last_check=$now"
  record_outcome disabled
  exit 0
fi

lock_stack
image=$(configured_image)
before=$(running_image)
record_state "last_check=$now"
if ! compose pull --quiet api; then
  record_outcome pull-failed
  echo "Could not pull $image." >&2
  exit 1
fi
after=$(local_image "$image")
[ -n "$after" ] || {
  record_outcome pull-failed
  echo "Pulled $image but it is not present locally." >&2
  exit 1
}
# Both release stamps go into the state file on every completed pull, so Admin -> Status
# and --status can show which release runs and which one the tag offers.
running_revision=$(image_label "$before" "$revision_label")
running_created=$(image_label "$before" "$created_label")
pulled_revision=$(image_label "$after" "$revision_label")
pulled_created=$(image_label "$after" "$created_label")
record_state "running_revision=$running_revision" "running_created=$running_created" \
  "pulled_revision=$pulled_revision" "pulled_created=$pulled_created"
if [ "$after" = "$before" ]; then
  record_outcome unchanged "last_image=$after"
  echo "Up to date: $image is running ($(running_version))."
  exit 0
fi
if [ "$after" = "$(state_value failed_image)" ]; then
  record_outcome skipped
  echo "Skipping $image: this release failed on $(state_value failed_at) and is held until a newer one is published."
  exit 0
fi
if [ -z "$before" ]; then
  echo "No API container is running; starting $image."
elif image_pinned "$image"; then
  echo "$image is pinned: installing it as configured (release $(release_of "$after"), running $(release_of "$before"))."
else
  # A floating tag moves forward only. The pulled image must be a later build of another
  # commit than the running one; anything else is held and the reason recorded, so a
  # registry tag that fell behind the host (a hand-built release, a re-published older
  # image) cannot roll production back.
  case $(release_order "$running_revision" "$running_created" "$pulled_revision" "$pulled_created") in
  newer) ;;
  same-release)
    record_outcome same-release "last_image=$after"
    echo "Up to date: $image is a rebuild of the running release ${running_revision:0:12}; nothing to install."
    exit 0
    ;;
  older)
    record_outcome held-newer-running "last_image=$after"
    echo "Holding: $image is release ${pulled_revision:0:12} created $pulled_created, not newer than the running release ${running_revision:0:12} created $running_created. Pin AGENTCOMMONS_IMAGE to its sha- tag to install it anyway."
    exit 0
    ;;
  *)
    record_outcome held-unknown-age "last_image=$after"
    echo "Holding: cannot tell whether $image is newer than the running image (running release: $(release_of "$before"); pulled release: $(release_of "$after")). Both images need the $revision_label and $created_label labels; pin AGENTCOMMONS_IMAGE or install the release by hand."
    exit 0
    ;;
  esac
fi
[ -z "$before" ] || docker tag "$before" "$previous_tag"
record_state "last_result=updating" "previous_image=$before" "last_image=$after"
echo "Updating to $image ($after) from ${before:-no running image}."
# The new image must both come up and pass the post-deploy self-check before the update is
# recorded as a success. A release that starts but serves a broken or stale hook bundle or a
# failing MCP endpoint is treated exactly like one that never became ready: rolled back to
# the previous image, recorded as a failed release and held until a newer one is published,
# so the timer never leaves a broken new image serving (the 2026-09-11 incidents).
failure=
if ! stack_up start; then
  failure="did not become ready"
elif ! verify_deploy; then
  failure="came up but failed its post-deploy self-check"
fi
if [ -z "$failure" ]; then
  record_outcome updated "updated_at=$now" "failed_image="
  docker image prune -f >/dev/null 2>&1 || true
  echo "Updated to $(running_version)."
  exit 0
fi
# The run's outcome is the rollback's; a release held with nothing to restore counts here.
record_state "last_result=failed" "failed_image=$after" "failed_at=$now"
if [ -z "$before" ]; then
  record_outcome failed
  echo "The new release $failure and there is no previous image to restore." >&2
  exit 1
fi
echo "The new release $failure; restoring the previous image." >&2
# The shell variable outranks the empty AGENTCOMMONS_IMAGE in .env; --no-deps keeps the new
# release's migration from running again. Database migrations are not rolled back.
if AGENTCOMMONS_IMAGE=$previous_tag compose up -d --no-build --no-deps api && wait_ready; then
  record_outcome rolled-back
  echo "Rolled back to $(running_version); release $after is held until a newer one is published." >&2
  exit 1
fi
record_outcome rollback-failed
echo "The rollback did not restore a ready API; inspect docker compose logs api." >&2
exit 1
