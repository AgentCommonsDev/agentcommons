import type { Prisma, PrismaClient } from "@agentcommons/db";
import {
  callerContextSchema,
  parseKeyPermissions,
} from "@agentcommons/core/schemas";
import { ServiceError, type ServiceContext } from "../services/context.js";
import type { IdentityPolicy } from "./config.js";
import { activeMembership, keyIsActive } from "./identity.js";

/** Revalidate a persisted, server-issued job actor; no native session is fabricated. */
export async function reauthorizeJob(
  prisma: PrismaClient | Prisma.TransactionClient,
  context: ServiceContext,
  config: IdentityPolicy,
): Promise<ServiceContext> {
  const previous = context.caller;
  if (!previous)
    throw new ServiceError(
      403,
      "JOB_ACTOR_REQUIRED",
      "This job has no authenticated actor.",
    );
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: previous.userId } }),
    prisma.member.findFirst({
      where: {
        userId: previous.userId,
        organizationId: previous.organizationId,
        removedAt: null,
      },
    }),
  ]);
  const { member } = activeMembership(
    user,
    membership,
    config,
    () =>
      new ServiceError(
        403,
        "MEMBERSHIP_REQUIRED",
        "The job actor no longer has active organization membership.",
      ),
  );
  let permissions = previous.permissions;
  if (previous.apiKeyId) {
    const [key, owner] = await Promise.all([
      prisma.apikey.findUnique({ where: { id: previous.apiKeyId } }),
      prisma.apiKeyOwner.findUnique({ where: { keyId: previous.apiKeyId } }),
    ]);
    if (
      !keyIsActive(key, previous.organizationId) ||
      owner?.organizationId !== previous.organizationId ||
      owner.userId !== previous.userId
    )
      throw new ServiceError(
        403,
        "KEY_REVOKED",
        "The job actor's API key is no longer active.",
      );
    permissions = parseKeyPermissions(key?.permissions);
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
