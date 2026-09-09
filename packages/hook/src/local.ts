import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configure, doctor, install } from "./install.js";
import { dataDirectory } from "./paths.js";

const key = process.env.AGENTCOMMONS_API_KEY;
if (!key)
  throw new Error("Set AGENTCOMMONS_API_KEY before linking the local hook.");
const directory = dataDirectory();
const config = configure(directory, {
  server: process.env.AGENTCOMMONS_SERVER ?? "http://localhost:3000",
  key,
  node: process.execPath,
});
copyFileSync(resolve("dist/hook.js"), join(directory, "hook.js"));
copyFileSync(
  resolve("dist/pi-extension.mjs"),
  join(directory, "pi-extension.mjs"),
);
install(directory, config, { noShellRc: true });
await doctor(directory, config);
