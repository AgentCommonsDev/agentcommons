import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { secureDirectory } from "./files.js";

/** The data directory shared by the shim and the pi extension (`install.sh` sets the same default). */
export function dataDirectory(): string {
  return process.env.AGENTCOMMONS_DIR
    ? resolve(process.env.AGENTCOMMONS_DIR)
    : join(homedir(), ".agentcommons");
}
/** Appends one timestamped line to `hook.log`. Best effort: a log that cannot be written never interrupts capture. */
export function note(directory: string, message: string): void {
  try {
    secureDirectory(directory);
    appendFileSync(
      join(directory, "hook.log"),
      `${new Date().toISOString()} ${message}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* The log is best effort. */
  }
}
