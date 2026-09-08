import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { configure, install } from "../src/install.js";

// @req R-INST-03
it("preserves unowned empty hook groups during install and uninstall", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-install-review-"));
  const home = join(directory, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const path = join(home, ".claude", "settings.json");
  const original = {
    hooks: { Stop: [{ matcher: "existing-empty", hooks: [] }] },
  };
  writeFileSync(path, JSON.stringify(original));
  const config = configure(join(directory, "collector"), {
    server: "http://localhost:3000",
    key: "test-credential",
  });
  const options = {
    configHome: home,
    noShellRc: true,
    harnesses: ["claude" as const],
  };
  install(join(directory, "collector"), config, options);
  const installed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const hooks = z
    .object({ hooks: z.object({ Stop: z.array(z.unknown()) }) })
    .parse(installed);
  expect(hooks.hooks.Stop).toContainEqual(original.hooks.Stop[0]);
  install(join(directory, "collector"), config, options, true);
  const uninstalled: unknown = JSON.parse(readFileSync(path, "utf8"));
  expect(uninstalled).toMatchObject(original);
});
