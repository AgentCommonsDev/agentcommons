import { z } from "zod";
import {
  callerContextSchema,
  keyPermissionsSchema,
  type CallerContext,
} from "@agentcommons/core/schemas";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import { emailDomainAllowed, type NativeAuth } from "./config.js";
import { ServiceError } from "../services/context.js";
import { keyInstallation } from "./installation.js";

export const userIdentitySchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
});
export interface AuthIdentity {
  user: z.infer<typeof userIdentitySchema>;
  caller: CallerContext | null;
  sessionId: string | null;
}
const cookieIdentitySchema = z.looseObject({
  user: userIdentitySchema
    .extend({ banned: z.boolean().nullable().optional() })
    .loose(),
  session: z.looseObject({
    id: z.string(),
    activeOrganizationId: z.string().nullable().optional(),
  }),
});

export async function identityFromHeaders(
  db: PrismaClient | Prisma.TransactionClient,
  auth: NativeAuth,
  headers: Headers,
  allowedDomains: readonly string[] = [],
  requireVerifiedEmail = false,
): Promise<AuthIdentity> {
  const authorization = headers.get("authorization");
  const alternate = headers.get("x-api-key");
  if (authorization !== null || alternate !== null) {
    const bearer = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (
      (authorization && !bearer) ||
      (bearer && alternate && bearer !== alternate) ||
      headers.has("x-organization-id")
    ) {
      throw new ServiceError(
        401,
        "INVALID_API_KEY",
        "Provide one valid organization API key.",
      );
    }
    const secret = bearer ?? alternate;
    if (!secret)
      throw new ServiceError(
        401,
        "INVALID_API_KEY",
        "Provide a valid organization API key.",
      );
    const verified = await auth.api.verifyApiKey({ body: { key: secret } });
    if (!verified.valid || !verified.key)
      throw new ServiceError(
        401,
        "INVALID_API_KEY",
        "The API key is invalid, expired, or revoked.",
      );
    const key = verified.key;
    const owner = await db.apiKeyOwner.findUnique({ where: { keyId: key.id } });
    if (!owner || owner.organizationId !== key.referenceId)
      throw new ServiceError(
        401,
        "INVALID_API_KEY",
        "The API key is not bound to an organization.",
      );
    const user = await db.user.findUnique({ where: { id: owner.userId } });
    const member = await db.member.findFirst({
      where: {
        organizationId: owner.organizationId,
        userId: owner.userId,
        removedAt: null,
      },
    });
    if (!user || user.banned || !member || member.suspended)
      throw new ServiceError(
        403,
        "MEMBERSHIP_REQUIRED",
        "This key's issuing user no longer has active membership.",
      );
    if (!emailDomainAllowed(user.email, allowedDomains))
      throw new ServiceError(
        403,
        "EMAIL_DOMAIN_NOT_ALLOWED",
        "This email domain is not allowed.",
      );
    if (requireVerifiedEmail && !user.emailVerified)
      throw new ServiceError(
        403,
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email before accessing an organization.",
      );
    const permissions = keyPermissionsSchema.parse(key.permissions ?? {});
    const installation = await keyInstallation(
      db,
      owner.organizationId,
      key.id,
    );
    return {
      user: userIdentitySchema.parse(user),
      sessionId: null,
      caller: callerContextSchema.parse({
        organizationId: owner.organizationId,
        userId: user.id,
        role: member.role,
        apiKeyId: key.id,
        installationId: installation?.id ?? null,
        toolsEnabled: installation?.toolsEnabled ?? true,
        authMethod: "key",
        permissions,
      }),
    };
  }
  const native = await auth.api.getSession({ headers });
  if (!native)
    throw new ServiceError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  const identity = cookieIdentitySchema.parse(native);
  if (!emailDomainAllowed(identity.user.email, allowedDomains))
    throw new ServiceError(
      403,
      "EMAIL_DOMAIN_NOT_ALLOWED",
      "This email domain is not allowed.",
    );
  if (identity.user.banned)
    throw new ServiceError(
      403,
      "ACCOUNT_DISABLED",
      "This account is disabled.",
    );
  const currentUser = requireVerifiedEmail
    ? await db.user.findUniqueOrThrow({ where: { id: identity.user.id } })
    : null;
  const members =
    requireVerifiedEmail && !currentUser?.emailVerified
      ? []
      : await db.member.findMany({
          where: {
            userId: identity.user.id,
            suspended: false,
            removedAt: null,
          },
          orderBy: { createdAt: "asc" },
        });
  const selected = identity.session.activeOrganizationId;
  const member = selected
    ? members.find((value) => value.organizationId === selected)
    : members.length === 1
      ? members[0]
      : undefined;
  return {
    user: userIdentitySchema.parse(identity.user),
    sessionId: identity.session.id,
    caller: member
      ? callerContextSchema.parse({
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
          apiKeyId: null,
          authMethod: "cookie",
          permissions: {
            sessions: ["read", "ingest"],
            ...(["owner", "admin"].includes(member.role)
              ? { admin: ["*"] }
              : {}),
          },
        })
      : null,
  };
}
