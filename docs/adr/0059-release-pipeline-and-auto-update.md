# ADR 0059: Releases are published images that self-hosted instances install themselves

Date: 2026-09-09
Status: Accepted. Supersedes the consequence of ADR 0055 that read "a registry-based image
path can be added later without changing the shape"; the rest of ADR 0055 stands.

## Context

Until now a release meant building the image on the host. The single-node flow
(`infra/scripts/single-node-release.sh`) uploaded a `git archive` of one commit to a
private bucket and the host ran `docker compose up -d --build`, which took ten to fifteen
minutes on a `t4g.large`, needed a swapfile, and happened only when the operator ran the
script. Generic Compose installs (`README.md`) built the image the same way and had no
update path at all beyond `git pull` and another build.

The repository is now public (`github.com/AgentCommonsDev/agentcommons`, Apache 2.0) and
the product is meant to be self-hosted by other teams as well as run as a hosted service.
The owner asked for a mechanism that builds releases from `main`, lets the AWS instance
fetch and install them automatically, makes that the standard for every self-hosted
install unless the person installing opts out (and lets them change their mind later), and
holds no AWS keys so the same mechanism works for anyone.

## Decision

1. **A release is an image.** `.github/workflows/release.yml` runs after the CI workflow
   completes successfully on `main` (and on `workflow_dispatch` from `main`). It builds the
   existing `Dockerfile` for `linux/amd64` and `linux/arm64`, pushes it to
   `ghcr.io/<owner>/agentcommons` with the tags `sha-<12-hex commit>` and `stable`, sets the
   OCI `source`, `revision` and `created` labels, bakes the commit into the image as
   `AGENTCOMMONS_VERSION`, and signs the pushed digest with Sigstore keyless signing
   (`cosign sign --yes`). The workflow's permissions are `contents: read`,
   `packages: write`, `id-token: write`; its only credential is the workflow's own
   `GITHUB_TOKEN`. No cloud account is involved.
2. **Compose consumes the published image.** `docker-compose.yml` names the image as
   `${AGENTCOMMONS_IMAGE:-ghcr.io/agentcommonsdev/agentcommons:stable}` and keeps its
   `build:` block, so `docker compose build` still works for development and the Compose
   end-to-end test, which sets `AGENTCOMMONS_IMAGE` to a local tag. `.env.example`
   documents `AGENTCOMMONS_IMAGE` (empty for the stable release, a `sha-` tag to pin) and
   `AUTO_UPDATE=true`.
3. **Hosts update themselves.** `scripts/self-host/agentcommons-update.sh` with the
   systemd units in `scripts/self-host/systemd/` runs hourly (`OnCalendar=hourly`,
   `RandomizedDelaySec=15m`, `Persistent=true`). It exits quietly unless the stack's `.env`
   says `AUTO_UPDATE=true`, pulls the image Compose resolves, and stops when its digest
   matches the running API container. Otherwise it tags the running image
   `agentcommons:previous`, starts the stack (the migration service runs before the API),
   waits for `/ready`, and on failure restores the previous image with `--no-deps`, exits
   non-zero so the journal shows it, and holds that release until a newer one is published.
   `--now` forces a check regardless of `AUTO_UPDATE`; `--status` prints the running
   version, the configured and pulled images and the last result from
   `/var/lib/agentcommons/update-state`. The steps shared with the single-node apply
   (pull or build, start, readiness, Caddy restart, `.env` reading, locking) live once in
   `scripts/self-host/lib.sh`, which `infra/scripts/single-node/host-lib.sh` sources.
4. **The single-node shape adopts it.** `apply.sh` pulls `AGENTCOMMONS_IMAGE` instead of
   building (`--build`, or `AGENTCOMMONS_BUILD=true` through the release wrapper, remains
   for a host without registry access), writes `COMPOSE_FILE` into the rendered `.env` so the
   updater and the apply step run the same Compose files, installs the updater and its units
   into `/opt/agentcommons` and `/etc/systemd/system`, and enables the timer. A new stack
   setting `autoUpdate` (default `true`) renders `AUTO_UPDATE` into `.env`.
   `single-node-release.sh` remains the path for changes to the checkout itself (Compose
   files, mounted configuration, host scripts) and for re-rendering `.env`.
5. **The server reports its version.** `GET /api/v1/admin/status` and the MCP `status` tool
   return `server: { version, auto_update }` from `AGENTCOMMONS_VERSION` (default
   `development`) and `AUTO_UPDATE` (default `true`); Admin → Status shows both.

## Consequences

