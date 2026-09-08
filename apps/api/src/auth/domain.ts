import { createHash } from "node:crypto";
import { z } from "zod";
import {
  domainInputSchema,
  domainOutputSchema,
  domainsInputSchema,
  domainsOutputSchema,
} from "@agentcommons/core/schemas";
import { CursorCodec } from "../services/cursor.js";
import { wireValue } from "../services/read-budget.js";
import type { PrismaClient } from "@agentcommons/db";
import {
  createAuth,
  domainEnrollmentEnabled,
  type AuthConfiguration,
} from "./config.js";
import { identityFromHeaders } from "./identity.js";
import { membershipTransaction } from "./transaction.js";
import { AuditService, auditedOperation } from "../services/audit.js";
import { createPolicyCache } from "../services/policy-cache.js";
import { lockOrganization, requireCookie } from "../services/auth.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "../services/context.js";

export const domainEnrollmentInputSchema = z.object({
  operation: z.enum(["register", "verify"]),
  organization: z.string().min(1),
  domain: domainInputSchema.shape.domain,
});

/** CLI and HTTP share native owner authentication and provider operations. */
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
      if (
        !domainEnrollmentEnabled(config) ||
        (config.allowedEmailDomains.length > 0 &&
          !config.allowedEmailDomains.includes(parsed.domain))
      )
        throw new ServiceError(
          409,
          "DOMAIN_ENROLLMENT_DISABLED",
          "Configure Google login and permit this domain in the instance signup settings.",
        );
      return membershipTransaction(prisma, async (tx) => {
        const native = createAuth(tx, config);
        const identity = await identityFromHeaders(
          tx,
          native,
          context.headers,
          config.allowedEmailDomains,
          config.instanceMode === "saas",
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
        const scoped: ServiceContext = {
          ...context,
          caller: {
            organizationId: organization.id,
            userId: identity.user.id,
            role: member.role === "owner" ? "owner" : "admin",
            apiKeyId: null,
            authMethod: "cookie",
            permissions: { sessions: ["read", "ingest"], admin: ["*"] },
            installationId: null,
            toolsEnabled: true,
          },
        };
        operationContext.caller = scoped.caller;
        const caller = requireCookie(scoped);
        requirePermission(scoped, "admin");
        await lockOrganization(tx, caller);
        const providerId = `domain-${createHash("sha256").update(`${organization.id}\0${parsed.domain}`).digest("hex").slice(0, 24)}`;
        let provider = await tx.ssoProvider.findUnique({
          where: { providerId },
        });
        let token: string | null = null;
        let updated = false;
        if (parsed.operation === "register") {
          if (!provider) {
            const registered = await native.api.registerSSOProvider({
              headers: context.headers,
              body: {
                providerId,
                issuer: "https://accounts.google.com",
                domain: parsed.domain,
                organizationId: organization.id,
              },
            });
            token = z.string().parse(registered.domainVerificationToken);
            provider = await tx.ssoProvider.findUniqueOrThrow({
              where: { providerId },
            });
            updated = true;
          } else if (!provider.domainVerified) {
            token = (
              await native.api.requestDomainVerification({
                headers: context.headers,
                body: { providerId },
              })
            ).domainVerificationToken;
          }
        } else {
          if (!provider)
            throw new ServiceError(
              404,
              "DOMAIN_NOT_REGISTERED",
              "Register this domain before verifying its DNS record.",
            );
          if (!provider.domainVerified) {
            await native.api.verifyDomain({
              headers: context.headers,
              body: { providerId },
            });
            provider = await tx.ssoProvider.findUniqueOrThrow({
              where: { providerId },
            });
            updated = true;
          }
        }
        const result = domainOutputSchema.parse({
          organization_id: organization.id,
          domain: parsed.domain,
          provider_id: providerId,
          verified: provider.domainVerified === true,
          dns_record: token
            ? {
                type: "TXT" as const,
                name: `_better-auth-token-${providerId}.${parsed.domain}`,
                value: token,
              }
            : null,
        });
        const written = await audit.write(
          scoped,
          {
            action: `operator.domain.${parsed.operation}`,
            resourceType: "organization",
            resourceIds: [organization.id],
            detail: {
              domain: parsed.domain,
              provider_id: providerId,
              verified: result.verified,
              updated,
            },
          },
          tx,
        );
        return { result, audit: written };
      });
    },
  );
}

export async function listDomains(
  prisma: PrismaClient,
  config: AuthConfiguration,
  audit: AuditService,
  context: ServiceContext,
  input: z.input<typeof domainsInputSchema>,
) {
  return auditedOperation(
    audit,
    context,
    { action: "domains.list" },
    async () => {
      const caller = requirePermission(context, "admin");
      const parsed = domainsInputSchema.parse(input);
      const { cursor, ...query } = parsed;
      const codec = new CursorCodec(config.secret);
      const binding = wireValue({
        organizationId: caller.organizationId,
        operation: "domains.list",
        input: query,
      });
      const offset = cursor
        ? codec.decode(cursor, binding, z.number().int().nonnegative())
        : 0;
      return membershipTransaction(prisma, async (tx) => {
        await lockOrganization(tx, caller);
        const rows = await tx.ssoProvider.findMany({
          where: {
            organizationId: caller.organizationId,
            issuer: "https://accounts.google.com",
            ...(parsed.domain
              ? {
                  domain: {
                    contains: parsed.domain.replace(/[\\%_]/g, "\\$&"),
                  },
                }
              : {}),
            ...(parsed.verified
              ? { domainVerified: parsed.verified === "true" }
              : {}),
          },
          orderBy: [
            parsed.sort === "verified"
              ? { domainVerified: parsed.order }
              : { domain: parsed.order },
            { providerId: "asc" },
          ],
          skip: offset,
          take: parsed.limit + 1,
        });
        const result = domainsOutputSchema.parse({
          enabled: domainEnrollmentEnabled(config),
          items: rows.slice(0, parsed.limit).map((row) => ({
            organization_id: caller.organizationId,
            domain: row.domain,
            provider_id: row.providerId,
            verified: row.domainVerified === true,
            dns_record: null,
          })),
          cursor:
            rows.length > parsed.limit
              ? codec.encode(binding, offset + parsed.limit)
              : null,
        });
        return {
          result,
          audit: await audit.write(
            context,
            {
              action: "domains.list",
              resourceType: "organization",
              resourceIds: [caller.organizationId],
              detail: { ...query, row_count: result.items.length },
            },
            tx,
          ),
        };
      });
    },
  );
}

export async function manageDomain(
  prisma: PrismaClient,
  config: AuthConfiguration,
  context: ServiceContext,
  operation: "register" | "verify",
  domain: string,
) {
  const audit = new AuditService(prisma, createPolicyCache(prisma));
  return auditedOperation(
    audit,
    context,
    { action: `operator.domain.${operation}` },
    async () => {
      const caller = requirePermission(context, "admin");
      requireCookie(context);
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: caller.organizationId },
      });
      return enrollDomain(prisma, config, context, {
        operation,
        organization: organization.slug,
        domain,
      });
    },
  );
}
