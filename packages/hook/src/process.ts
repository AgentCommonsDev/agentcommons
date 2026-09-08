import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { execFileSync } from "node:child_process";
import { isCode } from "./files.js";
import type { HarnessDefinition } from "./harnesses.js";

interface ProcessIdentity {
  pid: number;
  birth: string;
}
interface ProcessInfo extends ProcessIdentity {
  parent: number;
  command: string[];
}
function processInfo(pid: number): ProcessInfo | null {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const birth = fields[19];
      if (!birth || fields[0] === "Z") return null;
      const boot = readFileSync(
        "/proc/sys/kernel/random/boot_id",
        "utf8",
      ).trim();
      return {
        pid,
        birth: `${boot}:${birth}`,
        parent: Number(fields[1]),
        command: readFileSync(`/proc/${String(pid)}/cmdline`, "utf8")
          .split("\0")
          .filter(Boolean),
      };
    }
    const output = execFileSync(
      "ps",
      ["-p", String(pid), "-o", "ppid=,lstart=,command="],
      { encoding: "utf8", timeout: 40, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const match =
      /^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(
        output,
      );
    return match?.[2] && match[3]
      ? {
          pid,
          parent: Number(match[1]),
          birth: match[2],
          command: match[3].split(/\s+/),
        }
      : null;
  } catch {
    return null;
  }
}
export function selfIdentity(): ProcessIdentity {
  const identity = processInfo(process.pid);
  if (!identity)
    throw new Error("The uploader process identity is unavailable.");
  return { pid: identity.pid, birth: identity.birth };
}
export function isAlive(identity: ProcessIdentity): boolean {
  return processInfo(identity.pid)?.birth === identity.birth;
}
export function harnessIdentity(
  definition: HarnessDefinition,
): ProcessIdentity {
  let pid = process.ppid;
  const deadline = performance.now() + 70;
  let nearest: ProcessInfo | null = null;
  while (pid > 1 && performance.now() < deadline) {
    const info = processInfo(pid);
    if (!info) break;
    nearest ??= info;
    if (
      info.command
        .slice(0, 4)
        .some((argument) =>
          definition.processMarkers.some(
            (marker) =>
              basename(argument) === marker || argument.includes(`/${marker}/`),
          ),
        )
    )
      return { pid, birth: info.birth };
    pid = info.parent;
  }
  if (!nearest) return selfIdentity();
  return { pid: nearest.pid, birth: nearest.birth };
}
export async function terminateExpiredOwner(
  identity: ProcessIdentity,
): Promise<void> {
  if (!isAlive(identity)) return;
  if (identity.pid === process.pid)
    throw new Error("The uploader cannot reclaim its own active lock.");
  try {
    process.kill(identity.pid, "SIGTERM");
  } catch (error) {
    if (!isCode(error, "ESRCH")) throw error;
  }
  const deadline = Date.now() + 1000;
  while (isAlive(identity) && Date.now() < deadline)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  if (isAlive(identity)) {
    try {
      process.kill(identity.pid, "SIGKILL");
    } catch (error) {
      if (!isCode(error, "ESRCH")) throw error;
    }
  }
  const finalDeadline = Date.now() + 1000;
  while (isAlive(identity) && Date.now() < finalDeadline)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  if (isAlive(identity))
    throw new Error("The previous uploader has not exited.");
}
