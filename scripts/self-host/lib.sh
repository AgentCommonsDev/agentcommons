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
# A pulled image is installed only with a Sigstore signature by this identity (ADR 0102):
# the release workflow on main, through GitHub's OIDC issuer. AGENTCOMMONS_IMAGE_SIGNER in
# .env names another workflow for a fork that publishes its own images.
release_signer=https://github.com/AgentCommonsDev/agentcommons/.github/workflows/release.yml@refs/heads/main
release_signer_issuer=https://token.actions.githubusercontent.com
# The verifier runs from its own image, pinned by digest so no registry can swap it; the
# release workflow signs with the same cosign version.
cosign_image=ghcr.io/sigstore/cosign/cosign:v2.6.5@sha256:ad281047f85c5e1fc6ffbc30c2b55be3b07b4032bef715a12122ce5829619aca

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
# image_digest REF: the registry digest (repository@sha256:...) the local image REF was
# pulled as, or nothing for an image that never came from REF's repository (a local build).
# A digest reference (a pin) is its own answer: the pull fetched exactly that content.
image_digest() {
  local name=${1%@*} repository
  case $1 in
  *@sha256:*)
    printf '%s' "$1"
    return 0
    ;;
  esac
  repository=$name
  # Strip a tag, never a registry port: only the last path segment can carry one.
  case ${name##*/} in
  *:*) repository=${name%:*} ;;
  esac
  # awk reads to the end: exiting early would turn the inspect into SIGPIPE under pipefail.
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null |
    awk -v prefix="$repository@" 'found == "" && index($0, prefix) == 1 { found = $0 } END { if (found != "") print found }'
}
# verify_signature REF: true when the local image REF was pulled as a registry digest that
# carries a Sigstore signature by the release signer. Anything else (no digest, no signature,
# another signer, Sigstore unreachable) is false, with cosign's reason on stderr, so a
# registry token or a man in the middle cannot get an image installed.
verify_signature() {
  local digest signer output
  digest=$(image_digest "$1")
  if [ -z "$digest" ]; then
    echo "$1 has no registry digest to verify." >&2
    return 1
  fi
  signer=$(setting AGENTCOMMONS_IMAGE_SIGNER)
  if output=$(docker run --rm "$cosign_image" verify \
    --certificate-identity "${signer:-$release_signer}" \
    --certificate-oidc-issuer "$release_signer_issuer" "$digest" 2>&1 >/dev/null); then
    return 0
  fi
  printf '%s\n' "$output" | tail -n 3 >&2
  return 1
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
# api_base: the base URL of the local API on the port Compose publishes (127.0.0.1:3000 by
# default). Readiness and the post-deploy self-check reach the stack over loopback only.
api_base() {
  local address
  address=$(compose port api 3000 2>/dev/null | head -n 1 || true)
  printf 'http://%s' "${address:-127.0.0.1:3000}"
}
# wait_ready: polls /ready on the published API port until it answers or the attempts run out.
wait_ready() {
  local base
  base=$(api_base)
  for _ in $(seq 1 "$ready_attempts"); do
    curl -fsS --max-time 10 "$base/ready" >/dev/null 2>&1 && return 0
    sleep "$ready_interval"
  done
  echo "The API did not become ready at $base/ready." >&2
  compose ps >&2 || true
  compose logs --tail 50 api >&2 || true
  return 1
}
# verify_deploy [EXPECTED_VERSION] [EXPECTED_IMAGE]: after the stack is up, prove the local
# API actually serves this release, so a release or update that came up broken or stale fails
# loudly instead of being reported as a success. It exists because of the 2026-09-11
# incidents that nothing caught: a stale hook bundle served for hours after a downgrade, and
# a ~20 s window in which /hook/manifest.json was empty and POST /mcp failed during an API
# swap. Localhost only, no secrets printed, a few seconds. It asserts, in order:
#   1. /ready answers 200 within the bounded wait_ready poll;
#   2. GET /hook/manifest.json is a valid, non-empty manifest whose bundle downloads and
#      whose sha256 matches what the manifest declares;
#   3. the running API reports EXPECTED_VERSION (the intended commit; skipped when empty or
#      "development") and runs EXPECTED_IMAGE (the intended image id; skipped when empty),
#      so a floating tag that served an older image than the release intended is caught;
#   4. a POST /mcp initialize handshake returns a JSON body that is a JSON-RPC message (200)
#      or the unauthenticated bearer challenge (401) rather than a 5xx, a 404 from a missing
#      route, or an empty body, proving the MCP transport is serving.
# Returns non-zero with a one-line reason on the first failed assertion. Call it inside an
# `if` (set -e is suspended there, as with stack_up) so every explicit return is honoured.
verify_deploy() {
  local expect_version=${1:-} expect_image=${2:-}
  local base manifest manifest_version manifest_url declared_sha bundle_ref bundle_file bundle_sha
  local running_ver running_img mcp_file mcp_code mcp_body

  wait_ready || return 1
  base=$(api_base)

  manifest=$(curl -fsS --max-time 10 "$base/hook/manifest.json" 2>/dev/null) || {
    echo "verify: GET /hook/manifest.json failed; the API is not serving the hook manifest." >&2
    return 1
  }
  manifest_version=$(printf '%s' "$manifest" | jq -er '.version' 2>/dev/null) || {
    echo "verify: /hook/manifest.json is empty or not a valid manifest." >&2
    return 1
  }
  manifest_url=$(printf '%s' "$manifest" | jq -er '.url' 2>/dev/null) || {
    echo "verify: /hook/manifest.json has no bundle url." >&2
    return 1
  }
  declared_sha=$(printf '%s' "$manifest" | jq -er '.sha256' 2>/dev/null) || {
    echo "verify: /hook/manifest.json has no bundle sha256." >&2
    return 1
  }
  case $manifest_url in
  http://* | https://*) bundle_ref=$manifest_url ;;
  *) bundle_ref="$base$manifest_url" ;;
  esac
  bundle_file=$(mktemp)
  if ! curl -fsS --max-time 20 -o "$bundle_file" "$bundle_ref" 2>/dev/null; then
    rm -f "$bundle_file"
    echo "verify: the hook bundle $manifest_url the manifest points to is not fetchable." >&2
    return 1
  fi
  bundle_sha=$(sha256sum "$bundle_file" | cut -d' ' -f1)
  rm -f "$bundle_file"
  if [ "$bundle_sha" != "$declared_sha" ]; then
    echo "verify: the hook bundle sha256 $bundle_sha does not match the manifest ($declared_sha)." >&2
    return 1
  fi

  if [ -n "$expect_version" ] && [ "$expect_version" != development ]; then
    running_ver=$(running_version)
    if [ "$running_ver" != "$expect_version" ]; then
      echo "verify: the API reports version $running_ver, not the deployed $expect_version." >&2
      return 1
    fi
  fi
  if [ -n "$expect_image" ]; then
    running_img=$(running_image)
    if [ "$running_img" != "$expect_image" ]; then
      echo "verify: the API runs image ${running_img:-none}, not the deployed $expect_image." >&2
      return 1
    fi
  fi

  mcp_file=$(mktemp)
  mcp_code=$(curl -sS -o "$mcp_file" -w '%{http_code}' --max-time 10 -X POST "$base/mcp" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"post-deploy-verify","version":"0"}}}' 2>/dev/null)
  mcp_body=$(cat "$mcp_file" 2>/dev/null || true)
  rm -f "$mcp_file"
  case ${mcp_code:-000} in
  5??)
    echo "verify: POST /mcp returned HTTP $mcp_code." >&2
    return 1
    ;;
  *000 | "")
    echo "verify: POST /mcp did not connect." >&2
    return 1
    ;;
  esac
  if [ -z "$mcp_body" ]; then
    echo "verify: POST /mcp returned an empty body." >&2
    return 1
  fi
  if ! printf '%s' "$mcp_body" | jq -e . >/dev/null 2>&1; then
    echo "verify: POST /mcp did not return JSON." >&2
    return 1
  fi
  if [ "$mcp_code" = 200 ]; then
    printf '%s' "$mcp_body" | jq -e 'has("jsonrpc") and (has("result") or has("error"))' >/dev/null 2>&1 || {
      echo "verify: POST /mcp answered 200 without a JSON-RPC result." >&2
      return 1
    }
  elif [ "$mcp_code" != 401 ]; then
    echo "verify: POST /mcp answered HTTP $mcp_code, not an MCP handshake." >&2
    return 1
  fi

  echo "Verified $base: /ready ok, hook $manifest_version bundle sha matches, MCP serving (HTTP $mcp_code), running $(running_version)."
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
# prune_build_leftovers: after an on-host build, trims the BuildKit cache to the most
# recently used layers and drops dangling images (the local image a rebuild just replaced).
# Nothing here is used again once the built image runs, and left alone it fills the root
# volume: on the hosted instance the cache held 32 GB (27 GB unused) and 4 GB of dangling
# images on a 58 GB disk that had reached 100% on 2026-09-12. The kept amount is
# AGENTCOMMONS_BUILD_CACHE_KEEP (default 4GB) so a rebuild of a similar commit stays fast.
# A prune failure is reported and does not fail the deploy.
prune_build_leftovers() {
  local keep=${AGENTCOMMONS_BUILD_CACHE_KEEP:-4GB} flag=--keep-storage
  # Docker 28 renamed --keep-storage to --max-used-space and hid the old spelling.
  if docker builder prune --help 2>/dev/null | grep -q -- --max-used-space; then flag=--max-used-space; fi
  logged docker builder prune --force "$flag" "$keep" ||
    echo "The build cache could not be pruned; the deploy continues. Run 'docker builder prune' by hand." >&2
  logged docker image prune --force ||
    echo "Dangling images could not be pruned; the deploy continues. Run 'docker image prune' by hand." >&2
}
# stack_up MODE [LOG]: MODE pull fetches the configured image and refuses it without the
# release signature, build builds it from the checkout, start uses what is already present. Then starts every service (the migration
# runs before the API), waits for /ready and reloads Caddy when it is part of the stack so
# it refreshes its trusted proxy ranges and applies the shipped Caddyfile without closing
# its listening sockets. Compose output goes to LOG when given.
stack_up() {
  local mode=$1
  stack_log=${2:-}
  # Callers test this function in an `if`, where `set -e` is suspended: every step
  # returns explicitly so a failed pull, build or start is reported as a failure.
  case $mode in
  pull)
    logged compose pull --quiet api || return 1
    verify_signature "$(configured_image)" || return 1
    ;;
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
    prune_build_leftovers
    ;;
  start) ;;
  *)
    echo "stack_up: unknown mode $mode" >&2
    return 2
    ;;
  esac
  logged compose up -d --no-build --remove-orphans || return 1
  wait_ready || return 1
  # Caddy is reloaded whenever it is one of the stack's services: its entrypoint refreshes
  # the trusted proxy ranges and then runs `caddy reload`, which re-adapts the Caddyfile the
  # release shipped (infra/caddy is a directory mount, so the running container sees it)
  # and swaps the configuration while the listening sockets stay open, so the edge never
  # refuses a connection. When the reload fails (Caddy not running, admin endpoint down)
  # the restart releases used before takes over, at the cost of about a second of refused
  # connections. The list is read whole before matching: `grep -q` stops at its first hit,
  # and under pipefail a writer still emitting lines would die of SIGPIPE and silently skip
  # the reload (seen on a 2-vCPU CI runner with GNU grep; ugrep drains its input and never
  # showed it).
  local services
  services=$(compose config --services) || return 1
  if grep -qx caddy <<<"$services"; then
    logged compose exec -T caddy sh /etc/caddy/entrypoint.sh caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ||
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
