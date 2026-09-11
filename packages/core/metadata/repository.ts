/**
 * The canonical repository identity the whole system keys on: `host/owner/repo`, lower-cased
 * host, no `.git`, from any HTTPS, SSH, git or scp-style remote. It lives in a leaf module
 * with no imports because the zero-dependency hook bundle uses it to name the repository
 * whose recall hint it caches (§6.2); everything else reads it through `metadata/index.ts`.
 */
export function repositoryIdentity(remote: string | null): {
  repoName: string | null;
  repoUrl: string | null;
} {
  if (!remote) return { repoName: null, repoUrl: null };
  const scp = /^(?:[^@/]+@)?([^/:]+):([^/].*)$/.exec(remote);
  try {
    const url = new URL(
      scp && !remote.includes("://")
        ? `ssh://${scp[1] ?? ""}/${scp[2] ?? ""}`
        : remote,
    );
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol))
      return { repoName: null, repoUrl: null };
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    if (!url.hostname || !path) return { repoName: null, repoUrl: null };
    const canonical = `${url.host.toLowerCase()}/${path}`;
    return { repoName: canonical, repoUrl: canonical };
  } catch {
    return { repoName: null, repoUrl: null };
  }
}
