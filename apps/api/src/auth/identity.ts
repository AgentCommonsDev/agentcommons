import { z } from "zod";
import {
  callerContextSchema,
  keyPermissionsSchema,
  type CallerContext,
} from "@agentcommons/core/schemas";
import type {
  Apikey,
  Member,
  Prisma,
  PrismaClient,
  User,
} from "@agentcommons/db";
import { defaultKeyHasher } from "@agentcommons/db/auth-plugins";
import {
  emailDomainAllowed,
  type IdentityPolicy,
  type NativeAuth,
} from "./config.js";
import { ServiceError } from "../services/context.js";
import { authUnavailableError } from "./failure.js";
import { keyInstallation } from "./installation.js";

export const userIdentitySchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  emailVerified: z.boolean(),
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

/** SaaS identities must verify their email before they can act for an organization. */
function requiresVerifiedEmail(
  config: Pick<IdentityPolicy, "instanceMode">,
): boolean {
  return config.instanceMode === "saas";
}

/** Whether a stored key row can still act for `organizationId` at `now`. */
export function keyIsActive(
  key: Pick<Apikey, "enabled" | "referenceId" | "expiresAt"> | null,
  organizationId: string,
  now = new Date(),
): boolean {
  return (
    key !== null &&
    key.enabled === true &&
    key.referenceId === organizationId &&
    !(key.expiresAt && key.expiresAt <= now)
  );
}

/** Which gate stops a user/member pair from acting for an organization, if any. */
type MembershipGate = "membership" | "domain" | "verification";
/**
 * Narrow a user/member pair to an active membership under `config`, or throw the
 * caller's error for the gate that is closed: missing, banned or suspended
 * (`membership`), an email domain outside the allowlist (`domain`), or an unverified
 * SaaS email (`verification`).
 */
export function activeMembership<
  U extends Pick<User, "banned" | "email" | "emailVerified">,
  M extends Pick<Member, "suspended">,
>(
  user: U | null,
  member: M | null,
  config: IdentityPolicy,
  failure: (gate: MembershipGate) => ServiceError,
): { user: U; member: M } {
  if (!user || user.banned || !member || member.suspended)
    throw failure("membership");
  if (!emailDomainAllowed(user.email, config.allowedEmailDomains))
    throw failure("domain");
  if (requiresVerifiedEmail(config) && !user.emailVerified)
    throw failure("verification");
  return { user, member };
}

const invalidKey = (): ServiceError =>
  new ServiceError(
    401,
    "INVALID_API_KEY",
    "The API key is invalid, expired, or revoked.",
  );
/** Verdicts Better Auth reaches only after it found the key row; the lookup completed. */
const completedKeyVerdicts = new Set([
  "KEY_NOT_FOUND",
  "KEY_DISABLED",
  "KEY_EXPIRED",
]);
type VerifiedKey = NonNullable<
  Awaited<ReturnType<NativeAuth["api"]["verifyApiKey"]>>["key"]
>;
/**
 * The key row for a secret, or the caller's 401 when the lookup completed and found
 * none. Better Auth reports an exception inside its own lookup (a statement timeout, an
 * exhausted pool) as `INVALID_API_KEY`, the same code as a missing key, so that negative
 * is confirmed against the stored digest: a missing row is a rejection, an existing row
 * or a failed lookup is `AUTH_UNAVAILABLE` (§9.2).
 */
async function verifyKey(
  db: PrismaClient | Prisma.TransactionClient,
  auth: NativeAuth,
  secret: string,
): Promise<VerifiedKey> {
  const verified = await auth.api.verifyApiKey({ body: { key: secret } });
  if (verified.valid && verified.key) return verified.key;
  const code = verified.error?.code ?? null;
  if (code !== null && completedKeyVerdicts.has(code)) throw invalidKey();
  if (code === "INVALID_API_KEY") {
    const existing = await db.apikey.findFirst({
      where: { key: await defaultKeyHasher(secret) },
      select: { id: true },
    });
    if (existing === null) throw invalidKey();
  }
  throw authUnavailableError(
    new Error(
      `API key verification did not complete (${code ?? "no verdict"}).`,
    ),
  );
}

/** Browser sessions act with their membership role; owners and admins also hold admin authority. */
export function cookieCaller(
  member: Pick<Member, "organizationId" | "userId" | "role">,
): CallerContext {
  return callerContextSchema.parse({
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role,
    apiKeyId: null,
    authMethod: "cookie",
    permissions: {
      sessions: ["read", "ingest"],
      ...(["owner", "admin"].includes(member.role) ? { admin: ["*"] } : {}),
    },
  });
}

export async function identityFromHeaders(
  db: PrismaClient | Prisma.TransactionClient,
  auth: NativeAuth,
  headers: Headers,
  config: IdentityPolicy,
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
    // A client that sent the installer's `${AGENTCOMMONS_API_KEY}` placeholder verbatim
    // (an IDE extension host without the shell export) gets told so instead of a lookup.
    if (secret.includes("${"))
      throw new ServiceError(
        401,
        "INVALID_API_KEY",
        "The API key placeholder was sent unexpanded. Re-run the AgentCommons installer so the key is written into the client configuration.",
      );
    const key = await verifyKey(db, auth, secret);
    const owner = await db.apiKeyOwner.findUnique({ where: { keyId: key.id } });
    if (!owner || owner.organizationId !== key.referenceId)
      throw new ServiceError(
        401,
        "INVALID_API_KEY",
        "The API key is not bound to an organization.",
      );
    const [issuer, membership, installation] = await Promise.all([
      db.user.findUnique({ where: { id: owner.userId } }),
      db.member.findFirst({
        where: {
          organizationId: owner.organizationId,
          userId: owner.userId,
          removedAt: null,
        },
      }),
      keyInstallation(db, owner.organizationId, key.id),
    ]);
    const { user, member } = activeMembership(
      issuer,
      membership,
      config,
      (gate) =>
        gate === "domain"
          ? new ServiceError(
              403,
              "EMAIL_DOMAIN_NOT_ALLOWED",
              "This email domain is not allowed.",
            )
          : gate === "verification"
            ? new ServiceError(
                403,
                "EMAIL_VERIFICATION_REQUIRED",
                "Verify your email before accessing an organization.",
              )
            : new ServiceError(
                403,
                "MEMBERSHIP_REQUIRED",
                "This key's issuing user no longer has active membership.",
              ),
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
        permissions: keyPermissionsSchema.parse(key.permissions ?? {}),
      }),
    };
  }
  const native = await auth.api.getSession({ headers });
  if (!native)
    throw new ServiceError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  const identity = cookieIdentitySchema.parse(native);
  if (!emailDomainAllowed(identity.user.email, config.allowedEmailDomains))
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
  const members =
    requiresVerifiedEmail(config) && !identity.user.emailVerified
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
    caller: member ? cookieCaller(member) : null,
  };
}
