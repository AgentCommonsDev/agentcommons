import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../..", import.meta.url));

// @req R-SDK-03
it("installs the npm tarball into a standalone typed consumer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcommons-sdk-consumer-"));
  try {
    const archive = join(directory, "sdk.tgz");
    await exec(
      "pnpm",
      ["--filter", "@agentcommons/sdk", "pack", "--out", archive],
      { cwd: root },
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@agentcommons/sdk": `file:${archive}` },
      }),
    );
    await exec(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: directory },
    );
    await writeFile(
      join(directory, "consumer.ts"),
      `
import { createClient, unwrap, type JsonValue, type paths } from "@agentcommons/sdk";
const client = createClient({ baseUrl: "https://api.example.test", apiKey: "example-key" });
const query: paths["/api/v1/search"]["post"]["requestBody"]["content"]["application/json"] = { query: "timeout" };
async function search() {
  const result = unwrap(await client.POST("/api/v1/search", { body: query }));
  const count: number = result.total.hits;
  return count;
}
const json: JsonValue = { nested: [null, true, 42, "value"] };
// @ts-expect-error Request fields are generated and reject incorrect types.
const invalid: typeof query = { query: 42 };
// @ts-expect-error Endpoint paths are generated and reject unknown routes.
type UnknownRoute = paths["/does-not-exist"];
void [search, json, invalid];
`,
    );
    await exec(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "--strict",
        "--exactOptionalPropertyTypes",
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "consumer.ts",
      ],
      { cwd: directory },
    );
    const { stdout } = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
import { createClient, unwrap } from "@agentcommons/sdk";
const client = createClient({baseUrl: "https://api.example.test", fetch: async request => {
  if (request.url !== "https://api.example.test/api/v1/health") throw new Error("wrong URL");
  return Response.json({status: "ok"});
}});
console.log(unwrap(await client.GET("/api/v1/health")).status);
`,
      ],
      { cwd: directory },
    );
    expect(stdout.trim()).toBe("ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
