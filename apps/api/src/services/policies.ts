import { createPolicyCache } from "./policy-cache.js";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  Prisma,
  type PrismaClient,
  type RedactionPolicy as PolicyRow,
} from "@agentcommons/db";
import {
  builtinPolicies,
  type PolicyCache,
  policyDefinitionSchema,
  type PolicyDefinition,
  type RedactionCount,
} from "@agentcommons/core/redaction";
import {
  reasonInputSchema,
  redactionHitsInputSchema,
  redactionHitsOutputSchema,
  redactionPoliciesInputSchema,
  redactionPoliciesOutputSchema,
  redactionPolicySchema,
  redactionRunSessionsInputSchema,
  redactionRunSessionsOutputSchema,
  redactionRunsInputSchema,
  redactionRunsOutputSchema,
  redactionSummaryOutputSchema,
  redactionTestInputSchema,
  redactionTestOutputSchema,
  sessionIdSchema,
  type CallerContext,
} from "@agentcommons/core";
import type { AuditDescription, AuditService } from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { offsetPage, wireValue } from "./read-budget.js";
import type { RedactionHitInput } from "./trace-rescan.js";

function data(definition: PolicyDefinition) {
  return {
    name: definition.name,
    kind: definition.kind,
    enabled: definition.enabled,
    replacement: definition.replacement ?? `[REDACTED:${definition.name}]`,
    pattern: definition.kind === "REGEX" ? definition.pattern : null,
    flags: definition.kind === "REGEX" ? definition.flags : null,
    ruleId: definition.kind === "SECRETLINT_RULE" ? definition.ruleId : null,
    options:
      definition.kind === "SECRETLINT_RULE"
        ? definition.options
        : Prisma.DbNull,
  };
}

export async function seedPolicies(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string | null = null,
  extras: readonly PolicyDefinition[] = [],
): Promise<number> {
  const rows = [
    ...builtinPolicies,
    ...extras.map((policy) => ({ ...policy, builtin: false })),
  ];
  const inserted = await tx.redactionPolicy.createMany({
    data: rows.map((row) => ({
      ...data(row),
      id: uuidv7(),
      organizationId,
      builtin: row.builtin,
      createdByUserId: userId,
    })),
    skipDuplicates: true,
  });
  return inserted.count;
}

