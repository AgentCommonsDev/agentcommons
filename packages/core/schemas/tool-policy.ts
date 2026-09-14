import { z } from "zod";
import {
  createListInputSchema,
  harnessSchema,
  nonnegativeIntegerSchema,
  paginatedOutput,
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
 * How a violation was recorded: `projection` when the server evaluated a captured tool call
 * from the transcript (detection, runs even while enforcement is off), `hook` when the shim's
 * pre-tool gate reported a decision it made at the moment the tool ran (a blocked deny never
 * reaches a transcript, so only the gate can report it).
 */
export const toolPolicyViolationSourceSchema = z.enum(["projection", "hook"]);
export type ToolPolicyViolationSource = z.output<
  typeof toolPolicyViolationSourceSchema
>;

/**
 * One policy violation recorded from a captured session (server wave). It never stores the
 * raw command: `masked_command` is the redaction masked preview and `fingerprint` the
 * salted hash, so the same flagged command correlates across sessions without the plaintext
 * (mirrors `redaction_hit`).
 */
export const toolPolicyViolationSchema = z.strictObject({
  id: sessionIdSchema,
  session_id: sessionIdSchema,
  source: toolPolicyViolationSourceSchema,
  seq: nonnegativeIntegerSchema.nullable(),
  harness: harnessSchema,
  tool: z.string(),
  rule_id: z.string().nullable(),
  decision: toolPolicyActionSchema,
  severity: toolPolicySeveritySchema.nullable(),
  /** Whether the organization's policy was enabled when the call was recorded. */
  enforced: z.boolean(),
  masked_command: z.string().nullable(),
  fingerprint: z.string().nullable(),
  matched_at: utcDateTimeSchema,
});
export type ToolPolicyViolation = z.output<typeof toolPolicyViolationSchema>;

// --- Server wave: admin management and shim sync request/response shapes ---

/**
 * The organization's policy as an admin reads it (`GET /admin/tool-policy`) and as the shim
 * syncs it (`GET /tool-policy`, key-authenticated). `revision` bumps on every replace so the
 * shim caches the document and re-parses only when it changes; the shim then evaluates
 * offline with `evaluateToolCall`, and a disabled policy allows every call.
 */
export const toolPolicyDocumentSchema = z.strictObject({
  enabled: z.boolean(),
  rules: z.array(toolPolicyRuleSchema),
  revision: nonnegativeIntegerSchema,
  updated_at: utcDateTimeSchema,
});
export type ToolPolicyDocument = z.output<typeof toolPolicyDocumentSchema>;

/**
 * The replace body (`PUT /admin/tool-policy`): the whole policy an admin saves at once. The
 * service safety-checks every user-supplied command regex with the redaction ReDoS analysis
 * before the write and rejects an unsafe pattern with a 400.
 */
export const toolPolicyReplaceInputSchema = toolPolicySchema;
export type ToolPolicyReplaceInput = z.output<
  typeof toolPolicyReplaceInputSchema
>;

/** Sort and filter the recorded violations, newest match first by default. */
export const toolPolicyViolationSortKeys = ["matched_at", "seq"] as const;
export const toolPolicyViolationsInputSchema = createListInputSchema(
  toolPolicyViolationSortKeys,
).extend({
  filters: z
    .strictObject({
      session_id: sessionIdSchema.optional(),
      source: toolPolicyViolationSourceSchema.optional(),
      harness: harnessSchema.optional(),
      rule_id: z.string().min(1).max(64).optional(),
      decision: toolPolicyActionSchema.optional(),
      severity: toolPolicySeveritySchema.optional(),
      enforced: z.boolean().optional(),
    })
    .default({}),
});
export const toolPolicyViolationsOutputSchema = paginatedOutput(
  toolPolicyViolationSchema,
);

/**
 * The pre-tool gate's telemetry (ADR 0080): a batch of decisions the shim made and spooled,
 * flushed by its uploader (`POST /tool-policy/violations`, key-authenticated). A blocked deny
 * emits no post-tool transcript event, so the gate is the only source for it. The raw command
 * is sent for the server to mask and fingerprint on receipt with the redaction helpers; it is
 * never stored raw. These are the decisions an enabled policy made, so the server records them
 * as enforced.
 */
export const toolPolicyDecisionReportSchema = z.strictObject({
  /**
   * A stable client-generated id for this spooled decision, so a re-flush after a crash that
   * lost the acknowledgement does not double-record it. Optional; the server assigns one when
   * absent.
   */
  id: sessionIdSchema.optional(),
  session_id: sessionIdSchema,
  harness: harnessSchema,
  tool: z.string().min(1).max(128),
  /** The raw command the gate evaluated, or null for a tool without one. Masked on receipt. */
  command: z.string().max(16_384).nullable().default(null),
  rule_id: z.string().min(1).max(64),
  decision: z.enum(["deny", "warn"]),
  severity: toolPolicySeveritySchema,
  seq: nonnegativeIntegerSchema.nullable().default(null),
  matched_at: utcDateTimeSchema,
});
export type ToolPolicyDecisionReport = z.output<
  typeof toolPolicyDecisionReportSchema
>;
export const toolPolicyViolationsReportInputSchema = z.strictObject({
  violations: z.array(toolPolicyDecisionReportSchema).min(1).max(500),
});
export const toolPolicyViolationsReportOutputSchema = z.strictObject({
  accepted: nonnegativeIntegerSchema,
});
