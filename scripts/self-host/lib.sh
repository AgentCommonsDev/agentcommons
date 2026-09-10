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
    local version
    version=$(stack_version)
    echo "Building the image with AGENTCOMMONS_VERSION=$version"
    logged compose build --build-arg "AGENTCOMMONS_VERSION=$version" api || return 1
    ;;
  start) ;;
  *)
    echo "stack_up: unknown mode $mode" >&2
    return 2
    ;;
  esac
  logged compose up -d --no-build --remove-orphans || return 1
  wait_ready || return 1
  if compose config --services | grep -qx caddy; then
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
