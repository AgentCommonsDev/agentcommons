import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import * as z from "zod";
import { isCode, readJson, removeFile, writeExclusive } from "./files.js";
import { isAlive, selfIdentity, terminateExpiredOwner } from "./process.js";

export const MAX_UPLOADER_MS = 5 * 60_000;
const ownerSchema = z.strictObject({
  pid: z.number().int().positive(),
  birth: z.string(),
  since: z.number(),
  token: z.uuid(),
});
export type Owner = z.infer<typeof ownerSchema>;
export interface Lock {
  owner: Owner;
  release(): void;
  assertOwned(): void;
}
function ownerAt(path: string): Owner | null {
  try {
    return readJson(path, ownerSchema);
  } catch (error) {
    if (isCode(error, "ENOENT")) return null;
    throw error;
  }
}
export function liveOwner(path: string): boolean {
  try {
    const owner = ownerAt(path);
    return (
      owner !== null &&
      Date.now() - owner.since <= MAX_UPLOADER_MS &&
      isAlive(owner)
    );
  } catch {
    try {
      return Date.now() - statSync(path).mtimeMs < 1000;
    } catch {
      return false;
    }
  }
}
export async function acquireLock(
  path: string,
  depth = 0,
): Promise<Lock | null> {
  if (depth > 32) throw new Error("Too many interrupted lock recoveries.");
  const owner: Owner = {
    ...selfIdentity(),
    since: Date.now(),
    token: randomUUID(),
  };
  if (!writeExclusive(path, owner)) {
    const previous = ownerAt(path);
    if (!previous) return acquireLock(path, depth + 1);
    if (isAlive(previous)) {
      if (Date.now() - previous.since <= MAX_UPLOADER_MS) return null;
      await terminateExpiredOwner(previous);
    }
    // Only one recovery may unlink this exact owner token. A recovery itself uses
    // the same protocol, so killing its process does not leave a permanent gate.
    const recovery = await acquireLock(
      `${path}.recover-${previous.token}`,
      depth + 1,
    );
    if (!recovery) return null;
    try {
      const current = ownerAt(path);
      if (current?.token === previous.token && !isAlive(current))
        removeFile(path);
      if (!writeExclusive(path, owner)) return null;
    } finally {
      recovery.release();
    }
  }
  const assertOwned = () => {
    if (ownerAt(path)?.token !== owner.token)
      throw new Error("The uploader no longer owns this session.");
  };
  return {
    owner,
    assertOwned,
    release() {
      if (ownerAt(path)?.token === owner.token) removeFile(path);
    },
  };
}
