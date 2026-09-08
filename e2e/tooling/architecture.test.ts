import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// @req R-ARCH-02 @req R-ARCH-05 @req R-DASH-08
it("rejects direct and computed adapter database access, harness branches, and literal UI labels", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons architecture "));
  try {
    const config = join(directory, "eslint.config.mjs");
    writeFileSync(
      config,
      `import { architecture } from ${JSON.stringify(new URL("../../scripts/eslint-architecture.js", import.meta.url).href)};
export default [{ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { architecture }, rules: {
"architecture/services-only": "error", "architecture/harness-data": "error", "architecture/public-copy-attributes": "error" }}];`,
    );
    const files = {
      "apps/api/src/routes/direct.js":
        'import { PrismaClient } from "@agentcommons/db"; export const db = new PrismaClient();',
      "apps/api/src/routes/computed.js":
        'export const execute = db => db["$queryRawUnsafe"]("SELECT 1");',
      "apps/api/src/mcp/dynamic.js":
        'export const adapter = () => import("../../repositories/read-model.js");',
      "packages/core/bad.js":
        'export const choose = request => request["harness"] === "PI" ? 1 : 2;',
      "apps/dashboard/labels.js":
        'export const button = <button aria-label="Delete everything" />;',
      "apps/api/src/routes/valid.js":
        "export const execute = service => service.execute({});",
      "packages/core/normalizers/valid.js":
        'export const normalize = record => record.harness === "PI";',
      "apps/dashboard/valid.js":
        "export const button = <button aria-label={copy.delete} />;",
    };
    const paths = Object.entries(files).map(([name, source]) => {
      const path = join(directory, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
      return path;
    });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../node_modules/eslint/bin/eslint.js", import.meta.url),
        ),
        "--no-config-lookup",
        "--config",
        config,
        "--format",
        "json",
        ...paths,
      ],
      { cwd: directory, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    const output: unknown = JSON.parse(result.stdout);
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: join(directory, "apps/api/src/routes/direct.js"),
          messages: [
            expect.objectContaining({ ruleId: "architecture/services-only" }),
          ],
        }),
        expect.objectContaining({
          filePath: join(directory, "apps/api/src/routes/computed.js"),
          messages: [
            expect.objectContaining({ ruleId: "architecture/services-only" }),
          ],
        }),
        expect.objectContaining({
          filePath: join(directory, "apps/api/src/mcp/dynamic.js"),
          messages: [
            expect.objectContaining({ ruleId: "architecture/services-only" }),
          ],
        }),
        expect.objectContaining({
          filePath: join(directory, "packages/core/bad.js"),
          messages: [
            expect.objectContaining({ ruleId: "architecture/harness-data" }),
          ],
        }),
        expect.objectContaining({
          filePath: join(directory, "apps/dashboard/labels.js"),
          messages: [
            expect.objectContaining({
              ruleId: "architecture/public-copy-attributes",
            }),
          ],
        }),
      ]),
    );
    for (const name of [
      "apps/api/src/routes/valid.js",
      "packages/core/normalizers/valid.js",
      "apps/dashboard/valid.js",
    ])
      expect(output).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: join(directory, name),
            messages: [],
          }),
        ]),
      );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
