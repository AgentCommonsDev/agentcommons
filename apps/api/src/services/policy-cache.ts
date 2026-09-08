import type { Prisma, RedactionPolicy as PolicyRow } from "@agentcommons/db";
import {
  builtinPolicies,
  PolicyCache,
  policyDefinitionSchema,
  type RedactionPolicy,
} from "@agentcommons/core/redaction";

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

export function createPolicyCache(
  prisma: Prisma.TransactionClient,
): PolicyCache {
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
