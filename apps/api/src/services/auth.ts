import { organizationEmbeddingSetting } from "../embeddings/settings.js";
import { registerDomain, requireDomainEnrollment } from "../auth/domain.js";
import type { WelcomeJobs } from "../auth/mail.js";
import { onboard } from "../auth/onboarding.js";
import { membershipTransaction } from "../auth/transaction.js";
import { auditedOperation, type AuditActor } from "./audit.js";
import { z } from "zod";
import {
  authConfigOutputSchema,
  domainInputSchema,
  domainsInputSchema,
  domainsOutputSchema,
  keySchema,
  meOutputSchema,
  organizationsOutputSchema,
  organizationSwitchOutputSchema,
  keysOutputSchema,
  keyCreateOutputSchema,
  keysInputSchema,
  keyCreateInputSchema,
  apiKeyRevealOutputSchema,
  reasonInputSchema,
  type onboardingInputSchema,
  type CallerContext,
  parseKeyPermissions,
} from "@agentcommons/core/schemas";
import {
  Prisma,
  lockTracePublication,
  type PrismaClient,
} from "@agentcommons/db";
import {
  billingReturnUrl,
  createAuth,
  domainEnrollmentEnabled,
  type AuthConfiguration,
  type NativeAuth,
} from "../auth/config.js";
import { authenticationFailure } from "../auth/failure.js";
import {
  cookieCaller,
  identityFromHeaders,
  keyIsActive,
  type AuthIdentity,
} from "../auth/identity.js";
import type { AuditService, AuditDescription } from "./audit.js";
import { CursorCodec } from "./cursor.js";
import {
  requireCaller,
  requirePermission,
  ServiceError,
  type ServiceContext,
  type ServiceResult,
} from "./context.js";
import { offsetPage, wireValue } from "./read-budget.js";
import { KeySecretCipher } from "./key-secrets.js";

class AuthResponseFailure extends Error {
  constructor(readonly response: Response) {
    super("Authentication request failed");
  }
}
/** Native Better Auth routes the API forwards; SaaS-only rows serve hosted signup. */
const nativeRoutes: readonly {
  method: "GET" | "POST";
  pattern: RegExp;
  saasOnly?: true;
}[] = [
  { method: "POST", pattern: /^\/auth\/stripe\/webhook$/ },
  { method: "POST", pattern: /^\/auth\/sign-in\/(email|social)$/ },
  { method: "POST", pattern: /^\/auth\/(sign-out|reset-password)$/ },
  { method: "GET", pattern: /^\/auth\/(get-session|error)$/ },
  { method: "GET", pattern: /^\/auth\/reset-password\/[^/]+$/ },
  { method: "GET", pattern: /^\/auth\/callback\/[^/]+$/ },
  { method: "POST", pattern: /^\/auth\/callback\/[^/]+$/ },
  {
    method: "POST",
    pattern:
      /^\/auth\/(sign-up\/email|send-verification-email|request-password-reset)$/,
    saasOnly: true,
  },
  { method: "GET", pattern: /^\/auth\/verify-email$/, saasOnly: true },
];
const stripeObjectSchema = z.looseObject({
  customer: z
    .union([z.string().max(255), z.looseObject({ id: z.string().max(255) })])
    .nullable()
    .optional(),
});

export function requireCookie(
  context: ServiceContext,
  failure: { code: string; message: string } = {
    code: "COOKIE_REQUIRED",
    message: "Use a signed-in browser session for this operation.",
  },
): CallerContext {
  const caller = requireCaller(context);
  if (caller.authMethod !== "cookie")
    throw new ServiceError(403, failure.code, failure.message);
  return caller;
}

