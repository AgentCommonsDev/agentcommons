import { type PrismaClient } from "@agentcommons/db";
import {
  organizationSsoInputSchema,
  organizationSsoOutputSchema,
} from "@agentcommons/core/schemas";
import type { AuditService } from "./audit.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { type ServiceContext } from "./context.js";

/**
 * Reads and writes the organization's SSO-only policy (ADR 0093). Both operations require
 * effective admin authority. The state lives on OrganizationSettings alongside embeddings,
 * but on its own version counter (`ssoRevision`): `revision` is an embeddings epoch, so an
 * SSO change must not move it. An SSO change has no trace-read effect, so unlike embeddings
 * it never holds the trace publication fence.
 */
export class OrganizationSsoService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
    },
  ) {}

  get(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "organization.sso.read", resourceType: "organization" },
      async (caller) => {
        const settings =
          await this.dependencies.prisma.organizationSettings.findUnique({
            where: { organizationId: caller.organizationId },
            select: { ssoOnly: true, ssoRevision: true },
          });
        return organizationSsoOutputSchema.parse({
          sso_only: settings?.ssoOnly ?? false,
          revision: settings?.ssoRevision ?? 0,
        });
      },
      {
        permission: "admin",
        describeResources: () => [context.caller?.organizationId ?? ""],
      },
    );
  }

  set(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      {
        action: "organization.sso.update",
        resourceType: "organization",
        detail: input,
      },
      async (tx, caller) => {
        const request = organizationSsoInputSchema.parse(input);
        await lockOrganization(tx, caller);
        const previous = await tx.organizationSettings.findUnique({
          where: { organizationId: caller.organizationId },
          select: { ssoOnly: true, ssoRevision: true },
        });
        const changed = (previous?.ssoOnly ?? false) !== request.sso_only;
        const row = changed
          ? await tx.organizationSettings.upsert({
              where: { organizationId: caller.organizationId },
              create: {
                organizationId: caller.organizationId,
                ssoOnly: request.sso_only,
                ssoRevision: 1,
              },
              update: {
                ssoOnly: request.sso_only,
                ssoRevision: { increment: 1 },
              },
              select: { ssoOnly: true, ssoRevision: true },
            })
          : previous;
        return {
          result: organizationSsoOutputSchema.parse({
            sso_only: row?.ssoOnly ?? request.sso_only,
            revision: row?.ssoRevision ?? 0,
          }),
          resourceIds: [caller.organizationId],
          detail: {
            sso_only: request.sso_only,
            previous_sso_only: previous?.ssoOnly ?? false,
          },
        };
      },
    );
  }
}
