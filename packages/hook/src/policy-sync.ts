import { statSync } from "node:fs";
import * as z from "zod";
import type { HookConfig } from "./config.js";
import { jsonFiles, readJsonOr, removeFile, writeAtomic } from "./files.js";
import { note } from "./paths.js";
import { policyCachePath, violationDir } from "./policy.js";

/**
 * The uploader half of tool policy (ADR 0080), run only in upload mode (detached, network
 * allowed). It fetches the organization's policy and caches it on the machine for the
 * offline pre-tool hook to read, and it flushes the blocked/warned decisions the pre-tool
 * hook spooled to the server. Both live here, in a `hook.js`-only module, so the zod schema
 * that validates the HTTP boundary never reaches the zod-free `policy.ts` shared with the pi
 * extension. This module imports no core schema (the shapes are small and local), so it does
 * not pull the schema-catalog chain into the bundle.
 */

/** The policy is re-fetched at most this often, like the recall hint (§6.2 budget). */
export const POLICY_REFRESH_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** The server accepts 1..500 violations per batch. */
const MAX_BATCH = 500;
/** Hard bound on the spool so a persistently unreachable server cannot fill the disk. */
const SPOOL_CAP = 1000;
/** The command the server accepts; longer commands are truncated before they leave. */
const MAX_COMMAND = 16_384;

const HARNESS = z.enum(["CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"]);
const SEVERITY = z.enum(["low", "medium", "high", "critical"]);

/** The rule shape, mirrored from `core/schemas/tool-policy`; loose so a newer server that
 * adds rule fields still validates and the extra fields ride through to the cache. */
const ruleSchema = z.looseObject({
  id: z.string(),
  description: z.string().optional(),
  harnesses: z.array(HARNESS),
  tool: z.string(),
  command_patterns: z.array(
    z.looseObject({ kind: z.enum(["substring", "regex"]), value: z.string() }),
  ),
  action: z.enum(["deny", "warn", "allow"]),
  severity: SEVERITY,
});
/** `GET /api/v1/tool-policy` (confirmed with build-tool-policy-server, 2026-09-14). */
const syncResponseSchema = z.looseObject({
  enabled: z.boolean(),
  rules: z.array(ruleSchema),
  revision: z.number().int().nonnegative().default(0),
  updated_at: z.string().optional(),
});
/** The on-disk cache the offline hook reads through `readCachedPolicy`. */
const cacheFileSchema = z.looseObject({
  v: z.literal(1),
  fetchedAt: z.number(),
  revision: z.number().int().nonnegative(),
  policy: z.looseObject({ enabled: z.boolean(), rules: z.array(ruleSchema) }),
});
type CacheFile = z.infer<typeof cacheFileSchema>;

/** The record the pre-tool hook spooled (mirrors `ToolPolicyDecisionRecord`). */
const spoolRecordSchema = z.looseObject({
  id: z.string().min(1),
  v: z.literal(1),
  sessionId: z.string().min(1),
  harness: HARNESS,
  tool: z.string(),
  command: z.string().nullable(),
  ruleId: z.string().nullable(),
  decision: z.enum(["deny", "warn"]),
  severity: SEVERITY.nullable(),
  matchedAt: z.string(),
});

export interface PolicyOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Refreshes the cached organization policy, at most every {@link POLICY_REFRESH_MS}. On a
 * successful fetch the cache is replaced; on any failure the last-known policy is kept (only
 * its timestamp is advanced so a down server is not hammered), and a machine that has never
 * synced simply stays without a cache — which the hook reads as "allow". Never throws.
 */
export async function refreshToolPolicy(
  directory: string,
  config: HookConfig,
  options: PolicyOptions = {},
): Promise<"refreshed" | "current" | "skipped"> {
  const now = options.now?.() ?? Date.now();
  const path = policyCachePath(directory);
  const cache = readJsonOr(path, cacheFileSchema, null);
  if (cache && now - cache.fetchedAt < POLICY_REFRESH_MS) return "current";
  try {
    const response = await (options.fetch ?? fetch)(
      new URL("/api/v1/tool-policy", config.server),
      {
        headers: {
          authorization: `Bearer ${config.key}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `The tool policy returned HTTP ${String(response.status)}.`,
      );
    }
    const body = syncResponseSchema.parse(await response.json());
    const value: CacheFile = {
      v: 1,
      fetchedAt: now,
      revision: body.revision,
      policy: { enabled: body.enabled, rules: body.rules },
    };
    writeAtomic(path, value);
    return "refreshed";
  } catch (error) {
    if (cache) writeAtomic(path, { ...cache, fetchedAt: now });
    note(
      directory,
      `Tool policy refresh skipped: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "skipped";
  }
}

/** The oldest spool files first; used both to send in order and to trim past the cap. */
function spoolByAge(directory: string): string[] {
  return jsonFiles(violationDir(directory))
    .map((file) => {
      try {
        return { file, at: statSync(file).mtimeMs };
      } catch {
        return { file, at: 0 };
      }
    })
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.file);
}

/**
 * Flushes the spooled blocked/warned decisions to the server in one batch (up to
 * {@link MAX_BATCH}); a persistently over-full spool is trimmed to {@link SPOOL_CAP} oldest
 * first. Sent files are removed only on a 202; every other outcome leaves them for the next
 * uploader run. The raw command leaves the machine only here and in the 0600 spool file
 * (the server masks and fingerprints on receipt). Never throws.
 */
export async function flushToolPolicyViolations(
  directory: string,
  config: HookConfig,
  options: PolicyOptions = {},
): Promise<"sent" | "empty" | "skipped"> {
  let files = spoolByAge(directory);
  if (files.length > SPOOL_CAP) {
    for (const stale of files.slice(0, files.length - SPOOL_CAP))
      removeFile(stale);
    files = files.slice(files.length - SPOOL_CAP);
  }
  if (!files.length) return "empty";
  const batch = files.slice(0, MAX_BATCH);
  const violations: unknown[] = [];
  const sending: string[] = [];
  for (const file of batch) {
    const record = readJsonOr(file, spoolRecordSchema, null);
    if (!record) {
      removeFile(file); // Unreadable or written by a bundle this one cannot parse: drop it.
      continue;
    }
    sending.push(file);
    violations.push({
      id: record.id,
      session_id: record.sessionId,
      harness: record.harness,
      tool: record.tool,
      command:
        record.command === null ? null : record.command.slice(0, MAX_COMMAND),
      rule_id: record.ruleId ?? "",
      decision: record.decision,
      severity: record.severity ?? "low",
      seq: null,
      matched_at: record.matchedAt,
    });
  }
  if (!violations.length) return "empty";
  try {
    const response = await (options.fetch ?? fetch)(
      new URL("/api/v1/tool-policy/violations", config.server),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify({ violations }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 202) {
      await response.body?.cancel();
      for (const file of sending) removeFile(file);
      return "sent";
    }
    await response.body?.cancel();
    throw new Error(
      `The violations endpoint returned HTTP ${String(response.status)}.`,
    );
  } catch (error) {
    note(
      directory,
      `Tool policy violations flush skipped: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "skipped";
  }
}
