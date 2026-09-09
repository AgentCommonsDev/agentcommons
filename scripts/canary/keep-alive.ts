import { writeFile } from "node:fs/promises";
import type { Browser } from "@playwright/test";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { createApp } from "../../apps/api/src/app.js";
import type { createRuntime } from "../../apps/api/src/main.js";
import type { startMailpit } from "../../apps/api/test/mailpit.js";
import { cleanup } from "../cleanup.js";

/** Resources the orchestrator releases at the end; keep-alive may hand some over early. */
export interface CanaryHandles {
  runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  app: Awaited<ReturnType<typeof createApp>> | undefined;
  browser: Browser | undefined;
  mail: Awaited<ReturnType<typeof startMailpit>> | undefined;
  clients: Client[];
}

/**
 * CANARY_KEEP_RUNNING: leaves the API and its native corpus up for local inspection
 * until SIGINT or SIGTERM. SIGUSR2 stops only the API so another runtime can take over
 * the same stores; the databases stay until the process ends.
 */
export async function keepRunning(
  handles: CanaryHandles,
  input: {
    publicUrl: string;
    accessPath: string;
    access: Record<string, unknown>;
  },
) {
  await writeFile(
    input.accessPath,
    JSON.stringify(input.access, null, 2) + "\n",
    { mode: 0o600 },
  );
  await handles.browser?.close();
  handles.browser = undefined;
  for (const client of handles.clients.splice(0)) await client.close();
  console.log(
    `Native corpus retained at ${input.publicUrl}; private runtime access: ${input.accessPath}`,
  );
  // Local handoff may stop this API while another runtime keeps the same native stores.
  let detached: Promise<void> | undefined;
  const detach = () => {
    if (detached) return;
    const currentApp = handles.app;
    const currentRuntime = handles.runtime;
    handles.app = undefined;
    handles.runtime = undefined;
    detached = cleanup([
      async () => currentApp?.close(),
      async () => currentRuntime?.close(),
    ]).then((errors) => {
      if (errors.length) {
        process.stderr.write("Local canary API handoff cleanup failed.\n");
        process.exitCode = 1;
      }
    });
  };
  process.on("SIGUSR2", detach);
  const keepAlive = setInterval(() => {}, 60_000);
  try {
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } finally {
    clearInterval(keepAlive);
    process.off("SIGUSR2", detach);
    await detached;
  }
}