function output(row: PolicyRow) {
  return redactionPolicySchema.parse({
    id: row.id,
    organization_id: row.organizationId,
    name: row.name,
    kind: row.kind,
    pattern: row.pattern,
    flags: row.flags,
    rule_id: row.ruleId,
    options: row.options,
    replacement: row.replacement,
    enabled: row.enabled,
    builtin: row.builtin,
    created_by_user_id: row.createdByUserId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}
const sortFields = {
  name: "name",
  kind: "kind",
  enabled: "enabled",
  builtin: "builtin",
  created_at: "createdAt",
  updated_at: "updatedAt",
} as const;
const runSortFields = {
  created_at: "createdAt",
  state: "state",
  redaction_count: "redactionCount",
  total_sessions: "totalSessions",
} as const;
const runSessionSortFields = {
  processed_at: "processedAt",
  redaction_count: "redactionCount",
} as const;
const hitSortFields = {
  redacted_at: "redactedAt",
  count: "count",
  seq: "seq",
} as const;
const DAY_MS = 86_400_000;
/** The rows one grouped SQL read of the counters returns: one per policy plus the grand total (null policy). */
const redactionLedgerRowSchema = z.strictObject({
  policy_id: z.uuid().nullable(),
  name: z.string().nullable(),
  kind: z.string().nullable(),
  enabled: z.boolean().nullable(),
  count: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
});
const windowRowSchema = z.strictObject({
  last_7: z.number().int().nonnegative(),
  last_30: z.number().int().nonnegative(),
});
const distinctSecretRowSchema = z.strictObject({
  policy_id: z.uuid(),
  distinct_secrets: z.number().int().nonnegative(),
});
export class PolicyService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      cursors: CursorCodec;
      cache: PolicyCache;
    },
  ) {}

  list(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "redaction.policies.list", resourceType: "redaction_policy" },
      async () => {
        const caller = requirePermission(context, "admin");
        const request = redactionPoliciesInputSchema.parse(input);
        const { cursor, ...query } = request;
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "redaction.policies.list",
          query: { ...query, sort: query.sort ?? "name" },
        });
        const filters = request.filters;
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          cursor,
          request.limit,
          async (skip, take) =>
            (
              await this.dependencies.prisma.redactionPolicy.findMany({
                where: {
                  organizationId: caller.organizationId,
                  ...(filters.name
                    ? { name: { contains: filters.name, mode: "insensitive" } }
                    : {}),
                  ...(filters.kind ? { kind: filters.kind } : {}),
                  ...(filters.enabled === undefined
                    ? {}
                    : { enabled: filters.enabled }),
                  ...(filters.builtin === undefined
                    ? {}
                    : { builtin: filters.builtin }),
                },
                orderBy: [
                  { [sortFields[request.sort ?? "name"]]: request.order },
                  { id: "asc" },
                ],
                skip,
                take,
              })
            ).map(output),
        );
        return redactionPoliciesOutputSchema.parse({
          items: page.items,
          cursor: page.cursor,
        });
      },
      {
        permission: "admin",
      },
    );
  }

  /** A policy mutation, then this process forgets the organization's cached policies. */
  private async mutate<T>(
    context: ServiceContext,
    description: AuditDescription,
    execute: (
      tx: Prisma.TransactionClient,
      caller: CallerContext,
    ) => Promise<{ result: T; detail?: unknown; resourceIds?: string[] }>,
  ) {
    const value = await mutationOperation(
      this.dependencies,
      context,
      "admin",
      description,
      execute,
    );
    if (context.caller)
      this.dependencies.cache.invalidate(context.caller.organizationId);
    return value;
  }

  save(context: ServiceContext, id: string | null, input: unknown) {
    return this.mutate(
      context,
      {
        action: id ? "redaction.policies.update" : "redaction.policies.create",
        resourceType: "redaction_policy",
      },
      async (tx, caller) => {
        await lockOrganization(tx, caller);
        const policy = policyDefinitionSchema.parse(input);
        const existing = id
          ? await tx.redactionPolicy.findFirst({
              where: { id, organizationId: caller.organizationId },
            })
          : null;
        if (id && !existing)
          throw new ServiceError(
            404,
            "NOT_FOUND",
            "The redaction policy was not found.",
          );
        if (existing?.builtin && policy.name !== existing.name)
          throw new ServiceError(
            400,
            "BUILTIN_NAME",
            "Keep the built-in policy name.",
          );
        if (
          !existing?.builtin &&
          builtinPolicies.some((builtin) => builtin.name === policy.name)
        )
          throw new ServiceError(
            409,
            "BUILTIN_NAME",
            "That name belongs to a built-in policy.",
          );
        const duplicate = await tx.redactionPolicy.findFirst({
          where: {
            organizationId: caller.organizationId,
            name: policy.name,
            ...(id ? { id: { not: id } } : {}),
          },
        });
        if (duplicate)
          throw new ServiceError(
            409,
            "POLICY_EXISTS",
            "A policy with that name already exists.",
          );
        const redactor = await createPolicyCache(tx).get(caller.organizationId);
        for (const value of [
          policy.name,
          policy.replacement ?? `[REDACTED:${policy.name}]`,
          policy.kind === "REGEX"
            ? policy.pattern
            : JSON.stringify(policy.options),
        ]) {
          if ((await redactor.text(value)).value !== value)
            throw new ServiceError(
              400,
              "POLICY_CONTAINS_SECRET",
              "Use a pattern or replacement without literal credentials.",
            );
        }
        const row = existing
          ? await tx.redactionPolicy.update({
              where: {
                organizationId_id: {
                  organizationId: caller.organizationId,
                  id: existing.id,
                },
              },
              data: data(policy),
            })
          : await tx.redactionPolicy.create({
              data: {
                ...data(policy),
                id: uuidv7(),
                organizationId: caller.organizationId,
                builtin: false,
                createdByUserId: caller.userId,
              },
            });
        return {
          result: output(row),
          resourceIds: [row.id],
          detail: { name: row.name, kind: row.kind, enabled: row.enabled },
        };
      },
    );
  }

  remove(context: ServiceContext, id: string, input: unknown) {
    return this.mutate(
      context,
      {
        action: "redaction.policies.delete",
        resourceType: "redaction_policy",
        resourceIds: [id],
      },
      async (tx, caller) => {
        await lockOrganization(tx, caller);
        const row = await tx.redactionPolicy.findFirst({
          where: { id, organizationId: caller.organizationId },
        });
        if (!row)
          throw new ServiceError(
            404,
            "NOT_FOUND",
            "The redaction policy was not found.",
          );
        if (row.builtin)
          throw new ServiceError(
            400,
            "BUILTIN_POLICY",
            "Disable built-in policies instead of deleting them.",
          );
        const { reason } = reasonInputSchema.parse(input);
        const hits = await tx.redactionEvent.aggregate({
          where: { organizationId: caller.organizationId, policyId: id },
          _sum: { count: true },
        });
        await tx.redactionEvent.deleteMany({
          where: { organizationId: caller.organizationId, policyId: id },
        });
        await tx.redactionPolicy.delete({
          where: {
            organizationId_id: { organizationId: caller.organizationId, id },
          },
        });
        return {
          result: { id, updated: true },
          detail: { reason, deleted_hit_count: hits._sum.count ?? 0 },
        };
      },
    );
  }

  /**
   * The organization's redaction ledger: totals and per-policy counts from the counters
   * (`redaction_event`), recent windows from what applied them (receipts at capture, run
   * targets at rescan) and the run tally. One grouped scan per relation; no message rows.
   */
  summary(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "redaction.summary", resourceType: "redaction_policy" },
      async (caller) => {
        const { prisma } = this.dependencies;
        const organizationId = caller.organizationId;
        const now = Date.now();
        const since7 = new Date(now - 7 * DAY_MS);
        const since30 = new Date(now - 30 * DAY_MS);
        const [ledger, captured, rescanned, runs, distinct] = await Promise.all(
          [
            prisma.$queryRaw<unknown[]>`
            SELECT p.id AS policy_id, p.name, p.kind::text AS kind, p.enabled,
                   coalesce(sum(e.count), 0)::int AS count,
                   count(DISTINCT e.session_id)::int AS sessions
            FROM redaction_policy p
            LEFT JOIN redaction_event e ON e.organization_id = p.organization_id AND e.policy_id = p.id
            WHERE p.organization_id = ${organizationId}
            GROUP BY GROUPING SETS ((p.id, p.name, p.kind, p.enabled), ())
            ORDER BY count DESC, p.name ASC`,
            prisma.$queryRaw<unknown[]>`
            SELECT coalesce(sum(redaction_count) FILTER (WHERE received_at >= ${since7}), 0)::int AS last_7,
                   coalesce(sum(redaction_count), 0)::int AS last_30
            FROM trace_receipt
            WHERE organization_id = ${organizationId} AND received_at >= ${since30}`,
            prisma.$queryRaw<unknown[]>`
            SELECT coalesce(sum(redaction_count) FILTER (WHERE processed_at >= ${since7}), 0)::int AS last_7,
                   coalesce(sum(redaction_count), 0)::int AS last_30
            FROM redaction_run_session
            WHERE organization_id = ${organizationId} AND processed_at >= ${since30}`,
            prisma.redactionRun.groupBy({
              by: ["state"],
              where: { organizationId },
              _count: { _all: true },
            }),
            // How many distinct secrets each policy caught, from an index-only grouped scan
            // of the fingerprints (§5.3, ADR 0076). One scan of the ledger, no per-row work.
            prisma.$queryRaw<unknown[]>`
            SELECT policy_id, count(DISTINCT fingerprint)::int AS distinct_secrets
            FROM redaction_hit
            WHERE organization_id = ${organizationId} AND fingerprint IS NOT NULL
            GROUP BY policy_id`,
          ],
        );
        const rows = z.array(redactionLedgerRowSchema).parse(ledger);
        const distinctSecrets = new Map(
          z
            .array(distinctSecretRowSchema)
            .parse(distinct)
            .map((row) => [row.policy_id, row.distinct_secrets]),
        );
        const total = rows.find((row) => row.policy_id === null);
        const capture = windowRowSchema.parse(captured[0]);
        const rescan = windowRowSchema.parse(rescanned[0]);
        const runCount = (states: readonly string[]) =>
          runs
            .filter((row) => states.includes(row.state))
            .reduce((sum, row) => sum + row._count._all, 0);
        return redactionSummaryOutputSchema.parse({
          total: total?.count ?? 0,
          sessions: total?.sessions ?? 0,
          last_7_days: {
            capture: capture.last_7,
            rescan: rescan.last_7,
            total: capture.last_7 + rescan.last_7,
          },
          last_30_days: {
            capture: capture.last_30,
            rescan: rescan.last_30,
            total: capture.last_30 + rescan.last_30,
          },
          by_policy: rows
            .filter((row) => row.policy_id !== null)
            .map((row) => ({
              policy_id: row.policy_id,
              name: row.name,
              kind: row.kind,
              enabled: row.enabled,
              count: row.count,
              sessions: row.sessions,
              distinct_secrets: distinctSecrets.get(row.policy_id ?? "") ?? 0,
            })),
          runs: {
            total: runCount(["queued", "running", "completed", "failed"]),
            active: runCount(["queued", "running"]),
            failed: runCount(["failed"]),
          },
        });
      },
      {
        describeResult: (result) => ({
          total: result.total,
          sessions: result.sessions,
          policies: result.by_policy.length,
        }),
        permission: "admin",
      },
    );
  }
  /** Every rescan run of the organization with its progress and how many targets it changed. */
  runs(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "redaction.rescan.list", resourceType: "redaction_run" },
      async (caller) => {
        const request = redactionRunsInputSchema.parse(input);
        const { cursor, ...query } = request;
        const sort = query.sort ?? "created_at";
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "redaction.rescan.list",
          query: { ...query, sort },
        });
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          cursor,
          request.limit,
          (skip, take) =>
            this.dependencies.prisma.redactionRun.findMany({
              where: { organizationId: caller.organizationId },
              orderBy: [{ [runSortFields[sort]]: query.order }, { id: "desc" }],
              skip,
              take,
            }),
        );
        // Second relation, one scan: the changed-target count of every run on the page.
        const changed = new Map(
          (
            await this.dependencies.prisma.redactionRunSession.groupBy({
              by: ["runId"],
              where: {
                organizationId: caller.organizationId,
                runId: { in: page.items.map((run) => run.id) },
                redactionCount: { gt: 0 },
              },
              _count: { _all: true },
            })
          ).map((row) => [row.runId, row._count._all]),
        );
        return redactionRunsOutputSchema.parse({
          items: page.items.map((run) => ({
            id: run.id,
            state: run.state,
            created_at: run.createdAt.toISOString(),
            updated_at: run.updatedAt.toISOString(),
            total_sessions: run.totalSessions,
            processed_sessions: run.processedSessions,
            changed_sessions: changed.get(run.id) ?? 0,
            redaction_count: run.redactionCount,
            error: run.error,
          })),
          cursor: page.cursor,
        });
      },
      {
        describeResult: (result) => ({ count: result.items.length }),
        permission: "admin",
      },
    );
  }
  /** The targets of one run, by default only those it applied a redaction to. */
  runSessions(context: ServiceContext, runId: string, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "redaction.rescan.sessions",
        resourceType: "redaction_run",
        resourceIds: [runId],
      },
      async (caller) => {
        sessionIdSchema.parse(runId);
        const request = redactionRunSessionsInputSchema.parse(input);
        const run = await this.dependencies.prisma.redactionRun.findUnique({
          where: {
            organizationId_id: {
              organizationId: caller.organizationId,
              id: runId,
            },
          },
          select: { id: true },
        });
        if (!run)
          throw new ServiceError(404, "NOT_FOUND", "The rescan was not found.");
        const { cursor, ...query } = request;
        const sort = query.sort ?? "redaction_count";
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "redaction.rescan.sessions",
          runId,
          query: { ...query, sort },
        });
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          cursor,
          request.limit,
          (skip, take) =>
            this.dependencies.prisma.redactionRunSession.findMany({
              where: {
                organizationId: caller.organizationId,
                runId,
                ...(request.filters.changed
                  ? { redactionCount: { gt: 0 } }
                  : {}),
              },
              orderBy: [
                { [runSessionSortFields[sort]]: query.order },
                { sessionId: "asc" },
              ],
              skip,
              take,
            }),
        );
        return redactionRunSessionsOutputSchema.parse({
          items: page.items.map((row) => ({
            run_id: row.runId,
            session_id: row.sessionId,
            processed_at: row.processedAt?.toISOString() ?? null,
            redaction_count: row.redactionCount,
          })),
          cursor: page.cursor,
        });
      },
      {
        describeResult: (result) => ({ count: result.items.length }),
        permission: "admin",
      },
    );
  }
  /** Where redactions landed, newest first: session, message position, policy, source and time. */
  hits(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "redaction.hits", resourceType: "redaction_hit" },
      async (caller) => {
        const request = redactionHitsInputSchema.parse(input);
        const { cursor, ...query } = request;
        const sort = query.sort ?? "redacted_at";
        const filters = request.filters;
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "redaction.hits",
          query: { ...query, sort },
        });
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          cursor,
          request.limit,
          (skip, take) =>
            this.dependencies.prisma.redactionHit.findMany({
              where: {
                organizationId: caller.organizationId,
                ...(filters.run_id ? { runId: filters.run_id } : {}),
                ...(filters.session_id
                  ? { sessionId: filters.session_id }
                  : {}),
                ...(filters.policy_id ? { policyId: filters.policy_id } : {}),
                ...(filters.source === "capture"
                  ? { runId: null }
                  : filters.source === "rescan"
                    ? { runId: { not: null } }
                    : {}),
                // The name lives on the policy the hit's counter points at; a semi-join in
                // the same statement keeps this one scan of the ledger.
                ...(filters.q
                  ? {
                      event: {
                        policy: {
                          name: { contains: filters.q, mode: "insensitive" },
                        },
                      },
                    }
                  : {}),
              },
              orderBy: [{ [hitSortFields[sort]]: query.order }, { id: "desc" }],
              skip,
              take,
            }),
        );
        // Second relation, one scan: the names of the policies on the page.
        const names = new Map(
          (
            await this.dependencies.prisma.redactionPolicy.findMany({
              where: {
                organizationId: caller.organizationId,
                id: { in: [...new Set(page.items.map((hit) => hit.policyId))] },
              },
              select: { id: true, name: true },
            })
          ).map((policy) => [policy.id, policy.name]),
        );
        return redactionHitsOutputSchema.parse({
          items: page.items.map((hit) => ({
            id: hit.id,
            session_id: hit.sessionId,
            ingest_batch_id: hit.ingestBatchId,
            run_id: hit.runId,
            source: hit.runId === null ? "capture" : "rescan",
            policy_id: hit.policyId,
            policy_name: names.get(hit.policyId) ?? null,
            seq: hit.seq,
            count: hit.count,
            masked_preview: hit.maskedPreview,
            fingerprint: hit.fingerprint,
            match_length: hit.matchLength,
            redacted_at: hit.redactedAt.toISOString(),
          })),
          cursor: page.cursor,
        });
      },
      {
        describeResult: (result) => ({ count: result.items.length }),
        permission: "admin",
      },
    );
  }

  test(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "redaction.test", resourceType: "redaction_policy" },
      async () => {
        const caller = requirePermission(context, "admin");
        const request = redactionTestInputSchema.parse(input);
        const redactor = await this.dependencies.cache.get(
          caller.organizationId,
        );
        const result = await redactor.text(request.text);
        return redactionTestOutputSchema.parse({
          text: result.value,
          matches: result.counts.map((count) => ({
            policy_id: count.policyId,
            count: count.count,
          })),
        });
      },
      {
        describeResult: (result) => ({ matches: result.matches }),
        permission: "admin",
      },
    );
  }
}

