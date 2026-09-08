import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import * as z from "zod";
import { expect, it } from "vitest";

const exec = promisify(execFile);
// @req R-INST-01 @req R-INST-02 @req R-INST-03 @req R-INST-04
it("installs in clean Node20 Debian with real bash, zsh, and fish", async () => {
  const tag = "agentcommons-installer-platform:node20";
  await exec(
    "docker",
    [
      "build",
      "-t",
      tag,
      "-f",
      resolve("packages/hook/test/Dockerfile.installer"),
      resolve("packages/hook/test"),
    ],
    { timeout: 300000, maxBuffer: 8 * 1024 * 1024 },
  );
  const { stdout } = await exec(
    "docker",
    [
      "run",
      "--rm",
      "--mount",
      `type=bind,src=${resolve("packages/hook/test/installer-platform.mjs")},dst=/test/installer-platform.mjs,readonly`,
      "--mount",
      `type=bind,src=${resolve("apps/api/public")},dst=/artifacts,readonly`,
      tag,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  const resultSchema = z.strictObject({
    platform: z.literal("linux"),
    node: z.string().regex(/^20\./),
    shell: z.enum(["bash", "zsh", "fish"]),
    installed: z.literal(true),
    rcParsed: z.literal(true),
    checksumRejected: z.literal(true),
    offlineUninstall: z.literal(true),
  });
  const results = stdout
    .trim()
    .split("\n")
    .map((line) => resultSchema.parse(JSON.parse(line) as unknown));
  expect(results.map((result) => result.shell)).toEqual([
    "bash",
    "zsh",
    "fish",
  ]);
}, 420000);
