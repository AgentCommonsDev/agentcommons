# ADR 0050: Installed hooks update themselves from the server manifest

Date: 2026-09-08
Status: Accepted. Extends ADR 0005 (detached uploader) and ADR 0023 (durable shim
journals and installed config); `install.sh` keeps the contract of §6.1.

## Context

Until now the only way to move a developer machine to a new `hook.js` was to re-run
`install.sh`. That does not scale: an organization has one hook per machine per member,
the server is upgraded far more often than people reinstall, and an old shim keeps
speaking an envelope the server may no longer want. Nobody knew which version a machine
ran; the dashboard could only show that an installation existed.

Three pieces already existed. The server publishes `/hook/manifest.json`
`{ version, sha256, url, extensionSha256, extensionUrl }` with `no-cache`, and serves the
artifacts under immutable `/hook/<version>/` paths whose `version` is
`0.1.0-<16 hex of the content hash>`. `install.sh` already verifies those digests. And
the uploader is the only detached, network-capable component of the shim: hook mode
must stay under 150 ms and never touch the network (§6.2).

## Decision

A shim identifies itself by the sha256 of its own `hook.js` bundle and of
`pi-extension.mjs`, the same digests the manifest publishes. Every ingest envelope
carries them as `hook: { sha256, extensionSha256 | null }` (`hookIdentitySchema`). The
server stores the digest on the installation (`installation.hook_sha256`) on every
upload; `api_ro.installations` and `installationSchema` expose it; Admin → Status
compares it with the manifest and shows "Current", "Update pending" or "Unknown".

The detached uploader updates the installation. At the end of an uploader run, at most
once per hour per installation (`update.json` in the data directory records the last
check), it GETs `/hook/manifest.json` from the configured server. When the digests
differ from the installed files it downloads the artifacts from the manifest URLs
resolved against the configured server origin (same origin only), with an 8 MB cap and
a 30 s timeout; verifies each sha256 against the manifest; runs the new bundle once as
`node <tmp> version` and requires it to print its own digest; then atomically renames
the files over `~/.agentcommons/hook.js` and `pi-extension.mjs`. An update lock with
liveness, from the same lock module the uploader uses, prevents concurrent updaters.
Harness settings keep pointing at the stable path, so the next hook invocation runs the
new version and running processes are unaffected. Any failure is written to `hook.log`
and ignored; pending batches and `ackedCursor` are untouched.

Hook mode never updates. `install.sh` is unchanged and remains the manual reinstall
for a fresh machine or a new key. `hook.js doctor` is unchanged.

## Alternatives considered

- Re-running `install.sh` from a fleet tool. Needs an agent on every machine that we do
  not control and does not tell the server what is installed.
- A version registry with semantic versions. Hash identity already answers "is this
  machine current" exactly and cannot drift from the served artifact.
- Updating from hook mode. Breaks the 150 ms, no-network contract of §6.2.
- Following manifest URLs to any origin, or trusting a download without a digest. The
  configured server is the only trust root; same-origin resolution and manifest
  digests keep it that way.

## Consequences

- Blast radius is bounded: a bad bundle fails the self-test and is never renamed into
  place; a partial download fails digest verification; a rename is atomic, so a hook
  never sees a half-written file. Capture continues on the old version.
- Update traffic is one small GET per installation per hour, only after an uploader
  actually ran. Idle machines never check.
- `installation.hook_sha256` is a new control column; the envelope gains a required
  `hook` object, so shims older than this change fail envelope validation and must be
  reinstalled once. After that, a new key is the only reason to re-run the installer on
  that machine.
- Requirements R-CAP-16, R-ING-16 and R-DASH-31 are added; the shim unit suite runs
  against a fake manifest server.
- Spec §5.1, §6.1, §6.2 (**Self-update**), §7.6 and §10 describe the contract.

## Addendum (2026-09-08): harness reconfiguration

A swapped bundle alone does not wire a newly supported harness. The uploader therefore
re-runs the installed bundle's `install` with the flags recorded at install time after
every swap and whenever a supported CLI appears that the last run did not wire. The
installer's marker-keyed merges, one-time backups and MCP rollback make this safe to run
unattended; shell rc files are never touched by these runs. This completes the fleet
story: one server deploy updates code and wiring on every machine within an hour.
