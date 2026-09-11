import { execFileSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import * as z from "zod";
import { configSchema, objectSchema, type HookConfig } from "./config.js";
import {
  hash,
  isCode,
  readJsonOr,
  writeAtomic,
  writeUserFile,
} from "./files.js";
import { credentialOrganization } from "./identity.js";
import {
  HARNESSES,
  type CliHarness,
  type HarnessDefinition,
} from "./harnesses.js";

import {
  agentInstructions,
  guidanceMarkers,
  repositoryInstructions,
} from "@agentcommons/core/format/install";
export { agentInstructions };
const MARKER = "agentcommons-hook";
const MCP_NAME = "agentcommons";
/** Delimits the one block the installer owns inside a file the user owns. */
interface BlockMarkers {
  begin: string;
  end: string;
}
const SHELL_MARKERS: BlockMarkers = {
  begin: `# ${MARKER} begin`,
  end: `# ${MARKER} end`,
};
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Writes or replaces the marked block in place, or removes it when `content` is null
 * (a self-update carries new text; uninstall removes it). Everything outside the
 * markers is the user's and is kept byte for byte; a file left empty is removed.
 */
function replaceMarkedBlock(
  path: string,
  markers: BlockMarkers,
  content: string | null,
): void {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (content === null && !original) return;
  const kept = original.replace(
    new RegExp(
      `\\n?${escapeRegExp(markers.begin)}\\n[\\s\\S]*?${escapeRegExp(markers.end)}\\n?`,
      "g",
    ),
    "",
  );
  if (content === null) {
    if (kept === original) return;
    if (kept.trim() === "") rmSync(path, { force: true });
    else writeUserFile(path, kept);
    return;
  }
  const separator =
    kept === "" || kept.endsWith("\n\n")
      ? ""
      : kept.endsWith("\n")
        ? "\n"
        : "\n\n";
  const next = `${kept}${separator}${markers.begin}\n${content}\n${markers.end}\n`;
  if (next !== original) writeUserFile(path, next);
}
interface RepositoryGuidance {
  /** Files that now carry the block. */
  written: string[];
  /** Files created as symlinks to the written file. */
  linked: string[];
}
/** The one repository file the block is written to: the name most harnesses read (`AGENTS.md`). */
export function primaryRepositoryInstructionsFile(): string {
  const counts = new Map<string, number>();
  for (const definition of Object.values(HARNESSES))
    counts.set(
      definition.repositoryInstructionsFile,
      (counts.get(definition.repositoryInstructionsFile) ?? 0) + 1,
    );
  return (
    [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? "AGENTS.md"
  );
}
/**
 * Writes the §8.3 repository guidance into the instructions files the supported harnesses
 * read from a repository root (`repositoryInstructionsFile` in HARNESSES). `AGENTS.md`
 * receives the marker-delimited block; every other name is created as a symlink to it when
 * absent, receives its own block when it is a regular file, and is left alone when it is
 * already a symlink (this repository links `CLAUDE.md` and `GEMINI.md` to `AGENTS.md`).
 * Everything outside the markers is kept, so the command is idempotent and safe to re-run.
 */
export function writeRepositoryGuidance(root: string): RepositoryGuidance {
  const primary = primaryRepositoryInstructionsFile();
  const result: RepositoryGuidance = { written: [], linked: [] };
  const write = (name: string) => {
    replaceMarkedBlock(
      join(root, name),
      guidanceMarkers,
      repositoryInstructions,
    );
    result.written.push(join(root, name));
  };
  write(primary);
  const names = new Set(
    Object.values(HARNESSES).map((d) => d.repositoryInstructionsFile),
  );
  names.delete(primary);
  for (const name of [...names].sort()) {
    const path = join(root, name);
    let stat: ReturnType<typeof lstatSync> | null;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
      stat = null;
    }
    if (stat === null) {
      symlinkSync(primary, path);
      result.linked.push(path);
    } else if (stat.isFile()) write(name);
  }
  return result;
}
/** The global instructions files the installer manages for these harnesses. */
export function instructionFiles(
  home: string,
  harnesses: readonly CliHarness[],
): string[] {
  return harnesses.flatMap((name) => {
    const path = HARNESSES[name].instructionsPath;
    return path ? [join(home, ...path)] : [];
  });
}
const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;
const HOOK_COMMAND = new RegExp(`(?:^|\\s)${MARKER}(?:\\s|$)`);
function marker(command: unknown): boolean {
  return typeof command === "string" && HOOK_COMMAND.test(command);
}
export function configure(directory: string, input: unknown): HookConfig {
  const path = join(directory, "config.json");
  const config = configSchema.parse({
    installationId: randomUUID(),
    node: process.execPath,
    ...readJsonOr(path, objectSchema, {}),
    ...objectSchema.parse(input),
  });
  writeAtomic(path, config);
  writeAtomic(join(directory, "package.json"), { type: "commonjs" });
  return config;
}
export interface InstallOptions {
  configHome?: string;
  noShellRc?: boolean;
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
/** What a harness's configuration document carries for this installation. */
interface Wiring {
  harness: CliHarness;
  events: readonly string[];
  timeout: number;
  command: string;
  extension: string;
}
function wiringFor(
  directory: string,
  config: HookConfig,
  harness: CliHarness,
): Wiring {
  const definition = HARNESSES[harness];
  return {
    harness,
    events: Object.keys(definition.events),
    timeout: definition.timeout,
    command: `AGENTCOMMONS_DIR=${shellQuote(directory)} ${shellQuote(config.node)} ${shellQuote(join(directory, "hook.js"))} ${harness} ${MARKER}`,
    extension: join(directory, "pi-extension.mjs"),
  };
}
/** How a harness's configuration is serialized and how the shim is wired into it. */
interface ConfigFormat {
  parse(text: string): unknown;
  stringify(value: Record<string, unknown>): string;
  /** The table naming MCP servers in documents of this format. */
  mcpKey: string;
  /** Adds this installation to a document, or removes it. Entries the user wrote are kept. */
  wire(
    config: Record<string, unknown>,
    wiring: Wiring,
    uninstall: boolean,
  ): Record<string, unknown>;
  /** Throws when a document does not carry this installation. */
  verify(config: Record<string, unknown>, wiring: Wiring): void;
}
function wireHooks(
  config: Record<string, unknown>,
  wiring: Wiring,
  uninstall: boolean,
): Record<string, unknown> {
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
    for (const event of wiring.events) {
      const previous = hooks[event];
      hooks[event] = [
        ...z.array(z.unknown()).parse(previous ?? []),
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: wiring.command,
              timeout: wiring.timeout,
            },
          ],
        },
      ];
    }
  return { ...config, hooks };
}
function verifyHooks(config: Record<string, unknown>, wiring: Wiring): void {
  const hooks = objectSchema.parse(config.hooks ?? {});
  for (const event of wiring.events) {
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
    if (!found)
      throw new Error(`The ${wiring.harness} ${event} hook is missing.`);
  }
}
const extensionsOf = (config: Record<string, unknown>): unknown[] =>
  z.array(z.unknown()).parse(config.extensions ?? []);
