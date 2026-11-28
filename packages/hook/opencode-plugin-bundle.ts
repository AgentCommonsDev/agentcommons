import { buildSync } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The opencode plugin as one ES module, for `hook.js` to carry as text: the installer writes
 * it into opencode's plugin folder, so self-update delivers it with no new manifest field.
 * The test configuration bundles it the same way, so tests install the real plugin.
 */
export function bundleOpencodePlugin(): string {
  const root = dirname(fileURLToPath(import.meta.url));
  const result = buildSync({
    entryPoints: [resolve(root, "../opencode-plugin/src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    minify: true,
    legalComments: "none",
    write: false,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("The opencode plugin bundle is empty.");
  return output.text;
}