// Callers hold the organization lock. A policy deleted on another API process may
// remain in this process's 30-second cache; its removed counters must stay removed.
export async function persistRedactionCounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  ingestBatchId: string,
  sessionId: string,
  counts: readonly RedactionCount[],
): Promise<void> {
  if (!counts.length) return;
  const policies = await tx.redactionPolicy.findMany({
    where: {
      organizationId,
      id: { in: counts.map((count) => count.policyId) },
    },
    select: { id: true },
  });
  const present = new Set(policies.map((policy) => policy.id));
  const totals = new Map<string, number>();
  for (const count of counts)
    if (present.has(count.policyId))
      totals.set(
        count.policyId,
        (totals.get(count.policyId) ?? 0) + count.count,
      );
  for (const [policyId, count] of totals)
    await tx.redactionEvent.upsert({
      where: {
        ingestBatchId_sessionId_policyId: {
          ingestBatchId,
          sessionId,
          policyId,
        },
      },
      create: { organizationId, ingestBatchId, sessionId, policyId, count },
      update: { count: { increment: count } },
    });
}

/**
 * The per-message ledger under the counters (§5.3): one `redaction_hit` row per receipt,
 * policy and message position, `runId` naming the rescan that applied it. Rows hang off
 * their counter, so only hits whose counter exists are written: a policy deleted since the
 * accept has no counter left and its hits are dropped with it, as the counters were.
 */