function wireExtension(
  config: Record<string, unknown>,
  wiring: Wiring,
  uninstall: boolean,
): Record<string, unknown> {
  const extensions = extensionsOf(config).filter(
    (item) => item !== wiring.extension,
  );
  return {
    ...config,
    extensions: uninstall ? extensions : [...extensions, wiring.extension],
  };
}
function verifyExtension(
  config: Record<string, unknown>,
  wiring: Wiring,
): void {
  if (
    !extensionsOf(config).includes(wiring.extension) ||
    !existsSync(wiring.extension)
  )
    throw new Error(`The ${wiring.harness} extension is missing.`);
}
const json: ConfigFormat = {
  parse: (text) => JSON.parse(text) as unknown,
  stringify: (value) => `${JSON.stringify(value, null, 2)}\n`,
  mcpKey: "mcpServers",
  wire: wireHooks,
  verify: verifyHooks,
};
const FORMATS: Readonly<
  Record<HarnessDefinition["configFormat"], ConfigFormat>
> = {
  json,
  toml: {
    parse: (text) => parseToml(text),
    stringify: (value) => stringifyToml(value),
    mcpKey: "mcp_servers",
    wire: wireHooks,
    verify: verifyHooks,
  },
  // A JSON settings file that lists extension modules instead of shell hooks (pi).
  extension: { ...json, wire: wireExtension, verify: verifyExtension },
};
/** A harness configuration document, or null when the file does not exist. */
function readConfig(
  format: ConfigFormat,
  path: string,
): Record<string, unknown> | null {
  return existsSync(path)
    ? objectSchema.parse(format.parse(readFileSync(path, "utf8")))
    : null;
}
/** Saves a document, keeping the first pre-install copy beside it as a backup. */
function saveConfig(
  format: ConfigFormat,
  path: string,
  value: Record<string, unknown>,
): void {
  if (existsSync(path) && !existsSync(`${path}.agentcommons-backup`))
    writeUserFile(`${path}.agentcommons-backup`, readFileSync(path, "utf8"));
  writeUserFile(path, format.stringify(value));
}
/**
 * Every login shell a person may start a coding agent from gets the exports: bash and zsh
 * always, fish when it is installed or configured. Codex reads the key from the
 * environment (`bearer_token_env_var`), so a shell without the export cannot start the
 * MCP server. The block is marker-delimited and replaced in place on every install.
 */
