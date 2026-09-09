import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";

export const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
export function secureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
function syncDirectory(path: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (error) {
    if (!isCode(error, "EINVAL") && !isCode(error, "ENOTSUP")) throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
export function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
/** Publishes complete fsynced bytes under `path` with an atomic hard link (§6.2). */
function publishExclusive(path: string, text: string): boolean {
  if (existsSync(path)) return false;
  const temp = `${path}.${randomUUID()}.claim`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    try {
      linkSync(temp, path);
    } catch (error) {
      if (isCode(error, "EEXIST")) return false;
      throw error;
    }
    syncDirectory(dirname(path));
    return true;
  } finally {
    unlinkSync(temp);
  }
}
/** Replaces `path` through a temporary file in the same directory, then fsyncs the directory. */
function replaceAtomically(path: string, text: string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    if (!publishExclusive(temp, text))
      throw new Error("The temporary file already exists.");
    renameSync(temp, path);
    syncDirectory(dirname(path));
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export function writeExclusive(path: string, value: unknown): boolean {
  if (existsSync(path)) return false;
  secureDirectory(dirname(path));
  return publishExclusive(path, JSON.stringify(value));
}
export function writeAtomic(path: string, value: unknown): void {
  secureDirectory(dirname(path));
  replaceAtomically(path, JSON.stringify(value));
}
/**
 * Files outside the data directory that the installer edits in place (harness settings,
 * instructions, shell rc): a missing parent is created, an existing one keeps its mode.
 */
export function writeUserFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  replaceAtomically(path, text);
}
export function removeFile(path: string): void {
  try {
    unlinkSync(path);
    syncDirectory(dirname(path));
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
}
export function readJson<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
/** `readJson`, with `fallback` for a file that does not exist; every other failure throws. */
export function readJsonOr<T, F>(
  path: string,
  schema: z.ZodType<T>,
  fallback: F,
): T | F {
  try {
    return readJson(path, schema);
  } catch (error) {
    if (isCode(error, "ENOENT")) return fallback;
    throw error;
  }
}
export function jsonNames(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (isCode(error, "ENOENT")) return [];
    throw error;
  }
}
export function jsonFiles(directory: string): string[] {
  return jsonNames(directory).map((name) => join(directory, name));
}
