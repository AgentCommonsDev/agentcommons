/**
 * The Ed25519 public keys (SPKI DER, base64) a shim accepts as the release signer (ADR 0102).
 * Self-update acts on `/hook/manifest.json` only when `/hook/manifest.json.sig` carries a
 * signature by one of them over the manifest's exact bytes. The private half exists only as
 * the release workflow's `release` environment secret, never on a server, so neither the
 * server, nor a CI token without that environment, nor anyone on the network can sign.
 * Rotation is two releases: one whose bundle lists the old and the new key, signed with the
 * old, then releases signed with the new. A fork or a canary build replaces this module
 * through `AGENTCOMMONS_HOOK_RELEASE_KEYS` (`build.ts`), so it holds nothing else.
 */
export const RELEASE_KEYS: readonly string[] = [
  "MCowBQYDK2VwAyEAqkDu/NtA46uwh+YkJQMBVU6ixOcoa9Atcur7FEwX+E0=",
];