function shellRcPaths(home: string): string[] {
  const fishDirectory = join(home, ".config", "fish");
  const paths = [join(home, ".bashrc"), join(home, ".zshrc")];
  if (existsSync(fishDirectory) || present("fish"))
    paths.push(join(fishDirectory, "config.fish"));
  return paths;
}
function shellRc(home: string, config: HookConfig, uninstall: boolean): void {
  for (const path of shellRcPaths(home)) {
    const exports = path.endsWith("config.fish")
      ? [
          `set -gx AGENTCOMMONS_SERVER ${shellQuote(config.server)}`,
          `set -gx AGENTCOMMONS_API_KEY ${shellQuote(config.key)}`,
        ]
      : [
          `export AGENTCOMMONS_SERVER=${shellQuote(config.server)}`,
          `export AGENTCOMMONS_API_KEY=${shellQuote(config.key)}`,
        ];
    replaceMarkedBlock(
      path,
      SHELL_MARKERS,
      uninstall ? null : exports.join("\n"),
    );
  }
}
/** Supported harnesses whose CLI is on PATH right now; the installer wires exactly these. */
export function detectHarnesses(): CliHarness[] {
  return (Object.keys(HARNESSES) as CliHarness[]).filter((name) =>
    present(HARNESSES[name].binary),
  );
}
const registrySchema = z.record(
  z.string(),
  z.strictObject({
    installed: z.unknown(),
    previous: z.unknown().optional(),
  }),
);
type Registry = z.infer<typeof registrySchema>;
const mcpUrl = (config: HookConfig): string =>
  new URL("/mcp", config.server).href;
