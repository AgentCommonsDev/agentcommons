import { execFileSync } from "node:child_process";

interface ManifestStamp {
  builtAt?: string;
  revision?: string;
}

/**
 * The monotonic build stamp the served manifest carries so a client can refuse an older
 * bundle (ADR 0075); a release signature covers it, and `sign.ts` refuses a manifest without
 * it (ADR 0102). The value comes from the same stamp both release paths already pass — the
 * image's RFC 3339 `org.opencontainers.image.created`/`revision` (`AGENTCOMMONS_CREATED`/
 * `AGENTCOMMONS_REVISION`, ADR 0059) — so the manifest moves with the image; a local build
 * falls back to the HEAD commit and its committer date, deterministic per commit and never a
 * request-time clock; a build that can resolve neither omits the stamp and cannot be signed.
 */
export function manifestStamp(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ManifestStamp {
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
