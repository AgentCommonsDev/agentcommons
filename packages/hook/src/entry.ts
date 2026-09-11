import * as z from "zod";
z.config({ jitless: true });
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { HARNESSES, cliHarnessSchema } from "./harnesses.js";
import { recordHook } from "./hook.js";
import type { InstallOptions } from "./install.js";
import { dataDirectory } from "./paths.js";
import { promptHint } from "./recall.js";

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  const directory = dataDirectory();
  const executable = process.argv[1];
  if (!executable) throw new Error("The hook executable path is missing.");
  const harness = cliHarnessSchema.safeParse(mode);
  if (harness.success) {
    try {
      const input = JSON.parse(readFileSync(0, "utf8")) as unknown;
      const path = recordHook(
        directory,
        executable,
        loadConfig(directory),
        harness.data,
        input,
      );
      // The only stdout a hook ever writes: the cached recall hint, on events the
      // harness reads as additional model context (§6.2). Never a network request.
      const hint = path && promptHint(directory, harness.data, input, path);
      if (hint) process.stdout.write(hint);
    } catch {
      /* Fail open: native agent work must continue. */
    }
    return;
  }
  if (mode === "version") {
    // Prints this bundle's own digest; the self-update self-test compares it with the manifest.
    const { hookIdentity } = await import("./update.js");
    process.stdout.write(`${hookIdentity(directory, executable).sha256}\n`);
    return;
  }
  if (mode === "configure") {
    const { configure } = await import("./install.js");
    configure(directory, JSON.parse(readFileSync(0, "utf8")) as unknown);
    return;
  }
  if (mode === "guidance") {
    // Needs no configuration: the block is the same text for every server (§8.3).
    const repoIndex = args.indexOf("--repo");
    const root = resolve(
      (repoIndex >= 0 ? args[repoIndex + 1] : undefined) ?? process.cwd(),
    );
    const { writeRepositoryGuidance } = await import("./install.js");
    const { written, linked } = writeRepositoryGuidance(root);
    process.stdout.write(
      `Wrote the AgentCommons guidance to ${written.join(", ")}${linked.length ? ` and linked ${linked.join(", ")} to it` : ""}.\nCommit these files so every teammate's agent reads the guidance.\n`,
    );
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
    const { configure, install, instructionFiles } =
      await import("./install.js");
    const names = install(directory, config, options, mode === "uninstall");
    if (mode === "install") {
      // Self-update re-runs the installer with these flags after every swap (§6.2).
      configure(directory, { installOptions: options });
      const { recordConfigured } = await import("./update.js");
      recordConfigured(directory, executable, names);
    }
    process.stdout.write(
      `${mode === "install" ? "Configured" : "Removed"} AgentCommons for ${names.join(", ") || "no detected harnesses"}.\n`,
    );
    if (mode === "install") {
      const wired = names.map((name) => HARNESSES[name]);
      const files = instructionFiles(home ?? homedir(), names);
      const lines = [
        ...(options.noShellRc
          ? []
          : [
              "AGENTCOMMONS_API_KEY is exported from your bash, zsh and fish startup files.",
              ...wired.flatMap((definition) =>
                definition.shellExportNote ? [definition.shellExportNote] : [],
              ),
            ]),
        ...(files.length
          ? [
              `Your agents read the AgentCommons guidance from ${files.join(", ")}.`,
            ]
          : []),
        // A harness without a global instructions file carries the guidance in its extension.
        ...names
          .filter((name) => HARNESSES[name].instructionsPath === null)
          .map(
            (name) =>
              `${name} reads the AgentCommons guidance from its extension.`,
          ),
        ...wired.flatMap((definition) =>
          definition.installNote ? [definition.installNote] : [],
        ),
      ];
      process.stdout.write(lines.map((line) => `${line}\n`).join(""));
    }
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
    "Use a harness name, upload, configure, guidance, install, doctor, version, or uninstall.",
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
