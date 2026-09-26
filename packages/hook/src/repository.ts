import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { repositoryIdentity } from "../../core/metadata/repository.js";

/** A checkout as the shim knows it: the working tree root and its `origin` remote. */
interface Repository {
  root: string;
  remoteUrl: string | null;
}
/** Bounds on what hook mode reads while locating a repository (§6.2 budget). */
const MAX_GIT_FILE_BYTES = 64 * 1024;
const MAX_WALK = 64;

function readBounded(path: string): string | null {
  try {
    if (statSync(path).size > MAX_GIT_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
/** The `url` of `[remote "origin"]` in a git config file, by a line scan. */
function originUrl(configText: string): string | null {
  let inOrigin = false;
  for (const raw of configText.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) inOrigin = /^\[remote\s+"origin"\]$/.test(line);
    else if (inOrigin) {
      const match = /^url\s*=\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}
/**
 * The repository of `cwd` from the working tree alone: walk up to `.git` (a directory,
 * or a worktree's `gitdir:` file whose common directory holds the config) and read
 * `remote.origin.url`. A few small file reads and no subprocess, so hook mode can use it
 * on the first event of a session, before the uploader has recorded git context, and in
 * a fresh clone of a repository other sessions already indexed.
 */
function repositoryFromCwd(cwd: string): Repository | null {
  let directory = resolve(cwd);
  for (let depth = 0; depth < MAX_WALK; depth++) {
    const dotGit = join(directory, ".git");
    let gitDirectory: string | null = null;
    try {
      const info = statSync(dotGit);
      if (info.isDirectory()) gitDirectory = dotGit;
      else {
        const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readBounded(dotGit) ?? "");
        if (pointer?.[1])
          gitDirectory = isAbsolute(pointer[1])
            ? pointer[1]
            : resolve(directory, pointer[1]);
      }
    } catch {
      /* Not a repository root; keep walking. */
    }
    if (gitDirectory) {
      const common = readBounded(join(gitDirectory, "commondir"))?.trim();
      const configDirectory = common
        ? isAbsolute(common)
          ? common
          : resolve(gitDirectory, common)
        : gitDirectory;
      const config = readBounded(join(configDirectory, "config"));
      return { root: directory, remoteUrl: config ? originUrl(config) : null };
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}
/**
 * This checkout's repository as it is now: the enclosing repository with the `origin`
 * its `.git/config` names today, else `path` itself with no remote. The one notion of
 * "the repository of this checkout" in the shim: the recall cache
 * and the hint request all resolve through it from a root or `cwd`, never from a remote
 * recorded earlier, which outlives a rename (the session state keeps the URL of its
 * first drain).
 */
export function repositoryAt(path: string): Repository {
  return repositoryFromCwd(path) ?? { root: resolve(path), remoteUrl: null };
}
/** The server's `repo_name` for a checkout's remote, so caches and list filters agree. */
export function repositoryName(
  repository: Pick<Repository, "remoteUrl"> | null,
): string | null {
  return repository ? repositoryIdentity(repository.remoteUrl).repoName : null;
}
export const repositoryNameFromCwd = (cwd: string): string | null =>
  repositoryName(repositoryFromCwd(cwd));
