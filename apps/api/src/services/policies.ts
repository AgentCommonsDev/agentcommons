import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import {
  Prisma,
  type PrismaClient,
  type RedactionPolicy as PolicyRow,
} from "@agentcommons/db";
import {
  builtinPolicies,
  PolicyCache,
  policyDefinitionSchema,
  type PolicyDefinition,
  type RedactionPolicy,
  type RedactionCount,
} from "@agentcommons/core/redaction";
import {
  redactionPoliciesInputSchema,
  redactionPoliciesOutputSchema,
  redactionPolicySchema,
  redactionTestInputSchema,
  redactionTestOutputSchema,
  reasonSchema,
} from "@agentcommons/core";
import type { AuditService } from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { wireValue } from "./read-budget.js";

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

function definition(row: PolicyRow): RedactionPolicy {
  const common = {
    name: row.name,
    enabled: row.enabled,
    replacement: row.replacement,
  };
  const policy = policyDefinitionSchema.parse(
    row.kind === "REGEX"
      ? { ...common, kind: row.kind, pattern: row.pattern, flags: row.flags }
      : {
          ...common,
          kind: row.kind,
          ruleId: row.ruleId,
          options: row.options ?? {},
        },
  );
  return { ...policy, id: row.id, builtin: row.builtin };
}

export function createPolicyCache(prisma: PrismaClient): PolicyCache {
  return new PolicyCache(async (organizationId) => {
    const rows = await prisma.redactionPolicy.findMany({
      where: { organizationId },
    });
    if (
      builtinPolicies.some(
        (builtin) =>
          !rows.some((row) => row.builtin && row.name === builtin.name),
      )
    )
      throw new Error(
        "Organization redaction policies have not been initialized.",
      );
    return rows.map(definition);
  });
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
        const offset = cursor
          ? this.dependencies.cursors.decode(
              cursor,
              binding,
              z.number().int().nonnegative(),
            )
          : 0;
        const filters = request.filters;
        const items = await this.dependencies.prisma.redactionPolicy.findMany({
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
          skip: offset,
          take: request.limit + 1,
        });
        return redactionPoliciesOutputSchema.parse({
          items: items.slice(0, request.limit).map(output),
          cursor:
            items.length > request.limit
              ? this.dependencies.cursors.encode(
                  binding,
                  offset + request.limit,
                )
              : null,
        });
      },
      undefined,
      "admin",
    );
  }

  async save(context: ServiceContext, id: string | null, input: unknown) {
    const value = await mutationOperation(
      this.dependencies,
      context,
      "admin",
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
        const redactor = await this.dependencies.cache.get(
          caller.organizationId,
        );
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
    if (context.caller)
      this.dependencies.cache.invalidate(context.caller.organizationId);
    return value;
  }

  async remove(context: ServiceContext, id: string, input: unknown) {
    const value = await mutationOperation(
      this.dependencies,
      context,
      "admin",
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
        const { reason } = z
          .strictObject({ reason: reasonSchema })
          .parse(input);
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
    if (context.caller)
      this.dependencies.cache.invalidate(context.caller.organizationId);
    return value;
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
      (result) => ({ matches: result.matches }),
      "admin",
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
