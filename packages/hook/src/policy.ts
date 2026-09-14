import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateToolCall } from "../../core/policy/matcher.js";
import type {
  CommandPattern,
  ToolCall,
  ToolPolicy,
  ToolPolicyRule,
  ToolPolicyDecision,
} from "../../core/schemas/tool-policy.js";
import { isCode, writeAtomic } from "./files.js";

/**
 * Tool/command policy enforcement (ADR 0080), the on-machine half. This module is the ONE
 * decision path shared by both bundles: `hook.js` (the shell-harness pre-tool hook) and
 * `pi-extension.mjs` (pi's in-process `tool_call` handler). It is deliberately zod-free so
 * importing it does not pull zod into the pi extension bundle (kept ~6 KB); the only core
 * code it reaches is `evaluateToolCall`, a pure function whose own imports are types and so
 * erase to nothing (importing the policy index or the zod schema would pull the
 * schema-catalog chain, ~436 KB — the hook-bundle-import-bloat trap). The server response is
 * validated with zod where it is fetched (`policy-sync.ts`, `hook.js` only); the cache on
 * disk is written by our own uploader, so hook mode reads it with a light structural guard
 * and, on any doubt, treats it as no policy — which allows the call (fail open).
 */

/** The cached org policy, beside `config.json`, the recall and guidance caches. */
export const POLICY_CACHE_FILE = "tool-policy.json";
/** Blocked/warned decisions the uploader forwards; one file per decision. */
const VIOLATION_DIR = ["tool-policy", "violations"];

export function policyCachePath(directory: string): string {
  return join(directory, POLICY_CACHE_FILE);
}
export function violationDir(directory: string): string {
  return join(directory, ...VIOLATION_DIR);
}

const ACTIONS = new Set(["deny", "warn", "allow"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const PATTERN_KINDS = new Set(["substring", "regex"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPattern(value: unknown): value is CommandPattern {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    PATTERN_KINDS.has(value.kind) &&
    typeof value.value === "string"
  );
}
function isRule(value: unknown): value is ToolPolicyRule {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.description === undefined ||
      typeof value.description === "string") &&
    Array.isArray(value.harnesses) &&
    value.harnesses.every((entry) => typeof entry === "string") &&
    typeof value.tool === "string" &&
    Array.isArray(value.command_patterns) &&
    value.command_patterns.every(isPattern) &&
    typeof value.action === "string" &&
    ACTIONS.has(value.action) &&
    typeof value.severity === "string" &&
    SEVERITIES.has(value.severity)
  );
}
/** A structurally-valid `ToolPolicy`, else null (the value the uploader also wrote or a
 * bundle that predates the field never crashes the matcher). */
function asPolicy(value: unknown): ToolPolicy | null {
  if (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.rules)
  ) {
    const rules = value.rules.filter(isRule);
    if (rules.length === value.rules.length)
      return { enabled: value.enabled, rules };
  }
  return null;
}

/**
 * The cached policy, or null when there is none: a missing cache, an empty or malformed
 * file, or a shape this bundle cannot read. A null policy means "allow", the same as a
 * disabled one. Never throws and never touches the network.
 */
export function readCachedPolicy(directory: string): ToolPolicy | null {
  let text: string;
  try {
    text = readFileSync(policyCachePath(directory), "utf8");
  } catch {
    return null; // Missing cache (never synced) or unreadable: allow.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  // The uploader wraps the policy with sync metadata (`{ v, fetchedAt, revision, policy }`);
  // a bare policy object is also accepted so the reader survives a format change.
  const candidate =
    isRecord(parsed) && "policy" in parsed ? parsed.policy : parsed;
  return asPolicy(candidate);
}

const ALLOW: ToolPolicyDecision = {
  decision: "allow",
  matched_rule_id: null,
  severity: null,
  reason: null,
};
/** The single decision, over the cached policy. A null policy allows every call. */
export function decide(
  call: ToolCall,
  policy: ToolPolicy | null,
): ToolPolicyDecision {
  if (!policy) return ALLOW;
  return evaluateToolCall(call, policy);
}

/**
 * One blocked or warned decision, enqueued for the uploader. A blocked call fires no
 * post-tool event, so the transcript never carries it and the server's projection cannot
 * see it; the pre-tool hook records it here instead. The raw command is kept (in a 0600
 * file under the user's own data directory, exactly like the transcript spool the uploader
 * already holds); the server masks and fingerprints it on receipt, so redaction — and thus
 * secretlint — stays out of this bundle. `id` is the stable row id the server dedupes on,
 * so a re-flush after a lost acknowledgement never double-records.
 */
export interface ToolPolicyDecisionRecord {
  id: string;
  v: 1;
  sessionId: string;
  harness: ToolCall["harness"];
  tool: string;
  command: string | null;
  ruleId: string | null;
  decision: "deny" | "warn";
  severity: ToolPolicyDecision["severity"];
  matchedAt: string;
}
/**
 * Writes one decision to the spool, minting its stable id. Best effort: telemetry never
 * blocks or fails a call, so the caller ignores the outcome and never awaits it.
 */
export function spoolDecision(
  directory: string,
  record: Omit<ToolPolicyDecisionRecord, "id" | "v">,
): void {
  const id = randomUUID();
  const full: ToolPolicyDecisionRecord = { id, v: 1, ...record };
  try {
    writeAtomic(join(violationDir(directory), `${id}.json`), full);
  } catch (error) {
    if (!isCode(error, "ENOSPC")) {
      /* Any other failure is swallowed: the decision was already delivered to the harness. */
    }
  }
}
