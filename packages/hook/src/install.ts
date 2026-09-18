import { execFileSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import * as z from "zod";
import { replaceMarkedBlock, type BlockMarkers } from "./blocks.js";
import { configSchema, objectSchema, type HookConfig } from "./config.js";
import { hash, readJsonOr, writeAtomic, writeUserFile } from "./files.js";
import { credentialOrganization } from "./identity.js";
import {
  HARNESSES,
  type CliHarness,
  type HarnessDefinition,
  type McpRegistrationContext,
} from "./harnesses.js";

import {
  agentInstructions,
  guidanceMarkers,
} from "@agentcommons/core/format/install";
export { agentInstructions };
const MARKER = "agentcommons-hook";
const MCP_NAME = "agentcommons";
const SHELL_MARKERS: BlockMarkers = {
  begin: `# ${MARKER} begin`,
  end: `# ${MARKER} end`,
};
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
 * always, fish when it is installed or configured. Codex no longer depends on this export —
 * its `agentcommons` MCP entry is a stdio bridge that carries the key in its own config (ADR
 * 0089) — but the export stays for other tools that read AGENTCOMMONS_API_KEY. The block is
 * marker-delimited and replaced in place on every install.
 */
function shellRcPaths(home: string): string[] {
  // Interactive rc files cover a terminal-launched shell; the login files cover a login
  // shell, which reads them instead. macOS Terminal starts a login bash that reads
  // `.bash_profile`/`.profile` and never `.bashrc`, and display managers source `.profile`.
  // Codex's own MCP entry no longer needs the export (ADR 0089), but other tools reading
  // AGENTCOMMONS_API_KEY still do. `.profile` is the POSIX login fallback, written always; a
  // shell's own login file (`.bash_profile`, `.zprofile`) shadows it, so extend one that
  // already exists but never create it, so the shell's startup order is unchanged.
  const paths = [
    join(home, ".profile"),
    join(home, ".bashrc"),
    join(home, ".zshrc"),
  ];
  for (const login of [".bash_profile", ".zprofile"]) {
    const path = join(home, login);
    if (existsSync(path)) paths.push(path);
  }
  const fishDirectory = join(home, ".config", "fish");
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
/**
 * The harness CLI's own registration command failed or wrote nowhere we can see. The
 * harness's files already carry the entry the installer wrote and restored, so this is
 * reported, not fatal.
 */
class NativeRegistrationFailed extends Error {}
/** One harness the installer could not finish; the other harnesses were still wired. */
interface InstallFailure {
  harness: CliHarness;
  message: string;
  /** Only the native CLI registration failed; the installer's own entry is in place. */
  native: boolean;
}
interface InstallResult {
  /** The harnesses the run selected (detected on PATH, or configured for an uninstall). */
  harnesses: CliHarness[];
  failures: InstallFailure[];
}
/**
 * Whether an install run must exit non-zero: a harness's own files could not be written.
 * A failed native registration alone is a notice, however many harnesses it touched,
 * because the verified entry the installer wrote is what the harness reads (§6.1 step 4);
 * a machine whose only CLI is `claude` is configured even when `claude mcp add` fails.
 */
export const installFailed = ({ failures }: InstallResult): boolean =>
  failures.some((failure) => !failure.native);
/** One line per failed harness, for stderr and `hook.log`. */
export const installNotice = (failures: readonly InstallFailure[]): string =>
  failures
    .map(
      (failure) =>
        `${failure.harness}: ${failure.message}${failure.native ? ` AgentCommons wrote the ${failure.harness} MCP entry itself, so recall works; \`${HARNESSES[failure.harness].binary} mcp list\` shows it.` : ""}`,
    )
    .join("\n");
/** How long the harness CLI may take to register the server; the install path, never a hook. */
const NATIVE_TIMEOUT_MS = 30000;
/** The native CLI's exit status or signal and its first line of stderr, with the key masked. */
function nativeFailureDetail(error: unknown, key: string): string {
  const failure = z
    .looseObject({
      code: z.string().optional(),
      status: z.number().nullable().optional(),
      signal: z.string().nullable().optional(),
      stderr: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
    })
    .safeParse(error).data;
  if (!failure) return "did not finish";
  const stderr = (
    typeof failure.stderr === "string"
      ? failure.stderr
      : Buffer.from(failure.stderr ?? []).toString("utf8")
  )
    .split(key)
    .join("ac_…")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const reason =
    failure.code === "ETIMEDOUT"
      ? `did not finish within ${String(NATIVE_TIMEOUT_MS / 1000)} s`
      : failure.code === "ENOENT"
        ? "was not found on PATH"
        : typeof failure.status === "number"
          ? `exited with status ${String(failure.status)}`
          : failure.signal
            ? `was stopped by ${failure.signal}`
            : "did not finish";
  return stderr ? `${reason}: ${stderr.slice(0, 200)}` : reason;
}
/** The MCP entry a document at `path` carries for this server, for the post-write check. */
function readEntry(format: ConfigFormat, path: string): unknown {
  return objectSchema.parse(
    (readConfig(format, path) ?? {})[format.mcpKey] ?? {},
  )[MCP_NAME];
}
/** Wires (or unwires) one harness: hooks, instructions block and MCP entry. */
function wireHarness(
  directory: string,
  config: HookConfig,
  harness: CliHarness,
  home: string,
  url: string,
  registry: Registry,
  registryPath: string,
  options: InstallOptions,
  uninstall: boolean,
): void {
  const definition = HARNESSES[harness];
  const format = FORMATS[definition.configFormat];
  const wiring = wiringFor(directory, config, harness);
  const path = join(home, ...definition.configPath);
  const output = format.wire(readConfig(format, path) ?? {}, wiring, uninstall);
  saveConfig(format, path, output);
  if (definition.instructionsPath)
    replaceMarkedBlock(
      join(home, ...definition.instructionsPath),
      guidanceMarkers,
      uninstall ? null : agentInstructions,
    );
  if (!definition.mcpConfigPath) return;
  const mcpPath = join(home, ...definition.mcpConfigPath);
  const mcpConfig =
    mcpPath === path ? output : (readConfig(format, mcpPath) ?? {});
  const servers = objectSchema.parse(mcpConfig[format.mcpKey] ?? {});
  const previous = registry[mcpPath];
  const mcpContext: McpRegistrationContext = {
    directory,
    node: config.node,
    server: config.server,
  };
  const expected = definition.mcp(url, config.key, mcpContext);
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
  const nativeCommand = definition.mcpCommand(url, config.key, mcpContext);
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
        // stdin closed so the CLI can never wait on a terminal; stderr kept for the notice.
        execFileSync(definition.binary, nativeCommand, {
          timeout: NATIVE_TIMEOUT_MS,
          stdio: ["ignore", "ignore", "pipe"],
          encoding: "utf8",
        });
      } catch (error) {
        // The installer's own entry is restored and read back before it is relied on: a
        // restore that did not land is a real failure, not a notice.
        saveConfig(format, mcpPath, mcpConfig);
        if (
          JSON.stringify(readEntry(format, mcpPath)) !==
          JSON.stringify(expected)
        )
          throw new Error(`The ${harness} MCP entry could not be written.`);
        throw new NativeRegistrationFailed(
          `\`${definition.binary} ${nativeCommand.slice(0, 2).join(" ")}\` ${nativeFailureDetail(error, config.key)}.`,
        );
      }
      chmodSync(mcpPath, 0o600);
      const nativeConfig = readConfig(format, mcpPath) ?? {};
      const nativeServers = objectSchema.parse(
        nativeConfig[format.mcpKey] ?? {},
      );
      const written = nativeServers[MCP_NAME];
      if (written === undefined) {
        saveConfig(format, mcpPath, mcpConfig);
        throw new NativeRegistrationFailed(
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
/**
 * Wires every selected harness independently: a harness whose CLI registration fails, or
 * whose files cannot be written, is recorded in `failures` and the run continues with the
 * next one, so a machine whose `claude` is missing from the uploader's PATH still gets
 * its Gemini and Codex entries rewritten. Callers decide with `installFailed`.
 */
export function install(
  directory: string,
  config: HookConfig,
  options: InstallOptions = {},
  uninstall = false,
): InstallResult {
  const home = options.configHome ?? homedir();
  const registryPath = join(directory, "installations.json");
  const registry: Registry = readJsonOr(registryPath, registrySchema, {});
  const selected = uninstall
    ? (Object.keys(HARNESSES) as CliHarness[]).filter((name) =>
        existsSync(join(home, ...HARNESSES[name].configPath)),
      )
    : detectHarnesses();
  const url = mcpUrl(config);
  const failures: InstallFailure[] = [];
  for (const harness of selected) {
    try {
      wireHarness(
        directory,
        config,
        harness,
        home,
        url,
        registry,
        registryPath,
        options,
        uninstall,
      );
    } catch (error) {
      failures.push({
        harness,
        message: error instanceof Error ? error.message : "unknown error",
        native: error instanceof NativeRegistrationFailed,
      });
    }
  }
  if (!options.noShellRc) shellRc(home, config, uninstall);
  return { harnesses: selected, failures };
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
    const expected = definition.mcp(url, config.key, {
      directory,
      node: config.node,
      server: config.server,
    });
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
