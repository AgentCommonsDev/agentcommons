# Shared by the on-host self-hosting scripts: the updater (agentcommons-update.sh) and the
# single-node apply step (infra/scripts/single-node/apply.sh, through host-lib.sh). Source
# it; do not execute it. The stack is the checkout holding docker-compose.yml and .env;
# COMPOSE_FILE and COMPOSE_PROJECT_NAME in that .env select the Compose files and project
# name, exactly as the docker compose CLI reads them, so every caller sees the same services.
set -euo pipefail

app=${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}
state_root=${AGENTCOMMONS_STATE_DIR:-/var/lib/agentcommons}
ready_attempts=${AGENTCOMMONS_READY_ATTEMPTS:-60}
ready_interval=${AGENTCOMMONS_READY_INTERVAL:-5}
# The image that was running before an update; the rollback target.
previous_tag=agentcommons:previous
# The release stamp both build paths write (Dockerfile ARGs AGENTCOMMONS_REVISION and
# AGENTCOMMONS_CREATED): the full commit and the RFC 3339 build time.
revision_label=org.opencontainers.image.revision
created_label=org.opencontainers.image.created

# setting KEY [FILE]: one value from the stack's .env (or another rendered env file);
# surrounding single or double quotes are stripped (the single-node stack quotes every
# value, .env.example quotes none).
setting() {
  local value
  value=$(sed -n "s/^$1=//p" "${2:-$app/.env}" | tail -n 1)
  case $value in
  \'*\')
    value=${value#\'}
    value=${value%\'}
    ;;
  \"*\")
    value=${value#\"}
    value=${value%\"}
    ;;
  esac
  printf '%s' "$value"
}
# enter_stack: the stack directory must hold docker-compose.yml and a rendered .env.
enter_stack() {
  [ -f "$app/docker-compose.yml" ] && [ -f "$app/.env" ] || {
    echo "No Compose stack in $app: docker-compose.yml and .env are required." >&2
    exit 1
  }
  cd "$app"
}
# lock_stack: one release or update at a time; waits up to ten minutes for the other.
lock_stack() {
  install -d -m 0755 "$state_root"
  exec 9>"$state_root/stack.lock"
  flock -w 600 9 || {
    echo "Another AgentCommons release or update is still running." >&2
    exit 1
  }
}
# compose ARGS...: docker compose for the stack (run from the stack directory).
compose() {
  docker compose "$@"
}
# api_container: the running API container id, or nothing.
api_container() {
  compose ps -q api 2>/dev/null | head -n 1 || true
}
# running_image: the image id behind the running API container, or nothing.
running_image() {
  local id
  id=$(api_container)
  [ -n "$id" ] || return 0
  docker inspect --format '{{.Image}}' "$id" 2>/dev/null || true
}
# running_version: AGENTCOMMONS_VERSION inside the running API container, or "unknown".
running_version() {
  local id version=
  id=$(api_container)
  if [ -n "$id" ]; then
    version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$id" 2>/dev/null |
      sed -n 's/^AGENTCOMMONS_VERSION=//p' | head -n 1 || true)
  fi
  printf '%s' "${version:-unknown}"
}
# configured_image: the reference the api service resolves to (AGENTCOMMONS_IMAGE or the
# stable release named in docker-compose.yml).
configured_image() {
  # `compose config --images api` also lists the images of api's dependencies, so read the
  # api service's own image line from the resolved configuration instead.
  # awk reads to the end on purpose: exiting early would close the pipe under compose and
  # turn a successful lookup into SIGPIPE (exit 141) with pipefail.
  compose config 2>/dev/null | awk '
    /^  api:$/ { in_api = 1; next }
    in_api && /^  [^ ]/ { in_api = 0 }
    in_api && $1 == "image:" && image == "" { image = $2 }
    END { if (image != "") print image }
  '
}
# local_image REF: the local image id for a reference, or nothing when it was never pulled.
local_image() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}
# image_label REF NAME: one label of a local image (by id or reference), or nothing when the
# image or the label is missing.
image_label() {
  local value
  [ -n "$1" ] || return 0
  value=$(docker image inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null || true)
  [ "$value" != "<no value>" ] || value=
  printf '%s' "$value"
}
# release_of REF: the image's release stamp for an operator, "<12-hex commit> created
# <time>", or "unknown" when either label is missing.
release_of() {
  local revision created
  revision=$(image_label "$1" "$revision_label")
  created=$(image_label "$1" "$created_label")
  if [ -n "$revision" ] && [ -n "$created" ]; then
    printf '%s created %s' "${revision:0:12}" "$created"
  else
    printf 'unknown'
  fi
}
# image_pinned REF: true when the configured reference names one exact image (a `sha-` tag
# or a digest), which the updater installs as asked, older or not. Floating tags such as
# `stable` are compared by release age first.
image_pinned() {
  case $1 in
  *@sha256:*) return 0 ;;
  esac
  case ${1##*:} in
  sha-*) return 0 ;;
  esac
  return 1
}
# release_order RUNNING_REVISION RUNNING_CREATED PULLED_REVISION PULLED_CREATED: how the
# pulled release relates to the running one, from the stamps image_label read: "newer"
# (another commit built later), "same-release" (the running commit rebuilt), "older" (built
# earlier or at the same time; a moving tag that fell behind the host) or "unknown" (a stamp
# missing or unreadable on either side). GNU date parses the RFC 3339 values, so formats
# with fractional seconds or offsets compare correctly too.
release_order() {
  local running_seconds pulled_seconds
  if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
    echo unknown
    return 0
  fi
  if [ "$1" = "$3" ]; then
    echo same-release
    return 0
  fi
  running_seconds=$(date -u -d "$2" +%s 2>/dev/null) && pulled_seconds=$(date -u -d "$4" +%s 2>/dev/null) || {
    echo unknown
    return 0
  }
  if [ "$pulled_seconds" -gt "$running_seconds" ]; then echo newer; else echo older; fi
}
# wait_ready: polls /ready on the published API port until it answers or the attempts run out.
wait_ready() {
  local address url
  address=$(compose port api 3000 2>/dev/null | head -n 1 || true)
  url="http://${address:-127.0.0.1:3000}/ready"
  for _ in $(seq 1 "$ready_attempts"); do
    curl -fsS --max-time 10 "$url" >/dev/null 2>&1 && return 0
    sleep "$ready_interval"
  done
  echo "The API did not become ready at $url." >&2
  compose ps >&2 || true
  compose logs --tail 50 api >&2 || true
  return 1
}
# logged COMMAND...: runs the command, appending its output to $stack_log when one is set.
stack_log=
logged() {
  if [ -n "$stack_log" ]; then "$@" >>"$stack_log" 2>&1; else "$@"; fi
}
# stack_version: the AGENTCOMMONS_VERSION an on-host build stamps into the image: the
# exported value, else the release archive's <name>.commit file in the stack (12 characters,
# as the release workflow tags images), else the checkout's git HEAD, else "development".
# Every fallback prints, so a build that would report "development" says why.
stack_version() {
  local commit_file version=${AGENTCOMMONS_VERSION:-}
  if [ -z "$version" ]; then
    commit_file=$(ls -1 "$app"/*.commit 2>/dev/null | head -n 1 || true)
    if [ -n "$commit_file" ]; then
      version=$(cut -c1-12 "$commit_file" | head -n 1)
    elif version=$(git -C "$app" rev-parse --short=12 HEAD 2>/dev/null) && [ -n "$version" ]; then
      :
    else
      version=development
    fi
  fi
  printf '%s' "$version"
}
# stack_revision: the full commit an on-host build stamps as the image's revision label:
# the exported AGENTCOMMONS_REVISION, else the release archive's <name>.commit file, else
# the checkout's git HEAD, else nothing (the label stays empty and the updater holds the
# image because its age is unknown).
stack_revision() {
  local commit_file revision=${AGENTCOMMONS_REVISION:-}
  if [ -z "$revision" ]; then
    commit_file=$(ls -1 "$app"/*.commit 2>/dev/null | head -n 1 || true)
    if [ -n "$commit_file" ]; then
      revision=$(head -n 1 "$commit_file" | tr -d '[:space:]')
    else
      revision=$(git -C "$app" rev-parse HEAD 2>/dev/null || true)
    fi
  fi
  printf '%s' "$revision"
}
# stack_up MODE [LOG]: MODE pull fetches the configured image, build builds it from the
# checkout, start uses what is already present. Then starts every service (the migration
# runs before the API), waits for /ready and restarts Caddy when it is part of the stack so
# it refreshes its trusted proxy ranges. Compose output goes to LOG when given.
stack_up() {
  local mode=$1
  stack_log=${2:-}
  # Callers test this function in an `if`, where `set -e` is suspended: every step
  # returns explicitly so a failed pull, build or start is reported as a failure.
  case $mode in
  pull) logged compose pull --quiet api || return 1 ;;
  build)
    # The build stamps the same release labels as the release workflow, so the updater can
    # tell this image's age from a published one's.
    local version revision created
    version=$(stack_version)
    revision=$(stack_revision)
    created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "Building the image with AGENTCOMMONS_VERSION=$version (revision ${revision:-unknown}, created $created)"
    [ -n "$revision" ] || echo "No commit is known for this checkout: the updater will hold the image it builds until a release is installed by hand." >&2
    logged compose build --build-arg "AGENTCOMMONS_VERSION=$version" \
      --build-arg "AGENTCOMMONS_REVISION=$revision" --build-arg "AGENTCOMMONS_CREATED=$created" api || return 1
    ;;
  start) ;;
  *)
    echo "stack_up: unknown mode $mode" >&2
    return 2
    ;;
  esac
  logged compose up -d --no-build --remove-orphans || return 1
  wait_ready || return 1
  # Caddy is restarted whenever it is one of the stack's services. The list is read whole
  # before matching: `grep -q` stops at its first hit, and under pipefail a writer still
  # emitting lines would die of SIGPIPE and silently skip the restart (seen on a 2-vCPU CI
  # runner with GNU grep; ugrep drains its input and never showed it).
  local services
  services=$(compose config --services) || return 1
  if grep -qx caddy <<<"$services"; then
    logged compose restart caddy || return 1
  fi
}
# record_state KEY=VALUE...: merges values into the updater's state file, read by --status.
record_state() {
  local file="$state_root/update-state" pair
  install -d -m 0755 "$state_root"
  touch "$file"
  for pair in "$@"; do
    grep -v "^${pair%%=*}=" "$file" >"$file.new" || true
    printf '%s\n' "$pair" >>"$file.new"
    mv "$file.new" "$file"
  done
}
# state_value KEY: one value from the state file, or nothing.
state_value() {
  sed -n "s/^$1=//p" "$state_root/update-state" 2>/dev/null | tail -n 1 || true
}
