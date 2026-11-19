# ADR 0075: The self-update client refuses an older hook bundle

Date: 2026-09-11
Status: Accepted. Extends ADR 0059 (releases are published images that self-hosted
instances install themselves) and its 2026-09-11 amendment (a floating tag never moves a
host backwards) to the hook shim's own self-update. ADR 0102 (2026-10-29) ends the rollout:
every build stamps its manifest, the gate is gone, and the stamp a shim compares is signed.

## Context

ADR 0059's amendment fixed a downgrade at the host: on 2026-09-11 the hosted instance was
released by hand to commits newer than the CI-published `:stable`, and the hourly host
updater, comparing image digests only, pulled `:stable` and rolled production back to an
older build. The served hook bundle went backwards with it, so every client machine that
checked `/hook/manifest.json` in the following hour saw a bundle whose sha differed from
its installed one and faithfully "healed" itself to the older, broken bundle.

The host now never installs an image whose build stamp is older than the running one. The
client had no such protection. `packages/hook/src/update.ts` compared
`installed.sha256 === manifest.sha256` and swapped on any difference, in either direction.
A server that serves an older bundle — a regression, a bad hand-release, a rollback, or a
tampered manifest — pulls every installation to it. The manifest carried no monotonic
stamp, so the client had nothing to compare but the digest, and a digest only says
"different", not "older".

## Decision

Add the host's never-downgrade rule at the client, as data on the same one code path.

1. **The served manifest can carry a build stamp, gated OFF by default.**
   `hookManifestSchema` gains optional `builtAt` (the image's RFC 3339 UTC
   `org.opencontainers.image.created`) and `revision` (its commit) — the same stamp both
   build paths already pass as `AGENTCOMMONS_CREATED` and `AGENTCOMMONS_REVISION` (ADR 0059
   amendment). The manifest producer (`packages/hook/build.ts`, via `manifestStamp()`)
   emits the fields **only when `AGENTCOMMONS_MANIFEST_STAMP=1`**; unset, it writes today's
   five-field manifest byte-shape. When emitting, it fills them from the build args, so the
   served bundle's stamp equals the image's; a local build without the args falls back to
   the HEAD commit and its committer date (deterministic, never a request-time clock), and
   a build that can resolve neither omits the stamp. The Dockerfile's `build` stage receives
   `AGENTCOMMONS_MANIFEST_STAMP` (default empty/off) and the two stamp args so a phase-2
   image stamps the manifest with one build-arg and no code change.

2. **The client refuses a strictly older build.** `selfUpdate` compares the installed
   bundle's recorded stamp with the manifest's `builtAt`. When both are present and the
   manifest's is strictly older, it does not download, self-test, or swap: it logs "offers
   an older hook build …; keeping the current one" and holds. The check runs before the
   download, so a manifest that lies about its digest cannot get past it. Equal, newer, or
   either stamp unknown falls back to the digest comparison as before, so a first upgrade
   (nothing recorded yet) and a legacy field-less manifest still update.

3. **The installed stamp is persisted.** A successful swap records the new bundle's stamp
   in `update.json` beside its digest (`installed: { sha256, builtAt }`), paired with the
   digest so a bundle replaced out of band is not compared against a stale stamp. The
   comparison then survives restarts.

4. **The manifest is read loosely.** `hookManifestSchema` becomes a loose object, like
   `update.json`, so a field a newer server adds survives an older installed shim's parse
   instead of failing it and stopping every self-update — the same forward-tolerance the
   wiring record already had.

There is no pin/override env at the shim: a self-hosted operator pins a version at the
image (`AGENTCOMMONS_IMAGE` to a `sha-` tag, ADR 0059), which the served bundle follows.

## Rollout

The client schema change and the field emission ship in the same commit but are turned on
in two ordered phases, because a shim already deployed with the previous **strict** schema
throws when it parses a manifest that carries the new fields — which would strand exactly
the installs this ADR protects.

1. **Phase 1 — deploy the loose client, stamp OFF.** `AGENTCOMMONS_MANIFEST_STAMP` is
   unset, so the server keeps serving today's five-field manifest. Every current install
   parses it and self-updates onto the new bundle, whose loose schema now ignores unknown
   fields. The client guard is present but never fires: no stamp is served, so both sides
   are unknown and the digest path runs, unchanged from before. This phase is safe to
   deploy immediately.
2. **Phase 2 — flip the stamp ON.** After the installation heal-status view (§10) confirms
   installs are on the loose bundle, a release passes `AGENTCOMMONS_MANIFEST_STAMP=1`. The
   manifest then carries `builtAt`/`revision`, and the monotonic guard activates: a client
   refuses any manifest whose stamp is strictly older than the bundle it installed.

Residual: a straggler that never healed to the loose bundle (an idle machine that ran no
session in phase 1) will throw parsing a phase-2 stamped manifest and stop self-updating.
Acceptable — it is the idle minority, it was already not updating, and `install.sh`
reinstalls it cleanly onto a current bundle.

## Consequences

- A server that regresses to an older bundle no longer pulls installations backwards once
  they have recorded a stamp. The 2026-09-11 failure mode is closed at both ends.
- The guard is defense in depth, not the primary fix: the host guard (ADR 0059) still
  prevents the server from regressing in the first place. Two independent checks now have
  to fail for a client to downgrade.
- Protection begins after the first stamped swap. A shim that has never recorded a stamp
  updates on the digest, as it must to reach a stamped bundle at all; this mirrors the host
  updater holding "age unknown" rather than blocking a first install.
- An image built without the stamp (a bare `docker compose build`) serves a field-less
  manifest; clients treat it as unknown and update on the digest, exactly as before this
  ADR. Stamps flow only from the release paths that already carry them.
- Already-deployed shims compiled against the previous strict manifest schema reject a
  manifest that carries the new fields until they update once to the loose schema. The
  two-phase rollout above closes that window before any field is served; the loose schema
  then prevents the next field addition from reopening it.
- Order is build time, not commit ancestry, because the client sees manifests, not history
  — the same choice and rationale as the host updater (ADR 0059 amendment).
