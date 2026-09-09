import { z } from "zod";
import type { WelcomeJobs } from "./mail.js";
import {
  onboardingInputSchema,
  onboardingOutputSchema,
  organizationSlugFromName,
} from "@agentcommons/core/schemas";
import { Prisma, type PrismaClient } from "@agentcommons/db";
import { createAuth, type AuthConfiguration } from "./config.js";
import { identityFromHeaders, type AuthIdentity } from "./identity.js";
import { membershipTransaction } from "./transaction.js";
import { seedPolicies } from "../services/policies.js";
import { auditedOperation, type AuditService } from "../services/audit.js";
import { ServiceError, type ServiceContext } from "../services/context.js";

export function onboard(
  prisma: PrismaClient,
  config: AuthConfiguration,
  audit: AuditService,
  context: ServiceContext,
  identify: () => Promise<AuthIdentity>,
  input: z.input<typeof onboardingInputSchema>,
  welcome?: WelcomeJobs,
  intent: "initial" | "explicit" = "initial",
) {
  const action = intent === "initial" ? "auth.onboard" : "organizations.create";
  return auditedOperation(audit, context, { action }, async () => {
    if (config.instanceMode !== "saas")
      throw new ServiceError(
        404,
        "NOT_FOUND",
        "Organization signup is not available.",
      );
    const parsed = onboardingInputSchema.parse(input);
    const candidate = await identify();
    if (!candidate.sessionId)
      throw new ServiceError(
        403,
        "COOKIE_REQUIRED",
        "Use a signed-in browser session for this operation.",
      );
    return membershipTransaction(
      prisma,
      async (tx) => {
        const native = createAuth(tx, config);
        await tx.$queryRaw`SELECT id FROM "user" WHERE id=${candidate.user.id} FOR UPDATE`;
        // The identity is read again under the user lock so the membership decisions
        // below see the rows this transaction holds.
        const identity = await identityFromHeaders(
          tx,
          native,
          context.headers,
          config,
        );
        const user = await tx.user.findUniqueOrThrow({
          where: { id: identity.user.id },
        });
        if (!user.emailVerified)
          throw new ServiceError(
            403,
            "EMAIL_VERIFICATION_REQUIRED",
            "Verify your email before creating an organization.",
          );
        const memberships = await tx.member.findMany({
          where: { userId: user.id, suspended: false, removedAt: null },
        });
        let organizationId: string | null = null;
        let created = false;
        if (intent === "initial") {
          organizationId = user.onboardingOrganizationId;
          if (
            organizationId &&
            !memberships.some(
              (member) => member.organizationId === organizationId,
            )
          )
            throw new ServiceError(
              409,
              "CONTACT_ADMIN",
              "Contact your organization administrator to restore access.",
            );
          if (!organizationId && memberships.length)
            throw new ServiceError(
              409,
              "ORGANIZATION_AVAILABLE",
              "Select one of your existing organizations.",
            );
        }
        const base = parsed.slug ?? organizationSlugFromName(parsed.name);
        let slug = base;
        if (!organizationId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-slug:${base}`}, 0))`;
          const existing = await tx.organization.findUnique({
            where: { slug: base },
          });
          if (existing && parsed.slug !== undefined) {
            if (
              intent !== "explicit" ||
              !memberships.some(
                (member) =>
                  member.organizationId === existing.id &&
                  member.role === "owner",
              )
            )
              throw new ServiceError(
                409,
                "ORGANIZATION_SLUG_TAKEN",
                "This organization address is already in use.",
              );
            organizationId = existing.id;
          } else if (existing) {
            // Derived slugs never collide with another organization; pick the next free suffix.
            for (let suffix = 2; ; suffix++) {
              slug = `${base}-${String(suffix)}`;
              if (!(await tx.organization.findUnique({ where: { slug } })))
                break;
            }
          }
        }
        if (!organizationId) {
          // Native server-side organization creation follows the verified cookie boundary above.
          const organization = await native.api.createOrganization({
            body: {
              slug,
              name: await audit.redactText(
                { ...context, caller: null },
                parsed.name,
                tx,
              ),
              userId: user.id,
            },
          });
          organizationId = z
            .object({ id: z.string().min(1) })
            .parse(organization).id;
          if (intent === "initial") {
            const adapter = await native.$context;
            await adapter.internalAdapter.updateUser(user.id, {
              onboardingOrganizationId: organizationId,
            });
          }
          await seedPolicies(tx, organizationId, user.id);
          created = true;
        }
        await native.api.setActiveOrganization({
          headers: context.headers,
          body: { organizationId },
        });
        await welcome?.enqueueWelcome(tx, user.id);
        const result = onboardingOutputSchema.parse({
          organization_id: organizationId,
          created,
        });
        return {
          result,
          audit: await audit.write(
            { ...context, caller: null },
            {
              action,
              resourceType: "organization",
              resourceIds: [organizationId],
              actor: {
                userId: user.id,
                apiKeyId: null,
                authMethod: "cookie",
                organizationId,
              },
              detail: { created },
            },
            tx,
          ),
        };
      },
      Prisma.TransactionIsolationLevel.ReadCommitted,
    );
  });
}