export function install(
  directory: string,
  config: HookConfig,
  options: InstallOptions = {},
  uninstall = false,
): CliHarness[] {
  const home = options.configHome ?? homedir();
  const registryPath = join(directory, "installations.json");
  const registry: Registry = readJsonOr(registryPath, registrySchema, {});
  const selected = uninstall
    ? (Object.keys(HARNESSES) as CliHarness[]).filter((name) =>
        existsSync(join(home, ...HARNESSES[name].configPath)),
      )
    : detectHarnesses();
  const url = mcpUrl(config);
  for (const harness of selected) {
    const definition = HARNESSES[harness];
    const format = FORMATS[definition.configFormat];
    const wiring = wiringFor(directory, config, harness);
    const path = join(home, ...definition.configPath);
    const output = format.wire(
      readConfig(format, path) ?? {},
      wiring,
      uninstall,
    );
    saveConfig(format, path, output);
    if (definition.instructionsPath)
      replaceMarkedBlock(
        join(home, ...definition.instructionsPath),
        guidanceMarkers,
        uninstall ? null : agentInstructions,
      );
    if (!definition.mcpConfigPath) continue;
    const mcpPath = join(home, ...definition.mcpConfigPath);
    const mcpConfig =
      mcpPath === path ? output : (readConfig(format, mcpPath) ?? {});
    const servers = objectSchema.parse(mcpConfig[format.mcpKey] ?? {});
    const previous = registry[mcpPath];
    const expected = definition.mcp(url);
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
      registry[mcpPath] = {
        installed: expected,
        ...(previous
          ? { previous: previous.previous }
          : servers[MCP_NAME] !== undefined
            ? { previous: servers[MCP_NAME] }
            : {}),
      };
      servers[MCP_NAME] = expected;
    }
    mcpConfig[format.mcpKey] = servers;
    saveConfig(format, mcpPath, mcpConfig);
    const nativeCommand = definition.mcpCommand(url);
    try {
      if (!uninstall && options.configHome === undefined && nativeCommand) {
        const registrationConfig = {
          ...mcpConfig,
          [format.mcpKey]: Object.fromEntries(
            Object.entries(servers).filter(([name]) => name !== MCP_NAME),
          ),
        };
        saveConfig(format, mcpPath, registrationConfig);
        try {
          execFileSync(definition.binary, nativeCommand, {
            timeout: 10000,
            stdio: "ignore",
          });
        } catch {
          saveConfig(format, mcpPath, mcpConfig);
          throw new Error(`The ${harness} MCP registration failed.`);
        }
        chmodSync(mcpPath, 0o600);
        const nativeConfig = readConfig(format, mcpPath) ?? {};
        const nativeServers = objectSchema.parse(
          nativeConfig[format.mcpKey] ?? {},
        );
        const written = nativeServers[MCP_NAME];
        if (written === undefined) {
          saveConfig(format, mcpPath, mcpConfig);
          throw new Error(
            `The ${harness} CLI wrote to an unexpected configuration location.`,
          );
        }
        // The CLI owns its own fields; options it cannot express (Claude's alwaysLoad)
        // are merged into the entry it wrote.
        const missing = Object.entries(expected ?? {}).filter(
          ([key]) => !(key in objectSchema.parse(written)),
        );
        const installed = missing.length
          ? { ...objectSchema.parse(written), ...Object.fromEntries(missing) }
          : written;
        if (missing.length) {
          nativeServers[MCP_NAME] = installed;
          nativeConfig[format.mcpKey] = nativeServers;
          saveConfig(format, mcpPath, nativeConfig);
        }
        const owned = registry[mcpPath];
        if (owned) registry[mcpPath] = { ...owned, installed };
      }
    } finally {
      // Recorded even when a native registration fails: the restored file carries the entry.
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
  const url = mcpUrl(config);
  for (const harness of detectHarnesses()) {
    const definition = HARNESSES[harness];
    const format = FORMATS[definition.configFormat];
    const settings = readConfig(format, join(home, ...definition.configPath));
    if (!settings)
      throw new Error(`The ${harness} configuration file is missing.`);
    format.verify(settings, wiringFor(directory, config, harness));
    if (!definition.mcpConfigPath) continue;
    const mcpConfig = readConfig(
      format,
      join(home, ...definition.mcpConfigPath),
    );
    if (!mcpConfig)
      throw new Error(`The ${harness} MCP configuration file is missing.`);
    const servers = objectSchema.parse(mcpConfig[format.mcpKey] ?? {});
    const configured = objectSchema.parse(servers[MCP_NAME] ?? {});
    const expected = definition.mcp(url);
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