- Releases are continuous: every green `main` commit moves `stable`. There is no separate
  release cadence or changelog gate; a host that needs one sets `AGENTCOMMONS_IMAGE` to a
  `sha-` tag and moves it deliberately.
- The image is public. The package on ghcr.io must be set to public visibility once by the
  repository owner after the first push; `docker compose pull` then needs no login. The
  signature can be checked with `cosign verify` against the workflow identity
  `https://github.com/AgentCommonsDev/agentcommons/.github/workflows/release.yml@refs/heads/main`
  and issuer `https://token.actions.githubusercontent.com`. The updater does not verify the
  signature itself yet (open question below).
- The host no longer compiles anything: an update is a pull of about a minute plus the
  migration and restart. The swapfile and the build memory budget stay for `--build`.
- An hourly pull means up to an hour plus the random delay between a release and its
  installation. A failed release rolls the API back but not the database: migrations must
  stay compatible with the previous image, the same rule the Fargate shape already has.
- The updater replaces the application image only. Compose files, Caddy configuration,
  ClickHouse and PostgreSQL settings are bind-mounted from the checkout and change only
  with `single-node-release.sh <commit>` (single-node) or `git pull` (generic install).
- Opting out is a `.env` change (`AUTO_UPDATE=false`, or `autoUpdate: false` in the Pulumi
  stack) and takes effect at the next timer run; the timer keeps running so opting back
  in is the same edit. `agentcommons-update.sh --now` updates on demand in either state.
- Open questions: whether the updater should verify the Sigstore signature before starting
  a release (needs `cosign` on the host), and whether a maintenance window setting is
  wanted for hosts that prefer updates at night.

## Amendment 2026-09-11: a floating tag never moves a host backwards

Incident. The hosted instance was released by hand several times on 2026-09-11 with
`single-node-release.sh <commit> --build` (images built on the host, versions 9bcb208 →
048d978) while the GHCR package, made public that morning, still held only the first
CI-published image, 84f9941. At 17:01 UTC the hourly updater pulled `:stable`, saw a digest
that differed from the running image and swapped production back to 84f9941
(`last_result=updated`); it would have repeated every hour. The served hook bundle went
backwards with it, so every client machine stayed on a bundle whose MCP registration was
broken. The stop-gap was `AUTO_UPDATE=false` and a re-release.

Decision 3 compared digests only, so "different" meant "new". It now compares releases:

- Both build paths stamp the image with the full commit and an RFC 3339 build time. The
  Dockerfile arguments `AGENTCOMMONS_REVISION` and `AGENTCOMMONS_CREATED` become the OCI
  labels `org.opencontainers.image.revision` and `org.opencontainers.image.created`; the
  release workflow passes them as build arguments (it no longer sets those two labels
  itself), and `stack_up build` derives them from the archive's `.commit` file, else the
  checkout's git HEAD, and the clock. Only `AGENTCOMMONS_VERSION` was stamped before.
- For a floating tag the updater installs the pulled image only when its `created` is
  later than the running image's and its revision differs. An older or equal build is held
  (`held-newer-running`), a rebuild of the running commit is not installed
  (`same-release`), and a stamp missing or unreadable on either side holds as unknown
  (`held-unknown-age`) rather than swapping blindly. A hold is a completed check: nothing
  is touched, both stamps are recorded in the state file, and `--status` and Admin →
  Status show both releases (commit and build time) and the reason.
- `AGENTCOMMONS_IMAGE` set to a `sha-` tag or a digest is a pin and is installed as
  configured, older or not. Any other reference, including an explicit `:stable`, is
  compared.
- With no API container running there is nothing to protect; the stack starts.

Consequences added:

- A hand release with `--build` is newer than `stable` until CI publishes that commit. In
  that window every hourly run records `held-newer-running` and leaves the host alone;
  the updater resumes on its own when CI publishes a later build of another commit.
  Setting `AUTO_UPDATE=false` around a hand release is no longer needed.
- A re-run of the release workflow for the commit a host already runs is not installed;
  the commit decides, not the digest.
- An image without the stamp (a plain `docker compose build`, or any image built before
  this amendment) is never replaced automatically and never installed automatically. A
  host running such an image needs one release by hand (`single-node-release.sh`, or
  `docker compose pull && docker compose up -d`) to reach a stamped release; Admin →
  Status shows `Release age unknown` until then. The hosted instance itself was in this
  state after the incident: its hand-built 048d978 carried no stamp.
- Order is build time, not commit ancestry, because the updater sees images, not history.
  Both builders stamp UTC from their own clocks, which is what the operator sees too.
