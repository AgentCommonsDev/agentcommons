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
export function writeExclusive(path: string, value: unknown): boolean {
  if (existsSync(path)) return false;
  secureDirectory(dirname(path));
  const temp = `${path}.${randomUUID()}.claim`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
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
export function writeAtomic(path: string, value: unknown): void {
  secureDirectory(dirname(path));
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    if (!writeExclusive(temp, value))
      throw new Error("The temporary file already exists.");
    renameSync(temp, path);
    syncDirectory(dirname(path));
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
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
