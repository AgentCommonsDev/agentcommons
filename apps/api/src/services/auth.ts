import { auditedOperation } from "./audit.js";
import { z } from "zod";
import {
  authConfigOutputSchema,
  reasonInputSchema,
} from "@agentcommons/core/schemas";
import {
  keyPermissionsSchema,
  keySchema,
  meOutputSchema,
  organizationRoleSchema,
  organizationsOutputSchema,
  organizationSwitchOutputSchema,
  keysOutputSchema,
  keyCreateOutputSchema,
  type CallerContext,
} from "@agentcommons/core/schemas";
import { Prisma, type PrismaClient } from "@agentcommons/db";
import {
  createAuth,
  type AuthConfiguration,
  type NativeAuth,
} from "../auth/config.js";
import { identityFromHeaders, type AuthIdentity } from "../auth/identity.js";
import type { AuditService } from "./audit.js";
import { CursorCodec } from "./cursor.js";
import {
  requireCaller,
  requirePermission,
  ServiceError,
  type ServiceContext,
  type ServiceResult,
} from "./context.js";
import {
  keysInputSchema,
  keyCreateInputSchema,
} from "@agentcommons/core/schemas";

class AuthResponseFailure extends Error {
  constructor(readonly response: Response) {
    super("Authentication request failed");
  }
}
const allowedNativeRoutes = [
  ["POST", /^\/auth\/sign-in\/(email|social)$/],
  ["POST", /^\/auth\/(sign-out|reset-password)$/],
  ["GET", /^\/auth\/(get-session|error)$/],
  ["GET", /^\/auth\/reset-password\/[^/]+$/],
  ["GET", /^\/auth\/callback\/[^/]+$/],
  ["POST", /^\/auth\/callback\/[^/]+$/],
] as const;

export function requireCookie(context: ServiceContext): CallerContext {
  const caller = requireCaller(context);
  if (caller.authMethod !== "cookie")
    throw new ServiceError(
      403,
      "COOKIE_REQUIRED",
      "Use a signed-in browser session for this operation.",
    );
  return caller;
}

