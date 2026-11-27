import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configure } from "./install.js";
import { dataDirectory } from "./paths.js";

const key = process.env.AGENTCOMMONS_API_KEY;
if (!key)
  throw new Error("Set AGENTCOMMONS_API_KEY before linking the local hook.");
const directory = dataDirectory();
configure(directory, {
  server: process.env.AGENTCOMMONS_SERVER ?? "http://localhost:3000",
  key,
  node: process.execPath,
});
copyFileSync(resolve("dist/hook.js"), join(directory, "hook.js"));
copyFileSync(
  resolve("dist/pi-extension.mjs"),
  join(directory, "pi-extension.mjs"),
);
// The built bundle installs, as install.sh runs it: only it carries the opencode plugin.
for (const mode of [["install", "--no-shell-rc"], ["doctor"]])
  execFileSync(process.execPath, [join(directory, "hook.js"), ...mode], {
    env: { ...process.env, AGENTCOMMONS_DIR: directory },
    stdio: "inherit",
  });