export async function lockOrganization(
  tx: Prisma.TransactionClient,
  caller: CallerContext,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organization WHERE id=${caller.organizationId} FOR NO KEY UPDATE`;
  const member = await tx.member.findFirst({
    where: {
      organizationId: caller.organizationId,
      userId: caller.userId,
      removedAt: null,
    },
  });
  if (!member || member.suspended || member.role !== caller.role)
    throw new ServiceError(
      403,
      "MEMBERSHIP_CHANGED",
      "Your membership changed. Refresh and try again.",
    );
  if (caller.apiKeyId) {
    const key = await tx.apikey.findUnique({ where: { id: caller.apiKeyId } });
    if (!keyIsActive(key, caller.organizationId))
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
  user: { email: string; name: string } | null,
) {
  return keySchema.parse({
    id: key.id,
    organization_id: owner.organizationId,
    user_id: owner.userId,
    user_email: user?.email ?? null,
    user_name: user?.name ?? null,
    name: key.name,
    prefix: key.prefix,
    permissions: parseKeyPermissions(key.permissions),
    enabled: key.enabled ?? true,
    created_at: key.createdAt.toISOString(),
    expires_at: key.expiresAt?.toISOString() ?? null,
    last_used_at: key.lastRequest?.toISOString() ?? null,
  });
}

/** Audit actor for a request whose identity resolved, with or without an organization. */
function identityActor(identity: AuthIdentity): AuditActor {
  return {
    userId: identity.user.id,
    apiKeyId: identity.caller?.apiKeyId ?? null,
    authMethod: identity.caller?.authMethod ?? "cookie",
  };
}
/** Audit actor for Stripe webhook deliveries, scoped once the customer maps to an organization. */
function stripeActor(organizationId: string | null | undefined): AuditActor {
  return {
    userId: null,
    apiKeyId: null,
    authMethod: "stripe",
    ...(organizationId ? { organizationId } : {}),
  };
}

export class AuthService {
  readonly native: NativeAuth;
  private readonly cursors: CursorCodec;
  private readonly saas: boolean;
  /** Encrypts stored key plaintext for owner reveal (ADR 0051); derived once per process. */
  private readonly secrets: KeySecretCipher;
  constructor(
    readonly prisma: PrismaClient,
    readonly config: AuthConfiguration,
    private readonly audit: AuditService,
    private readonly features: "similar_sessions"[] = [],
    private readonly welcome?: WelcomeJobs,
  ) {
    this.native = createAuth(prisma, config);
    this.cursors = new CursorCodec(config.secret);
    this.secrets = new KeySecretCipher(config.secret);
    this.saas = config.instanceMode === "saas";
  }

  /** The identity the adapter authenticated, or a fresh resolution for direct callers. */
  private identity(context: ServiceContext): Promise<AuthIdentity> {
    return context.principal
      ? Promise.resolve(context.principal)
      : identityFromHeaders(
          this.prisma,
          this.native,
          context.headers,
          this.config,
        );
  }

  async configuration(context: ServiceContext) {
    let caller = context.caller;
    if (
      !caller &&
      (context.headers.has("cookie") || context.headers.has("authorization"))
    ) {
      try {
        caller = (await this.identity(context)).caller;
      } catch (error) {
        if (!(
          error instanceof ServiceError && [401, 403].includes(error.statusCode)
        ))
          throw error;
      }
    }
    const features =
      caller &&
      (
        await organizationEmbeddingSetting(
          this.prisma,
          caller.organizationId,
          false,
          this.saas,
        )
      ).enabled
        ? this.features
        : [];
    const result = authConfigOutputSchema.parse({
      features,
      email_password_enabled: this.config.emailPasswordEnabled,
      social_provider:
        Object.keys(this.config.socialProviders ?? {})[0] ?? null,
      oidc_enabled: Boolean(this.config.oauthProviders?.length),
      signup_mode: this.config.signupMode,
    });
    const audit = await this.audit.write(
      { ...context, caller },
      {
        action: "auth.configuration",
      },
    );
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
        this.config,
      );
    } catch (error) {
      // A rejection only when the lookup completed; anything else is 503 AUTH_UNAVAILABLE (§9.2).
      const failure = authenticationFailure(error);
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
    const operation: AuditDescription = { action: "auth.request" };
    return auditedOperation(this.audit, context, operation, async () => {
      const path = new URL(request.url).pathname;
      if (
        path === "/auth/subscription/success" &&
        request.method === "GET" &&
        this.saas
      ) {
        const response = Response.redirect(billingReturnUrl(this.config), 303);
        return {
          result: response,
          audit: await this.audit.write(context, {
            action: "billing.return",
            statusCode: 303,
          }),
        };
      }
      const webhook = path === "/auth/stripe/webhook";
      const allowed = nativeRoutes.some(
        (route) =>
          route.method === request.method &&
          route.pattern.test(path) &&
          (!route.saasOnly || this.saas),
      );
      if ((webhook && (!this.saas || !this.config.stripe)) || !allowed) {
        throw new ServiceError(
          404,
          "NOT_FOUND",
          "This authentication endpoint is not available.",
        );
      }
      const action = webhook
        ? "billing.webhook"
        : path.startsWith("/auth/callback/")
          ? "auth.callback"
          : path.startsWith("/auth/reset-password/")
            ? "auth.password_setup"
            : `auth.${path.split("/").at(-1) ?? "request"}`;
      operation.action = action;
      let stripeEvent: {
        id: string;
        type: string;
        customer: string | null;
      } | null = null;
      if (webhook && this.config.stripe) {
        try {
          const event =
            await this.config.stripe.client.webhooks.constructEventAsync(
              await request.clone().text(),
              request.headers.get("stripe-signature") ?? "",
              this.config.stripe.webhookSecret,
            );
          const object = stripeObjectSchema.parse(event.data.object);
          stripeEvent = {
            id: event.id,
            type: event.type,
            customer:
              typeof object.customer === "string"
                ? object.customer
                : (object.customer?.id ?? null),
          };
        } catch {
          throw new ServiceError(
            400,
            "INVALID_WEBHOOK",
            "The webhook signature is invalid.",
          );
        }
      }
      const stripeDetail = stripeEvent
        ? { event_id: stripeEvent.id, event_type: stripeEvent.type }
        : null;
      if (stripeEvent) {
        const organization = stripeEvent.customer
          ? await this.prisma.organization.findFirst({
              where: { stripeCustomerId: stripeEvent.customer },
            })
          : null;
        operation.actor = stripeActor(organization?.id);
        operation.detail = stripeDetail;
      }
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (stripeEvent?.customer)
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe:${stripeEvent.customer}`}, 0))`;
            const billingOrganizations = stripeEvent?.customer
              ? await tx.$queryRaw<
                  { id: string }[]
                >`SELECT id FROM organization WHERE "stripeCustomerId"=${stripeEvent.customer} ORDER BY id FOR NO KEY UPDATE`
              : [];
            const native = createAuth(tx, this.config);
            let priorIdentity: AuthIdentity | null = null;
            try {
              if (!webhook)
                priorIdentity = await identityFromHeaders(
                  tx,
                  native,
                  request.headers,
                  this.config,
                );
            } catch {
              /* Most authentication requests start without an identity. */
            }
            const response = await native.handler(request);
            if (response.status >= 400) throw new AuthResponseFailure(response);
            // Native Stripe writes remain uncommitted while readers finish their snapshot.
            // SDK reconciliation above never holds the publication lock.
            for (const organization of billingOrganizations)
              await lockTracePublication(tx, organization.id, "write");
            const cookies = response.headers
              .getSetCookie()
              .map((value) => value.split(";")[0])
              .join("; ");
            let identity: AuthIdentity | null = null;
            try {
              if (!webhook)
                identity = await identityFromHeaders(
                  tx,
                  native,
                  cookies ? new Headers({ cookie: cookies }) : request.headers,
                  this.config,
                );
            } catch {
              /* Anonymous auth actions retain a null actor. */
            }
            identity ??= priorIdentity;
            if (identity)
              await this.welcome?.enqueueWelcome(tx, identity.user.id);
            // The native handler may have just linked the customer to an organization,
            // so the audit scope is read again inside this transaction.
            const billingOrganization = stripeEvent?.customer
              ? await tx.organization.findFirst({
                  where: { stripeCustomerId: stripeEvent.customer },
                })
              : null;
            const scoped = {
              ...context,
              caller: webhook ? null : (identity?.caller ?? context.caller),
            };
            const audit = await this.audit.write(
              scoped,
              {
                action,
                statusCode: response.status,
                ...(stripeDetail
                  ? {
                      actor: stripeActor(billingOrganization?.id),
                      detail: stripeDetail,
                    }
                  : {}),
                ...(identity ? { actor: identityActor(identity) } : {}),
              },
              tx,
            );
            return { result: response, audit };
          },
          {
            timeout: 30_000,
            isolationLevel: webhook
              ? Prisma.TransactionIsolationLevel.ReadCommitted
              : Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (!(error instanceof AuthResponseFailure)) throw error;
        const audit = await this.audit.write(context, {
          ...operation,
          action,
          statusCode: error.response.status,
        });
        return { result: error.response, audit };
      }
    });
  }

  domains(context: ServiceContext, input: z.input<typeof domainsInputSchema>) {
    return auditedOperation(
      this.audit,
      context,
      { action: "domains.list" },
      async () => {
        const caller = requirePermission(context, "admin");
        const parsed = domainsInputSchema.parse(input);
        const { cursor, ...query } = parsed;
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "domains.list",
          input: query,
        });
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          const page = await offsetPage(
            this.cursors,
            binding,
            cursor,
            parsed.limit,
            async (skip, take) =>
              (
                await tx.ssoProvider.findMany({
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
                  },
                  orderBy: [{ domain: parsed.order }, { providerId: "asc" }],
                  skip,
                  take,
                })
              ).map((row) => ({
                organization_id: caller.organizationId,
                domain: row.domain,
                provider_id: row.providerId,
                verified: row.domainVerified === true,
              })),
          );
          const result = domainsOutputSchema.parse({
            enabled: domainEnrollmentEnabled(this.config),
            items: page.items,
            cursor: page.cursor,
          });
          return {
            result,
            audit: await this.audit.write(
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

  /** An owner or admin allowlists a Google domain for their current organization. */
  domain(context: ServiceContext, input: z.input<typeof domainInputSchema>) {
    return auditedOperation(
      this.audit,
      context,
      { action: "operator.domain.register" },
      async () => {
        const caller = requirePermission(context, "admin");
        requireCookie(context);
        const { domain } = domainInputSchema.parse(input);
        requireDomainEnrollment(this.config, domain);
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          return registerDomain(
            tx,
            createAuth(tx, this.config),
            this.audit,
            context,
            caller.organizationId,
            domain,
          );
        });
      },
    );
  }

  private async onboardingState(
    user: AuthIdentity["user"],
  ): Promise<
    "verify_email" | "create_organization" | "ready" | "contact_admin"
  > {
    if (!user.emailVerified) return "verify_email";
    if (
      await this.prisma.member.count({
        where: { userId: user.id, suspended: false, removedAt: null },
      })
    )
      return "ready";
    const { onboardingOrganizationId } =
      await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { onboardingOrganizationId: true },
      });
    return onboardingOrganizationId ? "contact_admin" : "create_organization";
  }

  onboard(
    context: ServiceContext,
    input: z.input<typeof onboardingInputSchema>,
  ) {
    return onboard(
      this.prisma,
      this.config,
      this.audit,
      context,
      () => this.identity(context),
      input,
      this.welcome,
    );
  }

  createOrganization(
    context: ServiceContext,
    input: z.input<typeof onboardingInputSchema>,
  ) {
    return onboard(
      this.prisma,
      this.config,
      this.audit,
      context,
      () => this.identity(context),
      input,
      this.welcome,
      "explicit",
    );
  }

  async me(context: ServiceContext) {
    return auditedOperation(
      this.audit,
      context,
      { action: "auth.me" },
      async () => {
        const identity = await this.identity(context);
        const caller = identity.caller;
        const [organization, key, onboarding] = await Promise.all([
          caller
            ? this.prisma.organization.findUniqueOrThrow({
                where: { id: caller.organizationId },
              })
            : null,
          caller?.apiKeyId
            ? this.prisma.apikey.findUnique({ where: { id: caller.apiKeyId } })
            : null,
          this.saas
            ? this.onboardingState(identity.user)
            : ("not_applicable" as const),
        ]);
        const { emailVerified, ...user } = identity.user;
        const result = meOutputSchema.parse({
          user: { ...user, email_verified: emailVerified },
          onboarding,
          caller,
          organization:
            organization && caller
              ? {
                  id: organization.id,
                  name: organization.name,
                  slug: organization.slug,
                  role: caller.role,
                }
              : null,
          key: key ? { id: key.id, name: key.name } : null,
        });
        const audit = await this.audit.write(
          { ...context, caller },
          { action: "auth.me", actor: identityActor(identity) },
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
        const identity = await this.identity(context);
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
            removedAt: null,
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
          { action: "auth.organizations", actor: identityActor(identity) },
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
        const identity = await this.identity(context);
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
              removedAt: null,
            },
            include: { organization: true },
          });
          if (!member)
            throw new ServiceError(404, "NOT_FOUND", "Organization not found.");
          const caller = cookieCaller(member);
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
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "keys",
          userId: own ? caller.userId : null,
          input: query,
        });
        const sort = {
          name: "k.name",
          user_id: "o.user_id",
          created_at: 'k."createdAt"',
          expires_at: 'k."expiresAt"',
          last_used_at: 'k."lastRequest"',
          enabled: "k.enabled",
        } as const;
        const page = await offsetPage(
          this.cursors,
          binding,
          cursor,
          parsed.limit,
          async (offset, take) => {
            const owners = await this.prisma.$queryRaw<
              {
                id: string;
                userId: string;
                userEmail: string | null;
                userName: string | null;
              }[]
            >(Prisma.sql`
      SELECT k.id, o.user_id AS "userId", u.email AS "userEmail", u.name AS "userName" FROM apikey k JOIN api_key_owner o ON o.key_id=k.id
      LEFT JOIN "user" u ON u.id=o.user_id
      WHERE o.organization_id=${caller.organizationId} AND k."referenceId"=o.organization_id
      ${own ? Prisma.sql`AND o.user_id=${caller.userId}` : parsed.filters.user_id ? Prisma.sql`AND o.user_id=${parsed.filters.user_id}` : Prisma.empty}
      ${parsed.filters.enabled === undefined ? Prisma.empty : Prisma.sql`AND k.enabled=${parsed.filters.enabled}`}
      ORDER BY ${Prisma.raw(sort[parsed.sort ?? "created_at"])} ${Prisma.raw(parsed.order.toUpperCase())}, k.id ASC
      OFFSET ${offset} LIMIT ${take}`);
            const keys = new Map(
              (
                await this.prisma.apikey.findMany({
                  where: { id: { in: owners.map((row) => row.id) } },
                })
              ).map((key) => [key.id, key]),
            );
            return owners.flatMap((owner) => {
              const key = keys.get(owner.id);
              return key
                ? [
                    mapKey(
                      key,
                      {
                        organizationId: caller.organizationId,
                        userId: owner.userId,
                      },
                      owner.userEmail !== null && owner.userName !== null
                        ? { email: owner.userEmail, name: owner.userName }
                        : null,
                    ),
                  ]
                : [];
            });
          },
        );
        const result = keysOutputSchema.parse({
          items: page.items,
          cursor: page.cursor,
        });
        const audit = await this.audit.write(context, {
          action: "keys.list",
          resourceType: "key",
          detail: { ...query, row_count: page.items.length },
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
          await tx.apiKeySecret.create({
            data: {
              apiKeyId: native.id,
              organizationId: caller.organizationId,
              userId: caller.userId,
              ...this.secrets.seal(native.id, native.key),
            },
          });
          const stored = await tx.apikey.findUniqueOrThrow({
            where: { id: native.id },
          });
          const result = keyCreateOutputSchema.parse({
            key: native.key,
            metadata: mapKey(
              stored,
              owner,
              await tx.user.findUnique({
                where: { id: owner.userId },
                select: { email: true, name: true },
              }),
            ),
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
          // A revoked key can never be copied again (ADR 0051).
          await tx.apiKeySecret.deleteMany({ where: { apiKeyId: keyId } });
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

  /**
   * Return the plaintext of one of the caller's own active keys from its encrypted copy
   * (ADR 0051). Cookie sessions only: an API key must never be able to read another
   * key. Keys of other members, other organizations and revoked keys are missing.
   */
  async revealKey(context: ServiceContext, keyId: string) {
    return auditedOperation(
      this.audit,
      context,
      { action: "keys.reveal", resourceType: "key", resourceIds: [keyId] },
      async () => {
        const caller = requireCookie(context, {
          code: "KEY_REVEAL_SESSION_REQUIRED",
          message: "Sign in to the dashboard to copy an API key.",
        });
        const secret = await this.prisma.apiKeySecret.findFirst({
          where: {
            apiKeyId: keyId,
            organizationId: caller.organizationId,
            userId: caller.userId,
          },
        });
        const key = secret
          ? await this.prisma.apikey.findUnique({ where: { id: keyId } })
          : null;
        if (
          !secret ||
          !key?.enabled ||
          key.referenceId !== caller.organizationId
        )
          throw new ServiceError(404, "NOT_FOUND", "API key not found.");
        const result = apiKeyRevealOutputSchema.parse({
          key: this.secrets.open(keyId, secret),
        });
        const audit = await this.audit.write(context, {
          action: "keys.reveal",
          resourceType: "key",
          resourceIds: [keyId],
        });
        return { result, audit };
      },
    );
  }
}
