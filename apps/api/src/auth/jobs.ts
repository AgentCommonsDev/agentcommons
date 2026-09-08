import type { Prisma, PrismaClient } from "@agentcommons/db";
import {
  callerContextSchema,
  keyPermissionsSchema,
} from "@agentcommons/core/schemas";
import { ServiceError, type ServiceContext } from "../services/context.js";
import { emailDomainAllowed } from "./config.js";

/** Revalidate a persisted, server-issued job actor; no native session is fabricated. */
export async function reauthorizeJob(
  prisma: PrismaClient | Prisma.TransactionClient,
  context: ServiceContext,
  allowedDomains: readonly string[] = [],
  requireVerifiedEmail = false,
): Promise<ServiceContext> {
  const previous = context.caller;
  if (!previous)
    throw new ServiceError(
      403,
      "JOB_ACTOR_REQUIRED",
      "This job has no authenticated actor.",
    );
  const user = await prisma.user.findUnique({ where: { id: previous.userId } });
  const member = await prisma.member.findFirst({
    where: {
      userId: previous.userId,
      organizationId: previous.organizationId,
      removedAt: null,
    },
  });
  if (
    !user ||
    user.banned ||
    (requireVerifiedEmail && !user.emailVerified) ||
    !member ||
    member.suspended ||
    !emailDomainAllowed(user.email, allowedDomains)
  )
    throw new ServiceError(
      403,
      "MEMBERSHIP_REQUIRED",
      "The job actor no longer has active organization membership.",
    );
  let permissions = previous.permissions;
  if (previous.apiKeyId) {
    const key = await prisma.apikey.findUnique({
      where: { id: previous.apiKeyId },
    });
    const owner = await prisma.apiKeyOwner.findUnique({
      where: { keyId: previous.apiKeyId },
    });
    if (
      !key?.enabled ||
      key.referenceId !== previous.organizationId ||
      (key.expiresAt && key.expiresAt <= new Date()) ||
      owner?.organizationId !== previous.organizationId ||
      owner.userId !== previous.userId
    )
      throw new ServiceError(
        403,
        "KEY_REVOKED",
        "The job actor's API key is no longer active.",
      );
    permissions = keyPermissionsSchema.parse(
      key.permissions ? JSON.parse(key.permissions) : {},
    );
  }
  return {
    ...context,
    caller: callerContextSchema.parse({
      ...previous,
      role: member.role,
      permissions,
    }),
  };
}
