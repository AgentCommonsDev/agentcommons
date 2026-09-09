import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import * as z from "zod";
import {
  hookManifestSchema,
  type HookIdentity,
  type HookManifest,
} from "@agentcommons/core/schemas/ingest";
import type { HookConfig } from "./config.js";
import { hash, readJson, removeFile, writeAtomic } from "./files.js";
import { acquireLock } from "./lock.js";
import { note } from "./paths.js";

/** Installed shims check the served manifest at most this often (§6.2 self-update). */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const SELF_TEST_TIMEOUT_MS = 10_000;
/** A bundle that cannot read its own bytes reports this; no manifest ever matches it. */
const ZERO_DIGEST = "0".repeat(64);
const configuredSchema = z.strictObject({
  sha256: z.string(),
  harnesses: z.array(z.string()),
  at: z.number(),
});
const checkSchema = z.strictObject({
  checkedAt: z.number().default(0),
  /** The bundle digest and harness set the last successful `install` run wired. */
  configured: configuredSchema.optional(),
  /** Last `install` attempt; failures are retried at most hourly. */
  attemptedAt: z.number().optional(),
});
type UpdateState = z.infer<typeof checkSchema>;
function readState(directory: string): UpdateState {
  try {
    return readJson(join(directory, "update.json"), checkSchema);
  } catch {
    return { checkedAt: 0 };
  }
}
function writeState(directory: string, state: UpdateState): void {
  writeAtomic(join(directory, "update.json"), state);
}
/**
 * Reconcile runs never touch shell rc files: the exports only change with the key,
 * which the installer handles. Everything else follows the recorded install flags.
 */
function installFlags(config: HookConfig): string[] {
  const options = config.installOptions ?? {};
  return [
    ...(options.configHome ? ["--config-home", options.configHome] : []),
    "--no-shell-rc",
  ];
}
/** The installer (or a reconcile run) just wired these harnesses with this bundle. */
export function recordConfigured(
  directory: string,
  executable: string,
  harnesses: readonly string[],
): void {
  writeState(directory, {
    ...readState(directory),
    configured: {
      sha256: hookIdentity(directory, executable).sha256,
      harnesses: [...harnesses].sort(),
      at: Date.now(),
    },
  });
}
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
};

function extensionPath(directory: string): string {
  return join(directory, "pi-extension.mjs");
}
function fileDigest(path: string): string | null {
  try {
    return hash(readFileSync(path));
  } catch {
    return null;
  }
}
/** The digests every envelope reports, computed from the installed files themselves. */
export function hookIdentity(
  directory: string,
  executable: string,
): HookIdentity {
  return {
    sha256: fileDigest(executable) ?? ZERO_DIGEST,
    extensionSha256: fileDigest(extensionPath(directory)),
  };
}
function sameOrigin(server: string, path: string): URL {
  const url = new URL(path, server);
  if (url.origin !== new URL(server).origin)
    throw new Error("The manifest points outside the configured server.");
  return url;
}
async function download(
  fetcher: typeof fetch,
  url: URL,
  expected: string,
): Promise<Buffer> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Artifact download returned HTTP ${String(response.status)}.`,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_ARTIFACT_BYTES) {
    await response.body?.cancel();
    throw new Error("The artifact exceeds the size limit.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARTIFACT_BYTES)
    throw new Error("The artifact exceeds the size limit.");
  if (hash(bytes) !== expected)
    throw new Error("The downloaded artifact does not match its digest.");
  return bytes;
}
function modeOf(path: string): number {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return 0o600;
  }
}
interface Staged {
  temporary: string;
  target: string;
}
function stage(target: string, bytes: Buffer): Staged {
  // Keeps the target's extension so Node loads the staged file the way it loads the installed one.
  const temporary = `${target}.${randomUUID()}.update${extname(target)}`;
  writeFileSync(temporary, bytes, { mode: modeOf(target), flag: "wx" });
  return { temporary, target };
}
function discard(staged: Staged[]): void {
  for (const { temporary } of staged) removeFile(temporary);
}
/** The new bundle must run and print its own digest before it replaces the installed one. */
function selfTest(
  config: HookConfig,
  directory: string,
  bundle: string,
  expected: string,
): void {
  const result = spawnSync(config.node, [bundle, "version"], {
    encoding: "utf8",
    timeout: SELF_TEST_TIMEOUT_MS,
    env: { ...process.env, AGENTCOMMONS_DIR: directory },
  });
  if (result.status !== 0 || result.stdout.trim() !== expected)
    throw new Error(
      `The downloaded hook.js failed its self-test (exit ${String(result.status)}${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 200)}` : ""}).`,
    );
}
function syntaxCheck(config: HookConfig, path: string): void {
  const result = spawnSync(config.node, ["--check", path], {
    encoding: "utf8",
    timeout: SELF_TEST_TIMEOUT_MS,
  });
  if (result.status !== 0)
    throw new Error("The downloaded pi extension failed its syntax check.");
}
interface UpdateOptions {
  fetch?: typeof fetch;
  now?: () => number;
}
/**
 * Upload mode only. Once an hour the uploader compares the installed bundle and pi
 * extension with the server's manifest and, when they differ, downloads the versioned
 * artifacts from the same origin, verifies their digests, self-tests the bundle and
 * renames both into place atomically. Every failure is logged and ignored; the pending
 * batch and acknowledged cursor are never involved.
 */