export async function persistRedactionHits(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
  runId: string | null,
  hits: readonly RedactionHitInput[],
): Promise<void> {
  if (!hits.length) return;
  const counters = await tx.redactionEvent.findMany({
    where: {
      organizationId,
      sessionId,
      ingestBatchId: { in: [...new Set(hits.map((hit) => hit.ingestBatchId))] },
      policyId: { in: [...new Set(hits.map((hit) => hit.policyId))] },
    },
    select: { ingestBatchId: true, policyId: true },
  });
  const present = new Set(
    counters.map((row) => `${row.ingestBatchId}\0${row.policyId}`),
  );
  const rows = hits
    .filter((hit) => present.has(`${hit.ingestBatchId}\0${hit.policyId}`))
    .map((hit) => ({
      id: uuidv7(),
      organizationId,
      sessionId,
      ingestBatchId: hit.ingestBatchId,
      policyId: hit.policyId,
      runId,
      seq: hit.seq,
      count: hit.count,
      redactedAt: hit.redactedAt,
      // Identifying metadata derived at redaction, never the secret (§5.3, ADR 0076).
      maskedPreview: hit.preview,
      fingerprint: hit.fingerprint,
      matchLength: hit.length,
    }));
  if (rows.length) await tx.redactionHit.createMany({ data: rows });
}
