import {
  accessSync,
  constants,
  lstatSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as z from "zod";
import {
  guidanceMarkers,
  repositoryInstructions,
} from "@agentcommons/core/format/install";
import { replaceMarkedBlock } from "./blocks.js";
import type { HookConfig } from "./config.js";
import { hash, isCode, readJsonOr, writeAtomic } from "./files.js";
import { HARNESSES } from "./harnesses.js";
import { note } from "./paths.js";
import {
  repositoryFromCwd,
  repositoryKey,
  type Repository,
} from "./repository.js";

// ---------------------------------------------------------------------------------------
// Repository instructions files (data in HARNESSES)
// ---------------------------------------------------------------------------------------
/** The one repository file the block is written to: the name most harnesses read (`AGENTS.md`). */
export function primaryRepositoryInstructionsFile(): string {
  const counts = new Map<string, number>();
  for (const definition of Object.values(HARNESSES))
    counts.set(
      definition.repositoryInstructionsFile,
      (counts.get(definition.repositoryInstructionsFile) ?? 0) + 1,
    );
  return (
    [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? "AGENTS.md"
  );
}
/** Every other instructions file a supported harness reads from a repository root, sorted. */
function secondaryRepositoryInstructionsFiles(primary: string): string[] {
  const names = new Set(
    Object.values(HARNESSES).map((d) => d.repositoryInstructionsFile),
  );
  names.delete(primary);
  return [...names].sort();
}
type Entry =
  | { kind: "missing" }
  | { kind: "file"; path: string }
  | { kind: "symlink"; target: string | null }
  | { kind: "other" };
const inside = (root: string, path: string): boolean => {
  const step = relative(root, path);
  return (
    step !== "" &&
    !step.startsWith(`..${sep}`) &&
    step !== ".." &&
    !isAbsolute(step)
  );
};
/**
 * What `name` is at the repository root. A symlink resolves to its target only when the
 * target is a regular file inside the repository; a link that leaves the repository is
 * never followed, so the shim can never write outside the checkout it was run in.
 */
function entryAt(root: string, name: string): Entry {
  const path = join(root, name);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isCode(error, "ENOENT")) return { kind: "missing" };
    throw error;
  }
  if (stat.isFile()) return { kind: "file", path };
  if (!stat.isSymbolicLink()) return { kind: "other" };
  try {
    const target = realpathSync(path);
    const realRoot = realpathSync(root);
    return {
      kind: "symlink",
      target:
        inside(realRoot, target) && lstatSync(target).isFile() ? target : null,
    };
  } catch {
    return { kind: "symlink", target: null }; // Dangling: nothing to write through.
  }
}
interface RepositoryGuidance {
  /** Files that now carry the block. */
  written: string[];
  /** Files created as symlinks to the written file. */
  linked: string[];
  /** Files whose bytes this call changed (what there is to commit). */
  changed: string[];
  /** Files left alone because they are not regular files inside the repository. */
  skipped: string[];
}
/**
 * Writes the §8.3 repository guidance into the instructions files the supported harnesses
 * read from a repository root (`repositoryInstructionsFile` in HARNESSES). `AGENTS.md`
 * receives the marker-delimited block (through a symlink only when it points at a regular
 * file inside the repository); every other name is created as a symlink to it when absent
 * (a regular file carrying the block where the platform refuses symlinks), receives its own
 * block when it is a regular file, and is left alone when it is already a symlink (this
 * repository links `CLAUDE.md` and `GEMINI.md` to `AGENTS.md`). Everything outside the
 * markers is kept, so the write is idempotent and safe to repeat.
 */
export function writeRepositoryGuidance(root: string): RepositoryGuidance {
  const primary = primaryRepositoryInstructionsFile();
  const result: RepositoryGuidance = {
    written: [],
    linked: [],
    changed: [],
    skipped: [],
  };
  const write = (name: string, path: string) => {
    if (replaceMarkedBlock(path, guidanceMarkers, repositoryInstructions))
      result.changed.push(join(root, name));
    result.written.push(join(root, name));
  };
  const head = entryAt(root, primary);
  if (head.kind === "missing" || head.kind === "file")
    write(primary, join(root, primary));
  else if (head.kind === "symlink" && head.target) write(primary, head.target);
  else {
    // Without a primary file to link to, the other names must not be created either.
    result.skipped.push(join(root, primary));
    return result;
  }
  for (const name of secondaryRepositoryInstructionsFiles(primary)) {
    const entry = entryAt(root, name);
    const path = join(root, name);
    if (entry.kind === "missing") {
      try {
        symlinkSync(primary, path);
        result.linked.push(path);
      } catch {
        // No symlinks here (a Windows checkout without developer mode): a file with the block.
        write(name, path);
      }
    } else if (entry.kind === "file") write(name, path);
    else result.skipped.push(path);
  }
  return result;
}
/**
 * Removes the block from every regular instructions file at the root (`guidance --off`)
 * and unlinks a symlink to the primary file that the removal left dangling. Files the
 * user wrote keep every byte outside the markers.
 */
