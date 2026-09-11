import { build } from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestStamp } from "./manifest-stamp.js";

const root = dirname(fileURLToPath(import.meta.url));
await mkdir(resolve(root, "dist"), { recursive: true });
await build({
  entryPoints: [resolve(root, "src/entry.ts")],
  outfile: resolve(root, "dist/hook.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  legalComments: "none",
});
await build({
  entryPoints: [resolve(root, "../pi-extension/src/index.ts")],
  outfile: resolve(root, "dist/pi-extension.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
});
const bytes = await readFile(resolve(root, "dist/hook.js"));
const extension = await readFile(resolve(root, "dist/pi-extension.mjs"));
const version = `0.1.0-${createHash("sha256").update(bytes).update(extension).digest("hex").slice(0, 16)}`;
const destination = resolve(root, "../../apps/api/public/hook", version);
await mkdir(destination, { recursive: true });
await writeFile(
  resolve(root, "dist/package.json"),
  JSON.stringify({ type: "commonjs" }),
);
async function publishImmutable(path: string, content: Buffer): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    if (!(await readFile(path)).equals(content))
      throw new Error("An immutable artifact already has different bytes.");
  }
}
await publishImmutable(resolve(destination, "hook.js"), bytes);
await publishImmutable(resolve(destination, "pi-extension.mjs"), extension);
const temporaryManifest = resolve(
  destination,
  `../manifest.${randomUUID()}.tmp`,
);
await writeFile(
  temporaryManifest,
  JSON.stringify({
    version,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `/hook/${version}/hook.js`,
    extensionSha256: createHash("sha256").update(extension).digest("hex"),
    extensionUrl: `/hook/${version}/pi-extension.mjs`,
    // Gated OFF by default (ADR 0075 rollout): today's five-field manifest unless
    // AGENTCOMMONS_MANIFEST_STAMP=1, so strict clients keep parsing until they heal onto
    // the loose schema.
    ...manifestStamp(process.env, root),
  }),
);

await rename(temporaryManifest, resolve(destination, "../manifest.json"));
