import { execFileSync } from "node:child_process";
import type { IngestEnvelope } from "@agentcommons/core/schemas/ingest";

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      timeout: 500,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}
/** HEAD as the reflog recorded it at `at`. The uploader collects git context after the
 * start hook, so a fast first commit would otherwise become the session's start commit
 * and hide itself from the end observation. Current HEAD when the reflog cannot answer. */
function headAt(cwd: string, at: string | undefined): string | null {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const time = at === undefined ? NaN : Math.floor(Date.parse(at) / 1000);
  if (!head || !Number.isFinite(time)) return head;
  const log = git(cwd, [
    "reflog",
    "show",
    "HEAD",
    "--format=%H%x00%gD",
    "--date=unix",
    "-n",
    "200",
  ]);
  for (const line of log ? log.split("\n") : []) {
    const [sha, selector] = line.split("\0");
    const moved = Number(/^HEAD@\{(\d+)\}$/.exec(selector ?? "")?.[1]);
    if (sha && Number.isFinite(moved) && moved <= time) return sha;
  }
  return head;
}
export function gitContext(
  cwd: string,
  at?: string,
): IngestEnvelope["context"]["git"] {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return root
    ? {
        root,
        remoteUrl: git(cwd, ["remote", "get-url", "origin"]),
        branch: git(cwd, ["symbolic-ref", "--short", "HEAD"]),
        head: headAt(cwd, at),
      }
    : null;
}
export function gitEnd(
  cwd: string,
  initialHead: string | null,
  reason: string | null,
): IngestEnvelope["end"] {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const log =
    initialHead && head && initialHead !== head
      ? git(cwd, [
          "log",
          "--format=%H%x00%s%x00%an%x00%aI",
          "--max-count=100",
          `${initialHead}..${head}`,
        ])
      : null;
  const commits = (log ? log.split("\n") : []).flatMap((line) => {
    const [sha, subject, author, time] = line.split("\0");
    if (!sha || subject === undefined || author === undefined || !time)
      return [];
    const parsed = new Date(time);
    return [
      {
        sha,
        subject,
        author,
        timestamp: Number.isFinite(parsed.getTime())
          ? parsed.toISOString()
          : null,
      },
    ];
  });
  const status = git(cwd, ["status", "--porcelain=v1", "-z"]);
  // NUL framing preserves filenames containing spaces or newlines. Renames add a second path.
  let dirtyFileCount: number | null = status === null ? null : 0;
  if (status) {
    const paths = status.split("\0");
    for (let index = 0; index < paths.length; index++) {
      const item = paths[index];
      if (!item) continue;
      dirtyFileCount = (dirtyFileCount ?? 0) + 1;
      if (/^[RC]|^.[RC]/.test(item)) index++;
    }
  }
  const stat =
    initialHead && head
      ? git(cwd, ["diff", "--numstat", "-z", initialHead, head, "--"])
      : null;
  let added = 0;
  let removed = 0;
  let files = 0;
  if (stat)
    for (const item of stat.split("\0")) {
      const match = /^(\d+|-)\t(\d+|-)\t/.exec(item);
      if (!match) continue;
      files++;
      added += Number(match[1]) || 0;
      removed += Number(match[2]) || 0;
    }
  return {
    reason,
    head,
    observedCommits: commits,
    observedDiffStat: stat === null ? null : { files, added, removed },
    dirtyFileCount,
  };
}
