import { createHash } from "node:crypto";
import { z } from "zod";
import {
  domainInputSchema,
  domainOutputSchema,
} from "@agentcommons/core/schemas";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import {
  createAuth,
  domainEnrollmentEnabled,
  type AuthConfiguration,
  type NativeAuth,
} from "./config.js";
import { cookieCaller, identityFromHeaders } from "./identity.js";
import { membershipTransaction } from "./transaction.js";
import {
  AuditService,
  auditedOperation,
  type AuditService as Audit,
} from "../services/audit.js";
import { createPolicyCache } from "../services/policy-cache.js";
import { lockOrganization } from "../services/auth.js";
import { ServiceError, type ServiceContext } from "../services/context.js";

export const domainEnrollmentInputSchema = z.object({
  organization: z.string().min(1),
  domain: domainInputSchema.shape.domain,
});

/** Google must be the sole login provider, signup open or invite, and the domain permitted. */
export function requireDomainEnrollment(
  config: AuthConfiguration,
  domain: string,
): void {
  if (
    !domainEnrollmentEnabled(config) ||
    (config.allowedEmailDomains.length > 0 &&
      !config.allowedEmailDomains.includes(domain))
  )
    throw new ServiceError(
      409,
      "DOMAIN_ENROLLMENT_DISABLED",
      "Configure Google login and permit this domain in the instance signup settings.",
    );
}

/**
 * Upsert the organization's Google domain provider and record the approval. Callers
 * hold the organization lock and pass the owner's or administrator's own context, so the
 * audit row carries the approving identity.
 */
export async function registerDomain(
  tx: Prisma.TransactionClient,
  native: NativeAuth,
  audit: Audit,
  context: ServiceContext,
  organizationId: string,
  domain: string,
) {
  const providerId = `domain-${createHash("sha256").update(`${organizationId}\0${domain}`).digest("hex").slice(0, 24)}`;
  let provider = await tx.ssoProvider.findUnique({ where: { providerId } });
  let updated = false;
  if (!provider) {
    await native.api.registerSSOProvider({
      headers: context.headers,
      body: {
        providerId,
        issuer: "https://accounts.google.com",
        domain,
        organizationId,
      },
    });
    updated = true;
  }
  // An owner or admin allowlisting a domain is the approval (ADR 0049); no DNS proof step.
  provider = await tx.ssoProvider.update({
    where: { providerId },
    data: { domainVerified: true },
  });
  const result = domainOutputSchema.parse({
    organization_id: organizationId,
    domain,
    provider_id: providerId,
    verified: provider.domainVerified === true,
  });
  const written = await audit.write(
    context,
    {
      action: "operator.domain.register",
      resourceType: "organization",
      resourceIds: [organizationId],
      detail: {
        domain,
        provider_id: providerId,
        verified: result.verified,
        updated,
      },
    },
    tx,
  );
  return { result, audit: written };
}

/** The operator CLI path: a cookie names the user, the slug an organization they administer. */
export async function enrollDomain(
  prisma: PrismaClient,
  config: AuthConfiguration,
  context: ServiceContext,
  input: z.input<typeof domainEnrollmentInputSchema>,
) {
  const audit = new AuditService(prisma, createPolicyCache(prisma));
  const operationContext = { ...context };
  return auditedOperation(
    audit,
    operationContext,
    { action: "operator.domain" },
    async () => {
      const parsed = domainEnrollmentInputSchema.parse(input);
      requireDomainEnrollment(config, parsed.domain);
      return membershipTransaction(prisma, async (tx) => {
        const native = createAuth(tx, config);
        const identity = await identityFromHeaders(
          tx,
          native,
          context.headers,
          config,
        );
        if (!identity.sessionId || identity.caller?.authMethod === "key")
          throw new ServiceError(
            403,
            "COOKIE_REQUIRED",
            "Sign in as an organization owner or administrator.",
          );
        const organization = await tx.organization.findUnique({
          where: { slug: parsed.organization },
        });
        const member = organization
          ? await tx.member.findFirst({
              where: {
                organizationId: organization.id,
                userId: identity.user.id,
                removedAt: null,
                suspended: false,
              },
            })
          : null;
        if (
          !organization ||
          !member ||
          !["owner", "admin"].includes(member.role)
        )
          throw new ServiceError(
            403,
            "ADMIN_REQUIRED",
            "An active organization owner or administrator must enroll its domain.",
          );
        const caller = cookieCaller(member);
        operationContext.caller = caller;
        await lockOrganization(tx, caller);
        return registerDomain(
          tx,
          native,
          audit,
          { ...context, caller },
          organization.id,
          parsed.domain,
        );
      });
    },
  );
}
