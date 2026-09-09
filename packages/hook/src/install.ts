import { execFileSync } from "node:child_process";
import {
  chmodSync,
  accessSync,
  constants,
  mkdirSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "smol-toml";
import * as z from "zod";
import { configSchema, type HookConfig } from "./config.js";
import { hash, writeAtomic } from "./files.js";
import { credentialOrganization } from "./identity.js";
import { HARNESSES, type CliHarness } from "./harnesses.js";

export const repositorySnippet = [
  "## AgentCommons",
  "Past agent sessions for this organization are indexed in AgentCommons (MCP server",
  "`agentcommons`: search, get, sql). This session is recorded automatically. Only use it",
  "when the user asks about prior sessions or prior work; for anything beyond a quick",
  "lookup, run the investigation in a subagent and bring back only findings and session ids.",
].join("\n");
const objectSchema = z.record(z.string(), z.unknown());
const MARKER = "agentcommons-hook";
const MCP_NAME = "agentcommons";
const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;
function marker(command: unknown): boolean {
  return (
    typeof command === "string" &&
    /(?:^|\s)agentcommons-hook(?:\s|$)/.test(command)
  );
}
function atomicText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
export function configure(directory: string, input: unknown): HookConfig {
  const path = join(directory, "config.json");
  const existing: unknown = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  const config = configSchema.parse({
    installationId: randomUUID(),
    node: process.execPath,
    ...objectSchema.parse(existing),
    ...objectSchema.parse(input),
  });
  writeAtomic(path, config);
  writeAtomic(join(directory, "package.json"), { type: "commonjs" });
  return config;
}
export interface InstallOptions {
  configHome?: string;
  noShellRc?: boolean;
  harnesses?: CliHarness[];
}
function present(binary: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((directory) => {
    try {
      accessSync(join(directory || ".", binary), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
function updateHooks(
  input: unknown,
  harness: CliHarness,
  command: string,
  uninstall: boolean,
): Record<string, unknown> {
  const config = objectSchema.parse(input);
  const hooks = objectSchema.parse(config.hooks ?? {});
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.flatMap((group: unknown) => {
      const parsed = objectSchema.safeParse(group);
      if (!parsed.success || !Array.isArray(parsed.data.hooks)) return [group];
      const kept = parsed.data.hooks.filter(
        (hook: unknown) => !marker(objectSchema.safeParse(hook).data?.command),
      );
      if (kept.length === parsed.data.hooks.length) return [group];
      return kept.length ? [{ ...parsed.data, hooks: kept }] : [];
    });
  }
  if (!uninstall)
    for (const event of Object.keys(HARNESSES[harness].events)) {
      const previous = hooks[event];
      hooks[event] = [
        ...z.array(z.unknown()).parse(previous ?? []),
        {
          matcher: "",
          hooks: [
            { type: "command", command, timeout: HARNESSES[harness].timeout },
          ],
        },
      ];
    }
  return { ...config, hooks };
}
function shellRc(home: string, config: HookConfig, uninstall: boolean): void {
  const shell = process.env.SHELL ?? "/bin/sh";
  const fish = shell.endsWith("/fish");
  const path = fish
    ? join(home, ".config", "fish", "config.fish")
    : join(home, shell.endsWith("/zsh") ? ".zshrc" : ".bashrc");
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const cleaned = original.replace(
    /^# agentcommons-hook begin\n[\s\S]*?^# agentcommons-hook end\n?/gm,
    "",
  );
  const exports = fish
    ? `set -gx AGENTCOMMONS_SERVER ${shellQuote(config.server)}\nset -gx AGENTCOMMONS_API_KEY ${shellQuote(config.key)}\n`
    : `export AGENTCOMMONS_SERVER=${shellQuote(config.server)}\nexport AGENTCOMMONS_API_KEY=${shellQuote(config.key)}\n`;
  atomicText(
    path,
    cleaned +
      (uninstall
        ? ""
        : `${cleaned.endsWith("\n") || !cleaned ? "" : "\n"}# agentcommons-hook begin\n${exports}# agentcommons-hook end\n`),
  );
}
/** Supported harnesses whose CLI is on PATH right now; the installer wires exactly these. */
export function detectHarnesses(): CliHarness[] {
  return (Object.keys(HARNESSES) as CliHarness[]).filter((name) =>
    present(HARNESSES[name].binary),
  );
}
export function install(
  directory: string,
  config: HookConfig,
  options: InstallOptions = {},
  uninstall = false,
): CliHarness[] {
  const home = options.configHome ?? homedir();
  const registryPath = join(directory, "installations.json");
  const registrySchema = z.record(
    z.string(),
    z.strictObject({
      installed: z.unknown(),
      previous: z.unknown().optional(),
    }),
  );
  const registry = registrySchema.parse(
    existsSync(registryPath)
      ? (JSON.parse(readFileSync(registryPath, "utf8")) as unknown)
      : {},
  );
  const selected =
    options.harnesses ??
    (Object.keys(HARNESSES) as CliHarness[]).filter((name) =>
      uninstall
        ? existsSync(join(home, ...HARNESSES[name].configPath))
        : present(HARNESSES[name].binary),
    );
  for (const harness of selected) {
    const definition = HARNESSES[harness];
    const path = join(home, ...definition.configPath);
    const toml = definition.configFormat === "toml";
    const read = (file: string): Record<string, unknown> => {
      if (!existsSync(file)) return {};
      const text = readFileSync(file, "utf8");
      return objectSchema.parse(
        toml ? parse(text) : (JSON.parse(text) as unknown),
      );
    };
    const save = (file: string, value: Record<string, unknown>): void => {
      if (existsSync(file) && !existsSync(`${file}.agentcommons-backup`))
        atomicText(`${file}.agentcommons-backup`, readFileSync(file, "utf8"));
      atomicText(
        file,
        toml ? stringify(value) : `${JSON.stringify(value, null, 2)}\n`,
      );
    };
    const command = `AGENTCOMMONS_DIR=${shellQuote(directory)} ${shellQuote(config.node)} ${shellQuote(join(directory, "hook.js"))} ${harness} ${MARKER}`;
    const input = read(path);
    let output: Record<string, unknown>;
    if (definition.configFormat === "extension") {
      output = input;
      const extension = join(directory, "pi-extension.mjs");
      const extensions = z
        .array(z.unknown())
        .parse(output.extensions ?? [])
        .filter((item) => item !== extension);
      output.extensions = uninstall ? extensions : [...extensions, extension];
    } else output = updateHooks(input, harness, command, uninstall);
    save(path, output);
    if (!definition.mcpConfigPath) continue;
    const mcpPath = join(home, ...definition.mcpConfigPath);
    const mcpKey = toml ? "mcp_servers" : "mcpServers";
    const mcpConfig = mcpPath === path ? output : read(mcpPath);
    const servers = objectSchema.parse(mcpConfig[mcpKey] ?? {});
    const previous = registry[mcpPath];
    if (uninstall) {
      if (
        previous &&
        JSON.stringify(servers[MCP_NAME]) === JSON.stringify(previous.installed)
      ) {
        if (previous.previous !== undefined)
          servers[MCP_NAME] = previous.previous;
        else Reflect.deleteProperty(servers, MCP_NAME);
        Reflect.deleteProperty(registry, mcpPath);
      }
    } else {
      const installed = definition.mcp(new URL("/mcp", config.server).href);
      registry[mcpPath] = {
        installed,
        ...(previous
          ? { previous: previous.previous }
          : servers[MCP_NAME] !== undefined
            ? { previous: servers[MCP_NAME] }
            : {}),
      };
      servers[MCP_NAME] = installed;
    }
    mcpConfig[mcpKey] = servers;
    save(mcpPath, mcpConfig);
    writeAtomic(registryPath, registry);
    const nativeCommand = definition.mcpCommand(
      new URL("/mcp", config.server).href,
    );
    if (!uninstall && options.configHome === undefined && nativeCommand) {
      const registrationConfig = {
        ...mcpConfig,
        [mcpKey]: Object.fromEntries(
          Object.entries(servers).filter(([name]) => name !== MCP_NAME),
        ),
      };
      save(mcpPath, registrationConfig);
      try {
        execFileSync(definition.binary, nativeCommand, {
          timeout: 10000,
          stdio: "ignore",
        });
      } catch {
        save(mcpPath, mcpConfig);
        throw new Error(`The ${harness} MCP registration failed.`);
      }
      chmodSync(mcpPath, 0o600);
      const nativeConfig = read(mcpPath);
      const nativeServers = objectSchema.parse(nativeConfig[mcpKey] ?? {});
      const written = nativeServers[MCP_NAME];
      if (written === undefined) {
        save(mcpPath, mcpConfig);
        throw new Error(
          `The ${harness} CLI wrote to an unexpected configuration location.`,
        );
      }
      // The CLI owns its own fields; options it cannot express (Claude's alwaysLoad)
      // are merged into the entry it wrote.
      const expected = definition.mcp(new URL("/mcp", config.server).href);
      const missing = Object.entries(expected ?? {}).filter(
        ([key]) => !(key in objectSchema.parse(written)),
      );
      const installed = missing.length
        ? { ...objectSchema.parse(written), ...Object.fromEntries(missing) }
        : written;
      if (missing.length) {
        nativeServers[MCP_NAME] = installed;
        nativeConfig[mcpKey] = nativeServers;
        save(mcpPath, nativeConfig);
      }
      const owned = registry[mcpPath];
      if (owned) registry[mcpPath] = { ...owned, installed };
      writeAtomic(registryPath, registry);
    }
  }
  if (!options.noShellRc) shellRc(home, config, uninstall);
  return selected;
}
export async function doctor(
  directory: string,
  config: HookConfig,
  options: InstallOptions = {},
): Promise<void> {
  const organizationId = await credentialOrganization(config);
  writeAtomic(join(directory, "config.json"), {
    ...config,
    organizationId,
    credentialHash: hash(config.key),
  });
  if (!existsSync(join(directory, "hook.js")))
    throw new Error("The installed hook.js file is missing.");
  const home = options.configHome ?? homedir();
  for (const harness of options.harnesses ??
    (Object.keys(HARNESSES) as CliHarness[]).filter((name) =>
      present(HARNESSES[name].binary),
    )) {
    const definition = HARNESSES[harness];
    const read = (path: string) =>
      objectSchema.parse(
        definition.configFormat === "toml"
          ? parse(readFileSync(path, "utf8"))
          : (JSON.parse(readFileSync(path, "utf8")) as unknown),
      );
    const parsed = read(join(home, ...definition.configPath));
    if (definition.configFormat === "extension") {
      const extension = join(directory, "pi-extension.mjs");
      if (
        !z
          .array(z.unknown())
          .parse(parsed.extensions ?? [])
          .includes(extension) ||
        !existsSync(extension)
      )
        throw new Error("The pi extension is missing.");
    } else {
      const hooks = objectSchema.parse(parsed.hooks ?? {});
      for (const event of Object.keys(definition.events)) {
        const groups = z.array(z.unknown()).parse(hooks[event] ?? []);
        const found = groups.some((group) => {
          const entries = objectSchema.safeParse(group).data?.hooks;
          return (
            Array.isArray(entries) &&
            entries.some((entry: unknown) =>
              marker(objectSchema.safeParse(entry).data?.command),
            )
          );
        });
        if (!found) throw new Error(`The ${harness} ${event} hook is missing.`);
      }
    }
    if (definition.mcpConfigPath) {
      const servers = objectSchema.parse(
        read(join(home, ...definition.mcpConfigPath))[
          definition.configFormat === "toml" ? "mcp_servers" : "mcpServers"
        ] ?? {},
      );
      const configured = objectSchema.parse(servers[MCP_NAME] ?? {});
      const expected = definition.mcp(new URL("/mcp", config.server).href);
      if (
        expected &&
        Object.entries(expected).some(
          ([key, value]) =>
            JSON.stringify(configured[key]) !== JSON.stringify(value),
        )
      )
        throw new Error(
          `The ${harness} MCP configuration does not match this server.`,
        );
    }
  }
}
