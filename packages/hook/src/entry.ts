import * as z from "zod";
z.config({ jitless: true });
import { readFileSync } from "node:fs";
import { dataDirectory, loadConfig } from "./config.js";
import { cliHarnessSchema } from "./harnesses.js";
import { recordHook } from "./hook.js";
import type { InstallOptions } from "./install.js";

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  const directory = dataDirectory();
  const executable = process.argv[1];
  if (!executable) throw new Error("The hook executable path is missing.");
  const harness = cliHarnessSchema.safeParse(mode);
  if (harness.success) {
    try {
      recordHook(
        directory,
        executable,
        loadConfig(directory),
        harness.data,
        JSON.parse(readFileSync(0, "utf8")) as unknown,
      );
    } catch {
      /* Fail open: native agent work must continue. */
    }
    return;
  }
  if (mode === "configure") {
    const { configure } = await import("./install.js");
    configure(directory, JSON.parse(readFileSync(0, "utf8")) as unknown);
    return;
  }
  const config = loadConfig(directory);
  if (mode === "upload") {
    const path = args[0];
    if (!path) throw new Error("A state file is required.");
    const { upload } = await import("./upload.js");
    await upload(directory, executable, path, config);
    return;
  }
  const homeIndex = args.indexOf("--config-home");
  const home = homeIndex >= 0 ? args[homeIndex + 1] : undefined;
  if (homeIndex >= 0 && !home)
    throw new Error("--config-home requires a directory.");
  const options: InstallOptions = {
    ...(home ? { configHome: home } : {}),
    noShellRc: args.includes("--no-shell-rc"),
  };
  if (mode === "install" || mode === "uninstall") {
    const { install, repositorySnippet } = await import("./install.js");
    const names = install(directory, config, options, mode === "uninstall");
    process.stdout.write(
      `${mode === "install" ? "Configured" : "Removed"} AgentCommons for ${names.join(", ") || "no detected harnesses"}.\n`,
    );
    if (mode === "install")
      process.stdout.write(
        `Codex asks you to trust hooks on the next interactive launch.\n\nAdd this to your repository instructions:\n${repositorySnippet}\n`,
      );
    return;
  }
  if (mode === "doctor") {
    const { doctor } = await import("./install.js");
    await doctor(directory, config, options);
    process.stdout.write(
      "AgentCommons configuration and credential checked.\n",
    );
    return;
  }
  throw new Error(
    "Use a harness name, upload, configure, install, doctor, or uninstall.",
  );
}
void main().catch((error: unknown) => {
  if (process.argv[2] === "upload") {
    process.exitCode = 0;
    return;
  }
  process.stderr.write(
    `${error instanceof Error ? error.message : "AgentCommons failed."}\n`,
  );
  process.exitCode = 1;
});
