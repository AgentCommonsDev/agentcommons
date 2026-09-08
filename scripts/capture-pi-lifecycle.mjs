// Run the native pi SDK through tree navigation, fork, resume, and shutdown.
// GEMINI_API_KEY and AGENTCOMMONS_CAPTURE_DIR are supplied by the caller.
import capture from "./capture-pi.mjs";
import { piLifecycle } from "./pi-lifecycle.mjs";

const packageDirectory = process.argv[2];
const directory = process.env.AGENTCOMMONS_CAPTURE_DIR;
if (!packageDirectory || !directory)
  throw new Error("pi package and capture directory are required");
await piLifecycle({
  packageDirectory,
  directory,
  extension: capture,
  prompt: "Use read to read probe.txt. Return the file content.",
});
