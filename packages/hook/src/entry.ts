import * as z from "zod";
z.config({ jitless: true });
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, type HookConfig } from "./config.js";
import { HARNESSES, cliHarnessSchema } from "./harnesses.js";
import { enforcePreTool, recordHook, recoverUpload } from "./hook.js";
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
    let input: unknown;
    let config: HookConfig | undefined;
    try {
      input = JSON.parse(readFileSync(0, "utf8")) as unknown;
      config = loadConfig(directory);
      // A pre-tool event is enforced against the cached policy and never captured (§6.4).
      if (enforcePreTool(directory, executable, config, harness.data, input))
        return;
      const path = recordHook(
        directory,
        executable,
        config,
        harness.data,
        input,
      );
      // The only stdout a hook ever writes: the cached recall hint, on events the
      // harness reads as additional model context (§6.2). Never a network request.
      const hint = path && promptHint(directory, harness.data, input, path);
      if (hint) process.stdout.write(hint);
    } catch {
      // Fail open: native agent work must continue. The uploader still starts, so a
      // release that fixes whatever failed here can arrive (§6.2 self-update).
      try {
        if (config)
          recoverUpload(directory, executable, config, harness.data, input);
      } catch {
        /* Best effort. */
      }
    }
    return;
  }
  if (mode === "version") {
    // Prints this bundle's own digest; the self-update self-test compares it with the
    // manifest. It reads this installation's configuration first, because hook mode fails
    // open on a configuration it cannot read: a release whose schema rejects the installed
    // one (a plain-HTTP server, ADR 0103) would otherwise swap in and never upload again.
    loadConfig(directory);
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
    const { removeRepositoryGuidance, writeRepositoryGuidance } =
      await import("./guidance.js");
    if (args.includes("--off")) {
      const removed = removeRepositoryGuidance(root);
      process.stdout.write(
        `${removed.length ? `Removed the AgentCommons guidance from ${removed.join(", ")}.` : "No AgentCommons guidance to remove."}\nRun the command without --off to add it again.\n`,
      );
      return;
    }
    const { written, linked, skipped } = writeRepositoryGuidance(root);
    process.stdout.write(
      `${written.length ? `Wrote the AgentCommons guidance to ${written.join(", ")}${linked.length ? ` and linked ${linked.join(", ")} to it` : ""}.` : "Wrote nothing."}${skipped.length ? `\nLeft ${skipped.join(", ")} alone: not a regular file inside the repository.` : ""}\n`,
    );
    return;
  }
  const config = loadConfig(directory);
  if (mode === "mcp") {
    // The stdio↔HTTP MCP bridge Codex launches (ADR 0089): it forwards the client's JSON-RPC
    // over the server's streamable-HTTP /mcp with the literal key, so a GUI/IDE launch that
    // sourced no shell still authenticates. Never a hook; never touches session state.
    const { runMcpBridge } = await import("./mcp-bridge.js");
    await runMcpBridge(config);
    return;
  }
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
  // An older bundle's reconcile may still pass the retired --no-shell-rc; nothing reads it.
  const options: InstallOptions = home ? { configHome: home } : {};
  if (mode === "install" || mode === "uninstall") {
    const {
      configure,
      install,
      installFailed,
      installNotice,
      instructionFiles,
    } = await import("./install.js");
    const result = install(directory, config, options, mode === "uninstall");
    const names = result.harnesses;
    // Every harness was attempted. Only a harness whose files could not be written fails
    // the run; a native CLI registration that failed is a notice after the summary,
    // because the harness reads the verified entry the installer wrote (§6.1 step 4).
    const broken = result.failures.filter((failure) => !failure.native);
    const notices = result.failures.filter((failure) => failure.native);
    if (broken.length) process.stderr.write(`${installNotice(broken)}\n`);
    if (installFailed(result))
      throw new Error(
        `AgentCommons could not configure ${broken.map((failure) => failure.harness).join(", ")}.`,
      );
    if (mode === "install") {
      // Self-update re-runs the installer with these flags after every swap (§6.2).
      configure(directory, { installOptions: options });
      const { recordConfigured } = await import("./update.js");
      recordConfigured(directory, executable, names);
    }
    process.stdout.write(
      `${mode === "install" ? "Configured" : "Removed"} AgentCommons for ${names.join(", ") || "no detected harnesses"}.\n`,
    );
    if (notices.length) process.stdout.write(`${installNotice(notices)}\n`);
    if (mode === "install") {
      const wired = names.map((name) => HARNESSES[name]);
      const files = instructionFiles(home ?? homedir(), names);
      const lines = [
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
    "Use a harness name, upload, mcp, configure, guidance, install, doctor, version, or uninstall.",
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
