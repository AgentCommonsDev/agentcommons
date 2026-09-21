import type { Prisma, PrismaClient } from "@agentcommons/db";
import { emailDomain } from "./config.js";

/**
 * Whether the organization that owns an email's domain requires SSO sign-in (ADR 0093).
 *
 * Domains are one-per-organization (ADR 0049): an enrolled, verified Google sign-in domain
 * maps to a single organization, and when that organization set `ssoOnly`, password
 * credentials for the domain are refused. The lookup reads `ssoProvider` (small: one row
 * per enrolled domain) filtered by the values it is keyed on, then `organization_settings`
 * for those organizations, so it stays bounded without a per-row dictionary call.
 *
 * `ssoProvider.domain` is not database-unique and is a Better Auth model this project must
 * not hand-edit, so the query is written defensively: should a domain ever resolve to more
 * than one organization, any `ssoOnly` owner blocks. The caller decides how a lookup error
 * is handled; this function never swallows one.
 */
export async function domainRequiresSso(
  db: PrismaClient | Prisma.TransactionClient,
  email: string,
): Promise<boolean> {
  const domain = emailDomain(email);
  if (!domain) return false;
  const providers = await db.ssoProvider.findMany({
    where: {
      domain,
      domainVerified: true,
      issuer: "https://accounts.google.com",
      organizationId: { not: null },
    },
    select: { organizationId: true },
    take: 25,
  });
  const organizationIds = [
    ...new Set(
      providers
        .map((provider) => provider.organizationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (organizationIds.length === 0) return false;
  const enforcing = await db.organizationSettings.count({
    where: { organizationId: { in: organizationIds }, ssoOnly: true },
  });
  return enforcing > 0;
}