export function removeRepositoryGuidance(root: string): string[] {
  const primary = primaryRepositoryInstructionsFile();
  const removed: string[] = [];
  const remove = (name: string, path: string) => {
    if (replaceMarkedBlock(path, guidanceMarkers, null))
      removed.push(join(root, name));
  };
  const head = entryAt(root, primary);
  if (head.kind === "file") remove(primary, head.path);
  else if (head.kind === "symlink" && head.target) remove(primary, head.target);
  for (const name of secondaryRepositoryInstructionsFiles(primary)) {
    const entry = entryAt(root, name);
    const path = join(root, name);
    if (entry.kind === "file") remove(name, path);
    else if (entry.kind === "symlink" && entry.target === null) {
      // A link we made to AGENTS.md now points at nothing: take it with the block.
      let pointsAtPrimary = false;
      try {
        pointsAtPrimary =
          resolve(root, readlinkSync(path)) === join(root, primary);
      } catch {
        /* Unreadable link: leave it. */
      }
      if (pointsAtPrimary) {
        unlinkSync(path);
        removed.push(path);
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------------------
// Per-repository decisions (the hook state directory)
// ---------------------------------------------------------------------------------------
/** The block text this bundle writes, so a release with new text re-applies it once. */
export const repositoryBlockHash = (): string => hash(repositoryInstructions);
// Loose on purpose (like update.json): a newer bundle may add fields, and hook mode of an
// older one flips `announce` with a read-modify-write.
const decisionSchema = z.looseObject({
  v: z.literal(1),
  /** `repositoryKey`: the remote's canonical name, else the resolved root. */
  repository: z.string().min(1),
  /** The checkout the decision was last applied in. */
  root: z.string().min(1),
  decision: z.enum(["written", "declined"]),
  /** Hash of the block text applied; null once declined. */
  blockHash: z.string().nullable(),
  /** Instructions file names that carry or link to the block after the last write. */
  files: z.array(z.string()),
  /** The next hinted hook event tells the model once what was written (§6.2). */
  announce: z.boolean(),
  at: z.number(),
});
type GuidanceDecision = z.infer<typeof decisionSchema>;
/** One small file per repository under the data directory, keyed by the hashed repository key. */
export function guidanceDecisionPath(directory: string, key: string): string {
  return join(directory, "guidance", `${hash(key)}.json`);
}
export function readGuidanceDecision(
  directory: string,
  key: string,
): GuidanceDecision | null {
  try {
    return readJsonOr(
      guidanceDecisionPath(directory, key),
      decisionSchema,
      null,
    );
  } catch {
    return null;
  }
}
function record(
  directory: string,
  repository: Repository,
  decision: Pick<
    GuidanceDecision,
    "decision" | "blockHash" | "files" | "announce"
  >,
): GuidanceDecision {
  const key = repositoryKey(repository);
  const value: GuidanceDecision = {
    v: 1,
    repository: key,
    root: repository.root,
    at: Date.now(),
    ...decision,
  };
  writeAtomic(guidanceDecisionPath(directory, key), value);
  return value;
}
/** The checkout `hook.js guidance` runs against: the enclosing repository, else the path itself. */
function repositoryAt(root: string): Repository {
  return repositoryFromCwd(root) ?? { root: resolve(root), remoteUrl: null };
}
/**
 * The command run by a person: the write is recorded so the uploader neither repeats it
 * nor announces it, and `--off` records the choice the uploader honours from then on.
 */
export function recordGuidanceCommand(
  directory: string,
  root: string,
  decision: "written" | "declined",
  files: readonly string[],
): void {
  record(directory, repositoryAt(root), {
    decision,
    blockHash: decision === "written" ? repositoryBlockHash() : null,
    files: files.map((file) => basename(file)),
    announce: false,
  });
}

// ---------------------------------------------------------------------------------------
// Upload mode: the automatic write
// ---------------------------------------------------------------------------------------
/**
 * Whether the uploader may write the block into repositories on this machine:
 * `AGENTCOMMONS_GUIDANCE_AUTO` (`0` off, `1` on) overrides `guidance.auto` in config.json,
 * which defaults to on.
 */
function autoGuidanceEnabled(
  config: HookConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.AGENTCOMMONS_GUIDANCE_AUTO;
  if (override === "0") return false;
  if (override === "1") return true;
  return config.guidance.auto;
}
/** A checkout the uploader writes into: a writable working tree root with its own `.git`, outside `node_modules`. */
function eligibleCheckout(root: string): boolean {
  try {
    if (!lstatSync(root).isDirectory()) return false;
    if (root.split(sep).includes("node_modules")) return false;
    lstatSync(join(root, ".git")); // A directory, or a linked worktree's `gitdir:` file.
    accessSync(root, constants.W_OK);
    return true;
  } catch {
    return false; // Missing, unreadable, read-only, or a bare repository (no working tree).
  }
}
type GuidanceOutcome =
  "written" | "current" | "declined" | "disabled" | "skipped";
/**
 * Upload mode only, after the drain: the first uploader run of a session inside a
 * checkout writes the §8.3 repository block into the checkout's instructions files, once
 * per repository (`guidance/<sha256(key)>.json` in the data directory). A recorded
 * `declined` (from `guidance --off`) or a `written` with this bundle's block hash ends the
 * call before any repository file is read; a differing hash (a release changed the text)
 * refreshes the block in place. Bare repositories never reach here (no working tree
 * root), and a root that is missing, read-only, inside `node_modules` or without its own
 * `.git` is skipped quietly. Nothing here touches the network, `pending` or `ackedCursor`.
 */
export function applyRepositoryGuidance(
  directory: string,
  config: HookConfig,
  repository: Repository | null,
): GuidanceOutcome {
  if (!repository) return "skipped";
  if (!autoGuidanceEnabled(config)) return "disabled";
  const key = repositoryKey(repository);
  const decision = readGuidanceDecision(directory, key);
  if (decision?.decision === "declined") return "declined";
  const blockHash = repositoryBlockHash();
  if (decision?.decision === "written" && decision.blockHash === blockHash)
    return "current";
  if (!eligibleCheckout(repository.root)) return "skipped";
  let result: RepositoryGuidance;
  try {
    result = writeRepositoryGuidance(repository.root);
  } catch (error) {
    // A checkout that turned read-only under us is left alone like one found read-only.
    if (!["EACCES", "EPERM", "EROFS"].some((code) => isCode(error, code)))
      note(
        directory,
        `Repository guidance skipped for ${repository.root}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    return "skipped";
  }
  if (!result.written.length) return "skipped";
  const added = [...result.changed, ...result.linked];
  record(directory, repository, {
    decision: "written",
    blockHash,
    files: [...result.written, ...result.linked].map((file) => basename(file)),
    announce: added.length > 0,
  });
  if (added.length)
    note(
      directory,
      `Repository guidance written in ${repository.root}: ${added.map((file) => basename(file)).join(", ")}. Commit these files so every teammate's agent reads it.`,
    );
  return "written";
}

// ---------------------------------------------------------------------------------------
// Hook mode: tell the model once
// ---------------------------------------------------------------------------------------
/** The one line the model and its user read after the uploader wrote the block (§6.2). */
export function guidanceAnnouncementText(files: readonly string[]): string {
  const primary = primaryRepositoryInstructionsFile();
  const others = files.filter((file) => file !== primary);
  return `AgentCommons guidance was added to ${primary}${others.length ? ` (with ${others.join("/")})` : ""}; commit it so every teammate's agent reads it.`;
}
/**
 * Hook mode. Reads the repository's decision file and, when the uploader left a write
 * to announce, clears the flag and returns the line; one small read, one write, once per
 * repository. Never touches a repository file.
 */
export function guidanceAnnouncement(
  directory: string,
  repository: Repository | null,
): string | null {
  if (!repository) return null;
  const key = repositoryKey(repository);
  const decision = readGuidanceDecision(directory, key);
  if (!decision || decision.decision !== "written" || !decision.announce)
    return null;
  writeAtomic(guidanceDecisionPath(directory, key), {
    ...decision,
    announce: false,
  });
  return guidanceAnnouncementText(decision.files);
}
