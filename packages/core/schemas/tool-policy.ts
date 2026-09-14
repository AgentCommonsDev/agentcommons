import { z } from "zod";
import {
  harnessSchema,
  nonnegativeIntegerSchema,
  sessionIdSchema,
  utcDateTimeSchema,
} from "./common.js";

/**
 * Tool and command policy (ADR 0080). A policy is organization-scoped data: an ordered
 * list of rules a coding agent's tool calls are matched against. When the policy is
 * enabled the shim enforces the decision before a tool runs (deny blocks it, warn lets it
 * run with a note, allow permits it); the server also records every match as a governance
 * violation from captured sessions. Rules are data, one implementation reads them
 * (`evaluate` in `packages/core/policy`), never a per-harness code path.
 */

/** What a matched rule does. `allow` is an explicit exception that ends evaluation. */
export const toolPolicyActionSchema = z.enum(["deny", "warn", "allow"]);
export type ToolPolicyAction = z.output<typeof toolPolicyActionSchema>;

/** Ranked so the highest severity of the matched rules can be reported. */
export const toolPolicySeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type ToolPolicySeverity = z.output<typeof toolPolicySeveritySchema>;

/**
 * One command matcher. `substring` is a case-sensitive literal contained anywhere in the
 * command; `regex` is a JavaScript pattern. User-supplied regexes are safety-checked at
 * creation time on the server (the same ReDoS analysis redaction rules use); the shipped
 * preset patterns are hand-vetted and bounded.
 */
export const commandPatternSchema = z.strictObject({
  kind: z.enum(["substring", "regex"]),
  value: z.string().min(1).max(512),
});
export type CommandPattern = z.output<typeof commandPatternSchema>;

/**
 * One rule. It matches when the call's harness is in `harnesses` (an empty list means any
 * harness, matched by set membership, not a branch), the tool name matches the `tool` glob
 * (`*` wildcards, so `Bash`, `run_shell_command`, `mcp__*` or `*`), and, when
 * `command_patterns` is non-empty, the call carries a command that at least one pattern
 * matches. A rule with no `command_patterns` matches on the tool alone.
 */
export const toolPolicyRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  description: z.string().max(200).optional(),
  harnesses: z.array(harnessSchema).max(8).default([]),
  tool: z.string().min(1).max(128),
  command_patterns: z.array(commandPatternSchema).max(32).default([]),
  action: toolPolicyActionSchema,
  severity: toolPolicySeveritySchema,
});
export type ToolPolicyRule = z.output<typeof toolPolicyRuleSchema>;

/**
 * The organization's policy. `enabled` defaults to false: a fresh organization enforces
 * nothing until an admin turns it on, even though the shipped preset rules are present.
 */
export const toolPolicySchema = z.strictObject({
  enabled: z.boolean().default(false),
  rules: z.array(toolPolicyRuleSchema).max(500).default([]),
});
export type ToolPolicy = z.output<typeof toolPolicySchema>;

/** A normalized tool call handed to the matcher, from any harness. */
export const toolCallSchema = z.strictObject({
  harness: harnessSchema,
  tool: z.string().min(1),
  command: z.string().nullable().default(null),
});
export type ToolCall = z.output<typeof toolCallSchema>;

/** The matcher's verdict for one call. */
export const toolPolicyDecisionSchema = z.strictObject({
  decision: toolPolicyActionSchema,
  matched_rule_id: z.string().nullable(),
  severity: toolPolicySeveritySchema.nullable(),
  reason: z.string().nullable(),
});
export type ToolPolicyDecision = z.output<typeof toolPolicyDecisionSchema>;

/**
 * One policy violation recorded from a captured session (server wave). It never stores the
 * raw command: `masked_command` is the redaction masked preview and `fingerprint` the
 * salted hash, so the same flagged command correlates across sessions without the plaintext
 * (mirrors `redaction_hit`).
 */
export const toolPolicyViolationSchema = z.strictObject({
  id: sessionIdSchema,
  session_id: sessionIdSchema,
  seq: nonnegativeIntegerSchema.nullable(),
  harness: harnessSchema,
  tool: z.string(),
  rule_id: z.string().nullable(),
  decision: toolPolicyActionSchema,
  severity: toolPolicySeveritySchema.nullable(),
  enforced: z.boolean(),
  masked_command: z.string().nullable(),
  fingerprint: z.string().nullable(),
  matched_at: utcDateTimeSchema,
});
export type ToolPolicyViolation = z.output<typeof toolPolicyViolationSchema>;
