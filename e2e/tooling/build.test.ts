import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";

it("native pnpm selects each downstream workspace and excludes the recursive root build", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = z
    .object({ scripts: z.object({ build: z.string() }) })
    .parse(
      JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ),
    );
  const phases = manifest.scripts.build.split(" && ");
  expect(phases).toHaveLength(2);
  expect(phases[0]).toBe("pnpm --filter @agentcommons/hook build");
  const downstream = phases[1];
  if (!downstream) throw new Error("Missing downstream build phase.");
  expect(downstream).toMatch(/^pnpm -r .* --if-present build$/);
  const filters = [
    ...downstream.matchAll(/--filter (?:'([^']+)'|"([^"]+)"|(\S+))/g),
  ]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .map((filter) => z.string().min(1).parse(filter));
  // Execute pnpm's real selector rather than assuming a negative selector excludes root.
  const selected = z.array(z.object({ name: z.string() })).parse(
    JSON.parse(
      execFileSync(
        "pnpm",
        [
          "-r",
          ...filters.flatMap((filter) => ["--filter", filter]),
          "list",
          "--depth",
          "-1",
          "--json",
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
        },
      ),
    ),
  );
  expect(selected.map((workspace) => workspace.name).sort()).toEqual([
    "@agentcommons/api",
    "@agentcommons/core",
    "@agentcommons/dashboard",
    "@agentcommons/db",
    "@agentcommons/infra",
    "@agentcommons/pi-extension",
    "@agentcommons/traces",
  ]);
});
