import { readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { piLifecycle } from "./pi-lifecycle.mjs";

const inputPath = z.string().min(1).parse(process.argv[2]);
const input = z
  .strictObject({
    packageDirectory: z.string().min(1),
    directory: z.string().min(1),
    extension: z.string().min(1),
    prompt: z.string().min(1),
    output: z.string().min(1),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    tools: z.array(z.string().min(1)).min(1).nullable().optional(),
    modelsJson: z.record(z.string(), z.unknown()).optional(),
    mode: z.enum(["lifecycle", "prompt"]).optional(),
  })
  .parse(JSON.parse(await readFile(inputPath, "utf8")));
const extension = await import(pathToFileURL(input.extension).href);
const checkpoints = new Map();
const result = await piLifecycle({
  ...input,
  async extension(api) {
    // Observe the same native shutdown as the installed extension. Detached
    // collectors can outlive this SDK process, so process exit is not an ACK.
    api.on("session_shutdown", (_event, context) => {
      const path = context.sessionManager.getSessionFile();
      if (!path)
        throw new Error("Native shutdown has no persisted transcript.");
      const sessionId = context.sessionManager.getSessionId();
      checkpoints.set(sessionId, {
        sessionId,
        sourcePos: statSync(path).size,
        nativeEvent: "session_shutdown",
        activeLeafId: context.sessionManager.getLeafId(),
      });
    });
    // pi awaits extension factories; the installed extension registers the bridge
    // tools asynchronously, so the driver must await it the same way.
    await extension.default(api);
  },
});
await writeFile(
  input.output,
  JSON.stringify({ ...result, completion: [...checkpoints.values()] }),
  { mode: 0o600 },
);
