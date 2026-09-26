import {
  lstatSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  guidanceMarkers,
  repositoryInstructions,
} from "@agentcommons/core/format/install";
import { replaceMarkedBlock } from "./blocks.js";
import { isCode } from "./files.js";
import { HARNESSES } from "./harnesses.js";

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
 * markers is kept, and a block that already says the same thing is left as it is however
 * a formatter laid it out (`replaceMarkedBlock`), so the write is idempotent and safe to
 * repeat.
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
