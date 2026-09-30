import { v7 as uuidv7 } from "uuid";
import type { Prisma } from "@agentcommons/db";
import { type PrismaClient } from "@agentcommons/db";
import {
  type Harness,
  type ProjectedMessage,
  type ToolPolicyRule,
  toolPolicyDocumentSchema,
  toolPolicySchema,
  toolPolicyViolationsInputSchema,
  toolPolicyViolationsOutputSchema,
  toolPolicyViolationsReportInputSchema,
  toolPolicyViolationsReportOutputSchema,
} from "@agentcommons/core";
import {
  commandFromToolInput,
  defaultToolPolicy,
  evaluateToolCall,
  presetRules,
} from "@agentcommons/core/policy";
import {
  analyzeExpressionSafety,
  buildSample,
  defaultSampleConfig,
  maskPreview,
} from "@agentcommons/core/redaction";
import type { AuditService } from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { offsetPage, wireValue } from "./read-budget.js";

/**
 * A fresh organization's tool policy: the shipped preset rules present, enforcement off (ADR
 * 0080). Idempotent, so the startup seed and per-organization creation both call it and a
 * second call inserts nothing.
 */
export async function seedToolPolicy(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<number> {
  const policy = defaultToolPolicy();
  const inserted = await tx.toolPolicy.createMany({
    data: [
      {
        organizationId,
        enabled: policy.enabled,
        rules: policy.rules,
        revision: 0,
        updatedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  return inserted.count;
}

/** The masked preview and salted fingerprint of a command, never the command itself (§5.3). */
function commandSample(command: string | null): {
  maskedCommand: string | null;
  fingerprint: string | null;
} {
  if (command === null) return { maskedCommand: null, fingerprint: null };
  const config = defaultSampleConfig();
  if (!config)
    return { maskedCommand: maskPreview(command), fingerprint: null };
  const sample = buildSample(command, config);
  return { maskedCommand: sample.preview, fingerprint: sample.fingerprint };
}

/** One violation the projection derives from a captured tool call, before it is stored. */
export interface ProjectedViolation {
  seq: number | null;
  harness: Harness;
  tool: string;
  ruleId: string | null;
  decision: "deny" | "warn" | "allow";
  severity: "low" | "medium" | "high" | "critical" | null;
  maskedCommand: string | null;
  fingerprint: string | null;
}

/**
 * Evaluate every captured tool call in a session's projection against the organization's
 * rules and return the matches (deny or warn; an explicit allow is not a violation). The
 * rules are evaluated as if enabled so detection runs even while enforcement is off (the
 * caller records `enforced` separately); harness differences are data on the call, never a
 * branch. Pure, so it is covered by unit tests and reused by the projection.
 */
export function projectToolPolicyViolations(
  rules: readonly ToolPolicyRule[],
  harness: Harness,
  messages: readonly ProjectedMessage[],
): ProjectedViolation[] {
  const policy = { enabled: true, rules: [...rules] };
  const violations: ProjectedViolation[] = [];
  for (const message of messages) {
    if (message.kind !== "TOOL_USE" || !message.tool_name) continue;
    const command = commandFromToolInput(message.tool_input);
    const decision = evaluateToolCall(
      { harness, tool: message.tool_name, command },
      policy,
    );
    if (decision.decision === "allow") continue;
    const { maskedCommand, fingerprint } = commandSample(command);
    violations.push({
      seq: message.seq,
      harness,
      tool: message.tool_name,
      ruleId: decision.matched_rule_id,
      decision: decision.decision,
      severity: decision.severity,
      maskedCommand,
      fingerprint,
    });
  }
  return violations;
}

/**
 * Replace a session's projection-sourced violations with a freshly derived set, inside the
 * publish transaction (§9.7). Only `projection` rows are touched, so a blocked deny the shim
 * reported (`source = "hook"`) is never wiped by a re-projection. `enforced` records whether
 * the policy was enabled when the session was projected.
 */
export async function persistToolPolicyViolations(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
  enforced: boolean,
  violations: readonly ProjectedViolation[],
): Promise<void> {
  await tx.toolPolicyViolation.deleteMany({
    where: { organizationId, sessionId, source: "projection" },
  });
  if (!violations.length) return;
  const matchedAt = new Date();
  await tx.toolPolicyViolation.createMany({
    data: violations.map((violation) => ({
      organizationId,
      id: uuidv7(),
      sessionId,
      source: "projection",
      seq: violation.seq,
      harness: violation.harness,
      tool: violation.tool,
      ruleId: violation.ruleId,
      decision: violation.decision,
      severity: violation.severity,
      enforced,
      maskedCommand: violation.maskedCommand,
      fingerprint: violation.fingerprint,
      matchedAt,
    })),
  });
}

const violationSortFields = {
  matched_at: "matchedAt",
  seq: "seq",
} as const;

type ViolationRow = Prisma.ToolPolicyViolationGetPayload<object>;
function violationOutput(row: ViolationRow) {
  return {
    id: row.id,
    session_id: row.sessionId,
    source: row.source,
    seq: row.seq,
    harness: row.harness,
    tool: row.tool,
    rule_id: row.ruleId,
    decision: row.decision,
    severity: row.severity,
    enforced: row.enforced,
    masked_command: row.maskedCommand,
    fingerprint: row.fingerprint,
    matched_at: row.matchedAt.toISOString(),
  };
}

/** The set of shipped preset command regexes; these are hand-vetted and scan-bounded, so an
 * admin who saves the default policy back is not rejected by the ReDoS analysis that guards
 * user-authored patterns. */
function presetRegexValues(): Set<string> {
  return new Set(
    presetRules().flatMap((rule) =>
      rule.command_patterns
        .filter((pattern) => pattern.kind === "regex")
        .map((pattern) => pattern.value),
    ),
  );
}

export class ToolPolicyService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      cursors: CursorCodec;
    },
  ) {}

  private async read(organizationId: string) {
    const row = await this.dependencies.prisma.toolPolicy.findUnique({
      where: { organizationId },
    });
    return toolPolicyDocumentSchema.parse({
      enabled: row?.enabled ?? false,
      rules: row?.rules ?? [],
      revision: row?.revision ?? 0,
      updated_at: (row?.updatedAt ?? new Date(0)).toISOString(),
    });
  }

  /** The caller organization's active policy for the shim to cache and evaluate offline. */
  active(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "tool_policy.sync", resourceType: "tool_policy" },
      (caller) => this.read(caller.organizationId),
      {
        describeResult: (result) => ({
          enabled: result.enabled,
          rules: result.rules.length,
          revision: result.revision,
        }),
      },
    );
  }

  /** The policy an admin reads to manage it. */
  get(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "tool_policy.read", resourceType: "tool_policy" },
      (caller) => this.read(caller.organizationId),
      {
        permission: "admin",
        describeResult: (result) => ({
          enabled: result.enabled,
          rules: result.rules.length,
          revision: result.revision,
        }),
      },
    );
  }

  /** Replace the whole policy: enabled flag and ordered rules, revision bumped. */
  replace(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      { action: "tool_policy.replace", resourceType: "tool_policy" },
      async (tx, caller) => {
        await lockOrganization(tx, caller);
        const policy = toolPolicySchema.parse(input);
        const preset = presetRegexValues();
        for (const rule of policy.rules)
          for (const pattern of rule.command_patterns) {
            if (pattern.kind !== "regex" || preset.has(pattern.value)) continue;
            const safety = analyzeExpressionSafety(pattern.value);
            if (safety !== "safe")
              throw new ServiceError(
                400,
                "UNSAFE_PATTERN",
                `Rule "${rule.id}" has a command pattern that ${
                  safety === "invalid"
                    ? "is not a valid regular expression"
                    : safety === "unknown"
                      ? "could not be verified as safe; simplify it"
                      : "can match empty text or backtrack excessively"
                }.`,
              );
          }
        const rules = policy.rules as unknown as Prisma.InputJsonValue;
        const row = await tx.toolPolicy.upsert({
          where: { organizationId: caller.organizationId },
          create: {
            organizationId: caller.organizationId,
            enabled: policy.enabled,
            rules,
            revision: 1,
            updatedAt: new Date(),
          },
          update: {
            enabled: policy.enabled,
            rules,
            revision: { increment: 1 },
          },
        });
        return {
          result: toolPolicyDocumentSchema.parse({
            enabled: row.enabled,
            rules: row.rules,
            revision: row.revision,
            updated_at: row.updatedAt.toISOString(),
          }),
          detail: { enabled: row.enabled, rules: policy.rules.length },
        };
      },
    );
  }

  /** Recorded violations, newest match first, filterable and CSV-exportable. */
  violations(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "tool_policy.violations.list",
        resourceType: "tool_policy_violation",
      },
      async (caller) => {
        const request = toolPolicyViolationsInputSchema.parse(input);
        const { cursor, ...query } = request;
        const sort = query.sort ?? "matched_at";
        const filters = request.filters;
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "tool_policy.violations.list",
          query: { ...query, sort },
        });
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          cursor,
          request.limit,
          (skip, take) =>
            this.dependencies.prisma.toolPolicyViolation.findMany({
              where: {
                organizationId: caller.organizationId,
                ...(filters.session_id
                  ? { sessionId: filters.session_id }
                  : {}),
                ...(filters.source ? { source: filters.source } : {}),
                ...(filters.harness ? { harness: filters.harness } : {}),
                ...(filters.rule_id ? { ruleId: filters.rule_id } : {}),
                ...(filters.decision ? { decision: filters.decision } : {}),
                ...(filters.severity ? { severity: filters.severity } : {}),
                ...(filters.enforced === undefined
                  ? {}
                  : { enforced: filters.enforced }),
              },
              orderBy: [
                { [violationSortFields[sort]]: query.order },
                { id: "desc" },
              ],
              skip,
              take,
            }),
        );
        return toolPolicyViolationsOutputSchema.parse({
          items: page.items.map(violationOutput),
          cursor: page.cursor,
        });
      },
      {
        describeResult: (result) => ({ count: result.items.length }),
        permission: "admin",
      },
    );
  }

  /**
   * Record the pre-tool gate's decisions (ADR 0080): the shim's uploader flushes blocked and
   * warned calls it evaluated locally, sending the raw command, which the server masks and
   * fingerprints here and never stores raw. These are decisions an enabled policy made, so
   * they are recorded as enforced with `source = "hook"`; a stable client id makes a re-flush
   * idempotent.
   */
  report(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "ingest",
      {
        action: "tool_policy.violations.report",
        resourceType: "tool_policy_violation",
        statusCode: 202,
      },
      async (tx, caller) => {
        const request = toolPolicyViolationsReportInputSchema.parse(input);
        const rows = request.violations.map((violation) => {
          const { maskedCommand, fingerprint } = commandSample(
            violation.command,
          );
          return {
            organizationId: caller.organizationId,
            id: violation.id ?? uuidv7(),
            sessionId: violation.session_id,
            source: "hook",
            seq: violation.seq,
            harness: violation.harness,
            tool: violation.tool,
            ruleId: violation.rule_id,
            decision: violation.decision,
            severity: violation.severity,
            enforced: true,
            maskedCommand,
            fingerprint,
            matchedAt: new Date(violation.matched_at),
          };
        });
        const inserted = await tx.toolPolicyViolation.createMany({
          data: rows,
          skipDuplicates: true,
        });
        return {
          result: toolPolicyViolationsReportOutputSchema.parse({
            accepted: inserted.count,
          }),
          detail: { reported: rows.length, accepted: inserted.count },
        };
      },
    );
  }
}
