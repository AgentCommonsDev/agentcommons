import { loadConfig } from "../src/config.js";
import { upload } from "../src/upload.js";

const [directory, path, point] = process.argv.slice(2);
if (!directory || !path || !point) throw new Error("Missing worker arguments.");
await upload(
  directory,
  "/nonexistent-test-shim.js",
  path,
  loadConfig(directory),
  {
    sweep: false,
    checkpoint: async (current) => {
      if (current !== point) return;
      process.send?.(current);
      await new Promise<void>(() => {
        /* The parent kills this process at the boundary. */
      });
    },
  },
);