export async function selfUpdate(
  directory: string,
  executable: string,
  config: HookConfig,
  options: UpdateOptions = {},
): Promise<"current" | "updated" | "skipped"> {
  const now = options.now?.() ?? Date.now();
  if (now - readState(directory).checkedAt < UPDATE_CHECK_INTERVAL_MS)
    return "skipped";
  const lock = await acquireLock(join(directory, "update.lock"));
  if (!lock) return "skipped";
  const staged: Staged[] = [];
  try {
    writeState(directory, { ...readState(directory), checkedAt: now });
    const fetcher = options.fetch ?? fetch;
    const response = await fetcher(
      sameOrigin(config.server, "/hook/manifest.json"),
      {
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `The hook manifest returned HTTP ${String(response.status)}.`,
      );
    }
    const manifest: HookManifest = hookManifestSchema.parse(
      await response.json(),
    );
    const installed = hookIdentity(directory, executable);
    const bundleUrl = sameOrigin(config.server, manifest.url);
    const extensionUrl = sameOrigin(config.server, manifest.extensionUrl);
    if (
      installed.sha256 === manifest.sha256 &&
      installed.extensionSha256 === manifest.extensionSha256
    )
      return "current";
    if (installed.sha256 !== manifest.sha256) {
      const bundle = stage(
        executable,
        await download(fetcher, bundleUrl, manifest.sha256),
      );
      staged.push(bundle);
      selfTest(config, directory, bundle.temporary, manifest.sha256);
    }
    if (installed.extensionSha256 !== manifest.extensionSha256) {
      const extension = stage(
        extensionPath(directory),
        await download(fetcher, extensionUrl, manifest.extensionSha256),
      );
      staged.push(extension);
      syntaxCheck(config, extension.temporary);
    }
    for (const { temporary, target } of staged) renameSync(temporary, target);
    note(directory, `Updated to hook ${manifest.version}.`);
    return "updated";
  } catch (error) {
    discard(staged);
    note(
      directory,
      `Hook update skipped: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "skipped";
  } finally {
    lock.release();
  }
}

/**
 * Keeps harness wiring in step with the bundle and the machine. After a swap, or when
 * a supported CLI appears that the last install run did not see, the installed bundle's
 * own `install` runs with the recorded flags. The installer only adds or replaces
 * entries carrying the agentcommons marker, backs up each config file once and restores
 * the MCP entry if a native registration fails, so a background run cannot remove or
 * overwrite anything the user configured. Failures are logged and retried at most hourly.
 */
export async function reconcileInstall(
  directory: string,
  executable: string,
  config: HookConfig,
  options: UpdateOptions = {},
): Promise<"configured" | "current" | "skipped"> {
  const now = options.now?.() ?? Date.now();
  const state = readState(directory);
  // Only a data directory that `hook.js install` set up is ever reconfigured: the
  // installer records its flags and the wiring it produced. Anything else (a test or a
  // hand-configured directory) has no wiring to keep in step and is left alone.
  if (!config.installOptions || !state.configured) return "skipped";
  const current = hookIdentity(directory, executable).sha256;
  const { detectHarnesses } = await import("./install.js");
  const detected = detectHarnesses();
  if (
    state.configured.sha256 === current &&
    sameSet(state.configured.harnesses, detected)
  )
    return "current";
  if (
    state.attemptedAt !== undefined &&
    now - state.attemptedAt < UPDATE_CHECK_INTERVAL_MS
  )
    return "skipped";
  const lock = await acquireLock(join(directory, "update.lock"));
  if (!lock) return "skipped";
  try {
    writeState(directory, { ...readState(directory), attemptedAt: now });
    const result = spawnSync(
      config.node,
      [executable, "install", ...installFlags(config)],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, AGENTCOMMONS_DIR: directory },
      },
    );
    if (result.status !== 0)
      throw new Error(
        `install exited with ${String(result.status)}: ${result.stderr.trim().slice(0, 200)}`,
      );
    // A success clears the throttle so a newly installed CLI is wired on the next run.
    writeState(directory, {
      checkedAt: readState(directory).checkedAt,
      configured: { sha256: current, harnesses: [...detected].sort(), at: now },
    });
    note(
      directory,
      `Configured harnesses ${detected.join(", ") || "(none detected)"} with bundle ${current.slice(0, 12)}.`,
    );
    return "configured";
  } catch (error) {
    note(
      directory,
      `Harness configuration skipped: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "skipped";
  } finally {
    lock.release();
  }
}
