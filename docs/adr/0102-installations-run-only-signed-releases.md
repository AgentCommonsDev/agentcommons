# ADR 0102: Installations and hosts run only signed releases

Date: 2026-10-29
Status: Accepted. Completes ADR 0075 (its phase 2 is now the only mode) and answers the open
question ADR 0059 left about verifying image signatures on the host.

## Context

A read-only architecture review on 2026-10-29 ranked the hook self-update path as the most
serious security issue in the product. Every installed shim checks `/hook/manifest.json`
hourly and, when the digests differ, downloads the bundle the manifest names from the same
server, checks it against the manifest's digest, runs it (`selfTest`, with the user's full
environment), swaps it in and re-runs its `install`, which rewrites harness hooks, MCP entries
and instructions files. The digest and the bundle came from the same origin, and so did the
`builtAt` stamp the forward-only guard compares (ADR 0075). Whoever controls what the server
serves therefore ran code as every member within about two hours: the server operator, anyone
who could get an image onto the host, or anyone on the network path of an `http:` server URL.

The host side had the same shape one level up. The release workflow signs every image with
Sigstore (ADR 0059), but the hourly updater installed whatever `:stable` pointed to without
checking that signature, so a registry token could move production.

## Decision

1. **The release signs the hook manifest.** `packages/hook/sign.ts` writes an Ed25519
   signature over the exact bytes of `apps/api/public/hook/manifest.json` to
   `manifest.json.sig` (`{"signatures": ["<base64>"]}`). The Dockerfile runs it in its own
   step, with Node alone, with the key mounted as a BuildKit secret, so the key reaches no
   layer and no package manager or build tool. The release workflow passes the key from the
   `HOOK_SIGNING_KEY` secret of a GitHub environment named `release`, which the job targets;
   a guard step fails the release before anything is pushed when the secret is missing. A
   build without the key (`single-node-release.sh --build`, `docker compose build`) serves an
   unsigned manifest. `sign.ts` refuses a manifest without `builtAt`, so every signed manifest
   carries the stamp the forward-only guard compares; the `AGENTCOMMONS_MANIFEST_STAMP` gate
   is removed and every build stamps when it can (the phase 2 ADR 0075 planned; installs have
   read the manifest loosely since 2026-09-11).
2. **The bundle pins the public key and checks it first.** `packages/hook/src/release-keys.ts`
   lists the accepted keys. When the served digests differ from the installed files, the
   uploader fetches `/hook/manifest.json.sig` and acts on the manifest only when one listed key
   verifies one signature over the bytes it fetched; only then does it compare build stamps,
   download, check digests, self-test and swap. Matching digests change nothing and need no
   signature. `manifest.json.sig` is served `no-cache` like the manifest.
3. **The self-test reads the installation's configuration.** `hook.js version` loads
   `config.json` before printing its digest, so a release whose configuration schema rejects
   an installation (ADR 0103) fails the self-test instead of swapping in and failing open in
   every hook from then on.
4. **Forks and the canary bring their own key at build time.** `AGENTCOMMONS_HOOK_RELEASE_KEYS`
   (comma-separated SPKI keys) replaces `release-keys.ts` in that build's bundle only. The live
   canary generates a key per run, builds with it and signs the served manifest, so its
   stale-bundle swap passes the same check a release does. The release image build never sets
   it. A runtime override would let the environment choose whom to trust, so there is none.
5. **The host verifies the image signature before installing it.** `verify_signature` in
   `scripts/self-host/lib.sh` runs `cosign verify` from `ghcr.io/sigstore/cosign/cosign:v2.6.5`
   pinned by digest (Docker is the only host dependency) against the registry digest the image
   was pulled as, requiring the identity
   `https://github.com/AgentCommonsDev/agentcommons/.github/workflows/release.yml@refs/heads/main`
   from `https://token.actions.githubusercontent.com`. The updater checks it right before it
   would install (a hold or a current stack needs no network) and for pins too; a failure is
   recorded as `unverified`, counted as a failed run and retried next hour rather than held as a
   failed release. The single-node apply's pull path (`stack_up pull`) checks it as well.
   `AGENTCOMMONS_IMAGE_SIGNER` in `.env` names another workflow for a fork that publishes its
   own images. The release workflow pins the same cosign version for signing.

Key custody and rotation. The private key is a base64 PKCS#8 DER Ed25519 key
(`openssl genpkey -algorithm ed25519 -outform DER | base64`), stored only as the `release`
environment secret; the public key (`openssl pkey -inform DER -pubout -outform DER | base64`)
is committed in `release-keys.ts`. To rotate, release a bundle that lists both keys, signed by
the old one, wait until Admin → Installations shows installs current, then swap the secret and
drop the old key in a later release. An install that skipped the overlap release keeps its
bundle until it is reinstalled.

## Consequences

- A compromised server, a registry or CI token without the `release` environment, or a man in
  the middle can still serve anything, but installations no longer act on it: an unsigned or
  foreign-signed manifest is logged ("not signed by a release key") and the installed bundle
  stays. An older signed release is refused by its signed stamp once an installation has
  recorded one. The host refuses images the release workflow did not sign.
- Client code ships only through the release workflow. A hand release built on the host
  (`--build`) updates the server but not installations; they keep their bundle until a CI
  release ships. On 2026-10-29 `:stable` still held 84f9941 from 2026-09-11 and every Release
  run listed since 2026-09-20 was skipped because CI on `main` had not passed, so the hosted
  instance runs hand releases: CI has to publish again before installations move past the
  release that carries this change. That release itself reaches installations through the old
  digest-only path, so the hand release that deploys it still moves them once.
- Whoever can merge to `main` still controls what gets signed, because every green `main`
  commit releases. See the proposal below.
- The first install still trusts the server: `install.sh` comes from it, so it cannot check
  anything the server sends. Protection starts with the first self-update.
- The forward-only guard needs a stamp recorded by a swap; after a fresh install the first
  signed release is accepted at any age. A replay of an older signed release needs the server
  compromised and a release with a flaw worth returning to.
- Hosts now reach Sigstore's public services (Rekor, the TUF root) on every update. When they
  are unreachable the updater holds and retries hourly; Admin → Status shows "Signature check
  failed".
- The `environment: release` job pauses for approval if the environment is given required
  reviewers; with none it only restricts the secret to that job.

## Proposal, not adopted: release from tags

Signing removes the server, the registry and the network from the trust path, but every green
`main` commit is still signed and shipped within the hour, so merging to `main` is releasing to
every member's machine. Releasing from protected tags would separate the two: Release would run
on `push: tags: ['v*']` from tags only maintainers can create (a tag ruleset), the `release`
environment would require a maintainer's approval and accept only those tags, and the cosign
identity the updater pins would become `...release.yml@refs/tags/v*` (`--certificate-identity-
regexp`). That changes the release cadence ADR 0059 chose, so it waits for the maintainers.