export async function lockOrganization(
  tx: Prisma.TransactionClient,
  caller: CallerContext,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organization WHERE id=${caller.organizationId} FOR NO KEY UPDATE`;
  const member = await tx.member.findFirst({
    where: { organizationId: caller.organizationId, userId: caller.userId },
  });
  if (!member || member.suspended || member.role !== caller.role)
    throw new ServiceError(
      403,
      "MEMBERSHIP_CHANGED",
      "Your membership changed. Refresh and try again.",
    );
  if (caller.apiKeyId) {
    const key = await tx.apikey.findUnique({ where: { id: caller.apiKeyId } });
    if (
      !key?.enabled ||
      key.referenceId !== caller.organizationId ||
      (key.expiresAt && key.expiresAt <= new Date())
    )
      throw new ServiceError(
        403,
        "KEY_REVOKED",
        "This API key is no longer active.",
      );
  }
}

function mapKey(
  key: Prisma.ApikeyGetPayload<object>,
  owner: { userId: string; organizationId: string },
) {
  return keySchema.parse({
    id: key.id,
    organization_id: owner.organizationId,
    user_id: owner.userId,
    name: key.name,
    prefix: key.prefix,
    permissions: keyPermissionsSchema.parse(
      key.permissions ? JSON.parse(key.permissions) : {},
    ),
    enabled: key.enabled ?? true,
    created_at: key.createdAt.toISOString(),
    expires_at: key.expiresAt?.toISOString() ?? null,
    last_used_at: key.lastRequest?.toISOString() ?? null,
  });
}

export class AuthService {
  readonly native: NativeAuth;
  private readonly cursors: CursorCodec;
  constructor(
    readonly prisma: PrismaClient,
    readonly config: AuthConfiguration,
    private readonly audit: AuditService,
    private readonly features: "similar_sessions"[] = [],
  ) {
    this.native = createAuth(prisma, config);
    this.cursors = new CursorCodec(config.secret);
  }

  async configuration(context: ServiceContext) {
    const result = authConfigOutputSchema.parse({
      features: this.features,
      email_password_enabled: this.config.emailPasswordEnabled,
      social_provider:
        Object.keys(this.config.socialProviders ?? {})[0] ?? null,
      oidc_enabled: Boolean(this.config.oauthProviders?.length),
      signup_mode: this.config.signupMode,
    });
    const audit = await this.audit.write(context, {
      action: "auth.configuration",
    });
    return { result, audit };
  }

  async authenticate(
    headers: Headers,
    context: ServiceContext,
  ): Promise<AuthIdentity> {
    try {
      return await identityFromHeaders(
        this.prisma,
        this.native,
        headers,
        this.config.allowedEmailDomains,
      );
    } catch (error) {
      const failure =
        error instanceof ServiceError
          ? error
          : new ServiceError(
              401,
              "INVALID_AUTHENTICATION",
              "Sign in or provide a valid organization API key.",
            );
      await this.audit.write(
        { ...context, caller: null },
        {
          action: "auth.failure",
          statusCode: failure.statusCode,
          detail: { code: failure.code },
        },
      );
      failure.audited = true;
      throw failure;
    }
  }

  async handle(
    request: Request,
    context: ServiceContext,
  ): Promise<ServiceResult<Response>> {
    return auditedOperation(
      this.audit,
      context,
      { action: "auth.request" },
      async () => {
        const path = new URL(request.url).pathname;
        if (
          !allowedNativeRoutes.some(
            ([method, pattern]) =>
              method === request.method && pattern.test(path),
          )
        ) {
          throw new ServiceError(
            404,
            "NOT_FOUND",
            "This authentication endpoint is not available.",
          );
        }
        const action = path.startsWith("/auth/callback/")
          ? "auth.callback"
          : path.startsWith("/auth/reset-password/")
            ? "auth.password_setup"
            : `auth.${path.split("/").at(-1) ?? "request"}`;
        try {
          return await this.prisma.$transaction(
            async (tx) => {
              const native = createAuth(tx, this.config);
              let priorIdentity: AuthIdentity | null = null;
              try {
                priorIdentity = await identityFromHeaders(
                  tx,
                  native,
                  request.headers,
                  this.config.allowedEmailDomains,
                );
              } catch {
                /* Most authentication requests start without an identity. */
              }
              const response = await native.handler(request);
              if (response.status >= 400)
                throw new AuthResponseFailure(response);
              const cookies = response.headers
                .getSetCookie()
                .map((value) => value.split(";")[0])
                .join("; ");
              let identity: AuthIdentity | null = null;
              try {
                identity = await identityFromHeaders(
                  tx,
                  native,
                  cookies ? new Headers({ cookie: cookies }) : request.headers,
                  this.config.allowedEmailDomains,
                );
              } catch {
                /* Anonymous auth actions retain a null actor. */
              }
              identity ??= priorIdentity;
              const scoped = {
                ...context,
                caller: identity?.caller ?? context.caller,
              };
              const audit = await this.audit.write(
                scoped,
                {
                  action,
                  statusCode: response.status,
                  ...(identity
                    ? {
                        actor: {
                          userId: identity.user.id,
                          apiKeyId: identity.caller?.apiKeyId ?? null,
                          authMethod: identity.caller?.authMethod ?? "cookie",
                        },
                      }
                    : {}),
                },
                tx,
              );
              return { result: response, audit };
            },
            {
              timeout: 30_000,
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            },
          );
        } catch (error) {
          if (!(error instanceof AuthResponseFailure)) throw error;
          const audit = await this.audit.write(context, {
            action,
            statusCode: error.response.status,
          });
          return { result: error.response, audit };
        }
      },
    );
  }

  async me(context: ServiceContext) {
    return auditedOperation(
      this.audit,
      context,
      { action: "auth.me" },
      async () => {
        const identity = await identityFromHeaders(
          this.prisma,
          this.native,
          context.headers,
          this.config.allowedEmailDomains,
        );
        const organization = identity.caller
          ? await this.prisma.organization.findUniqueOrThrow({
              where: { id: identity.caller.organizationId },
            })
          : null;
        const key = identity.caller?.apiKeyId
          ? await this.prisma.apikey.findUnique({
              where: { id: identity.caller.apiKeyId },
            })
          : null;
        const result = meOutputSchema.parse({
          user: identity.user,
          caller: identity.caller,
          organization:
            organization && identity.caller
              ? {
                  id: organization.id,
                  name: organization.name,
                  slug: organization.slug,
                  role: identity.caller.role,
                }
              : null,
          key: key ? { id: key.id, name: key.name } : null,
        });
        const audit = await this.audit.write(
          { ...context, caller: identity.caller },
          {
            action: "auth.me",
            actor: {
              userId: identity.user.id,
              apiKeyId: identity.caller?.apiKeyId ?? null,
              authMethod: identity.caller?.authMethod ?? "cookie",
            },
          },
        );
        return { result, audit };
      },
    );
  }

  async organizations(context: ServiceContext) {
    return auditedOperation(
      this.audit,
      context,
      { action: "auth.organizations" },
      async () => {
        const identity = await identityFromHeaders(
          this.prisma,
          this.native,
          context.headers,
          this.config.allowedEmailDomains,
        );
        if (!identity.sessionId || identity.caller?.authMethod === "key")
          throw new ServiceError(
            403,
            "COOKIE_REQUIRED",
            "Use a signed-in browser session to list organizations.",
          );
        const members = await this.prisma.member.findMany({
          where: {
            userId: identity.user.id,
            suspended: false,
          },
          include: { organization: true },
          orderBy: { createdAt: "asc" },
        });
        const result = organizationsOutputSchema.parse({
          organizations: members.map((member) => ({
            id: member.organizationId,
            name: member.organization.name,
            slug: member.organization.slug,
            role: member.role,
          })),
          active_organization_id: identity.caller?.organizationId ?? null,
        });
        const audit = await this.audit.write(
          { ...context, caller: identity.caller },
          {
            action: "auth.organizations",
            actor: {
              userId: identity.user.id,
              apiKeyId: identity.caller?.apiKeyId ?? null,
              authMethod: identity.caller?.authMethod ?? "cookie",
            },
          },
        );
        return { result, audit };
      },
    );
  }

  async switchOrganization(context: ServiceContext, organizationId: string) {
    return auditedOperation(
      this.audit,
      context,
      { action: "auth.organization_switch" },
      async () => {
        const identity = await identityFromHeaders(
          this.prisma,
          this.native,
          context.headers,
          this.config.allowedEmailDomains,
        );
        if (identity.caller?.authMethod === "key" || !identity.sessionId)
          throw new ServiceError(
            403,
            "COOKIE_REQUIRED",
            "Use a signed-in browser session to switch organizations.",
          );
        return this.prisma.$transaction(async (tx) => {
          const member = await tx.member.findFirst({
            where: {
              userId: identity.user.id,
              organizationId,
              suspended: false,
            },
            include: { organization: true },
          });
          if (!member)
            throw new ServiceError(404, "NOT_FOUND", "Organization not found.");
          const caller: CallerContext = {
            organizationId,
            userId: identity.user.id,
            role: organizationRoleSchema.parse(member.role),
            apiKeyId: null,
            authMethod: "cookie",
            permissions: { sessions: ["read", "ingest"] },
          };
          await lockOrganization(tx, caller);
          await createAuth(tx, this.config).api.setActiveOrganization({
            headers: context.headers,
            body: { organizationId },
          });
          const result = organizationSwitchOutputSchema.parse({
            organization: {
              id: organizationId,
              name: member.organization.name,
              slug: member.organization.slug,
              role: member.role,
            },
          });
          const audit = await this.audit.write(
            { ...context, caller },
            {
              action: "auth.organization_switch",
              resourceType: "organization",
              resourceIds: [organizationId],
            },
            tx,
          );
          return { result, audit };
        });
      },
    );
  }

  async listKeys(
    context: ServiceContext,
    input: z.input<typeof keysInputSchema>,
    own = true,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "keys.list" },
      async () => {
        const caller = own
          ? requireCookie(context)
          : requirePermission(context, "admin");
        const parsed = keysInputSchema.parse(input);
        const { cursor, ...query } = parsed;
        const binding = z.json().parse(
          JSON.parse(
            JSON.stringify({
              organizationId: caller.organizationId,
              operation: "keys",
              userId: own ? caller.userId : null,
              input: query,
            }),
          ),
        );
        const offset = cursor
          ? this.cursors.decode(cursor, binding, z.number().int().nonnegative())
          : 0;
        const sort = {
          name: "k.name",
          user_id: "o.user_id",
          created_at: 'k."createdAt"',
          expires_at: 'k."expiresAt"',
          last_used_at: 'k."lastRequest"',
          enabled: "k.enabled",
        } as const;
        const ids = await this.prisma.$queryRaw<
          { id: string; userId: string }[]
        >(Prisma.sql`
      SELECT k.id, o.user_id AS "userId" FROM apikey k JOIN api_key_owner o ON o.key_id=k.id
      WHERE o.organization_id=${caller.organizationId}
      ${own ? Prisma.sql`AND o.user_id=${caller.userId}` : parsed.filters.user_id ? Prisma.sql`AND o.user_id=${parsed.filters.user_id}` : Prisma.empty}
      ${parsed.filters.enabled === undefined ? Prisma.empty : Prisma.sql`AND k.enabled=${parsed.filters.enabled}`}
      ORDER BY ${Prisma.raw(sort[parsed.sort ?? "created_at"])} ${Prisma.raw(parsed.order.toUpperCase())}, k.id ASC
      OFFSET ${offset} LIMIT ${parsed.limit + 1}`);
        const keys = await this.prisma.apikey.findMany({
          where: {
            id: { in: ids.slice(0, parsed.limit).map((row) => row.id) },
          },
        });
        const keyMap = new Map(keys.map((key) => [key.id, key]));
        const items = ids.slice(0, parsed.limit).flatMap((owner) => {
          const key = keyMap.get(owner.id);
          return key
            ? [
                mapKey(key, {
                  organizationId: caller.organizationId,
                  userId: owner.userId,
                }),
              ]
            : [];
        });
        const result = keysOutputSchema.parse({
          items,
          cursor:
            ids.length > parsed.limit
              ? this.cursors.encode(binding, offset + parsed.limit)
              : null,
        });
        const audit = await this.audit.write(context, {
          action: "keys.list",
          resourceType: "key",
          detail: { ...query, row_count: items.length },
        });
        return { result, audit };
      },
    );
  }

  async createKey(
    context: ServiceContext,
    input: z.input<typeof keyCreateInputSchema>,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "keys.create" },
      async () => {
        const caller = requireCookie(context);
        const parsed = keyCreateInputSchema.parse(input);
        if (parsed.permissions.admin?.includes("*") && caller.role === "member")
          throw new ServiceError(
            403,
            "FORBIDDEN",
            "Only organization owners and admins can grant admin key permissions.",
          );
        const name = await this.audit.redactText(context, parsed.name);
        return this.prisma.$transaction(async (tx) => {
          await lockOrganization(tx, caller);
          const native = await createAuth(tx, this.config).api.createApiKey({
            body: {
              name,
              organizationId: caller.organizationId,
              userId: caller.userId,
              permissions: {
                ...(parsed.permissions.sessions
                  ? { sessions: parsed.permissions.sessions }
                  : {}),
                ...(parsed.permissions.admin
                  ? { admin: parsed.permissions.admin }
                  : {}),
              },
              ...(parsed.expires_in ? { expiresIn: parsed.expires_in } : {}),
            },
          });
          const owner = await tx.apiKeyOwner.create({
            data: {
              keyId: native.id,
              organizationId: caller.organizationId,
              userId: caller.userId,
            },
          });
          const stored = await tx.apikey.findUniqueOrThrow({
            where: { id: native.id },
          });
          const result = keyCreateOutputSchema.parse({
            key: native.key,
            metadata: mapKey(stored, owner),
          });
          const audit = await this.audit.write(
            context,
            {
              action: "keys.create",
              resourceType: "key",
              resourceIds: [native.id],
              detail: { name: parsed.name, permissions: parsed.permissions },
            },
            tx,
          );
          return { result, audit };
        });
      },
    );
  }

  async revokeKey(
    context: ServiceContext,
    keyId: string,
    input: z.input<typeof reasonInputSchema>,
    own = true,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "keys.revoke" },
      async () => {
        const parsed = reasonInputSchema.parse(input);
        const caller = own
          ? requireCookie(context)
          : requirePermission(context, "admin");
        return this.prisma.$transaction(async (tx) => {
          await lockOrganization(tx, caller);
          const owner = await tx.apiKeyOwner.findFirst({
            where: {
              keyId,
              organizationId: caller.organizationId,
              ...(own ? { userId: caller.userId } : {}),
            },
          });
          if (!owner)
            throw new ServiceError(404, "NOT_FOUND", "API key not found.");
          const key = await tx.apikey.findUnique({ where: { id: keyId } });
          if (key?.enabled)
            await createAuth(tx, this.config).api.updateApiKey({
              body: { keyId, userId: caller.userId, enabled: false },
            });
          const audit = await this.audit.write(
            context,
            {
              action: "keys.revoke",
              resourceType: "key",
              resourceIds: [keyId],
              detail: { reason: parsed.reason },
            },
            tx,
          );
          return {
            result: { id: keyId, updated: Boolean(key?.enabled) },
            audit,
          };
        });
      },
    );
  }
}
