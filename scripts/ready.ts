import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Polls `origin`/ready until it answers 200. Fails at the deadline, or as soon as the
 * `child` serving it has exited (`childLog` names where its output went).
 */
export async function waitForReady(
  origin: string,
  options: {
    subject: string;
    timeoutMs: number;
    child?: ChildProcess;
    childLog?: string;
  },
) {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const child = options.child;
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(
        `${options.subject} failed${options.childLog ? `; inspect ${options.childLog}` : ""}.`,
      );
    try {
      if (
        (await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(1000) }))
          .ok
      )
        return;
    } catch {
      /* Wait only for this process's own disposable server. */
    }
    if (Date.now() > deadline)
      throw new Error(`${options.subject} did not become ready.`);
    await delay(500);
  }
}
