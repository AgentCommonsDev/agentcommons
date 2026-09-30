import { execFileSync } from "node:child_process";

interface ManifestStamp {
  builtAt?: string;
  revision?: string;
}

/**
 * The monotonic build stamp the served manifest carries so a client can refuse an older
 * bundle (ADR 0075). Emission is gated OFF by default: only `AGENTCOMMONS_MANIFEST_STAMP=1`
 * adds the fields. This makes the rollout two-phase (ADR 0075). Phase 1 ships the loose
 * client schema with the gate off, so `build.ts` writes today's five-field manifest and
 * every shim still parsing it strictly keeps updating while it heals onto the tolerant
 * parser. Phase 2 flips the gate once installs are on the loose bundle, and only then do the
 * fields appear and the client's never-downgrade guard activate.
 *
 * When on, the value comes from the same stamp both release paths already pass — the
 * image's RFC 3339 `org.opencontainers.image.created`/`revision` (`AGENTCOMMONS_CREATED`/
 * `AGENTCOMMONS_REVISION`, ADR 0059) — so the manifest moves with the image; a local build
 * falls back to the HEAD commit and its committer date, deterministic per commit and never a
 * request-time clock; a build that can resolve neither omits the stamp, and a client then
 * treats the manifest as unknown and updates on the digest.
 */
export function manifestStamp(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ManifestStamp {
  if (env.AGENTCOMMONS_MANIFEST_STAMP !== "1") return {};
  const git = (args: string[]): string | undefined => {
    try {
      const out = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return out === "" ? undefined : out;
    } catch {
      return undefined;
    }
  };
  const revision =
    env.AGENTCOMMONS_REVISION?.trim() || git(["rev-parse", "HEAD"]);
  const created = env.AGENTCOMMONS_CREATED?.trim();
  const source =
    created ||
    (revision ? git(["show", "-s", "--format=%cI", revision]) : undefined);
  const parsed = source ? new Date(source) : undefined;
  const builtAt =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : undefined;
  return {
    ...(builtAt ? { builtAt } : {}),
    ...(revision ? { revision } : {}),
  };
}
