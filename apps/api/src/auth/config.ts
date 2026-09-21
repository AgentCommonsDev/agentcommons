import { Redactor } from "@agentcommons/core/redaction";
import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authPlugins, authUserFields } from "@agentcommons/db/auth-plugins";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import { invalidateSetupTokens } from "./setup-tokens.js";
import type Stripe from "stripe";
import type { AuthMail } from "./mail.js";

export interface AuthConfiguration {
  instanceMode?: "customer" | "public" | "saas";
  publicUrl: string;
  secret: string;
  emailPasswordEnabled: boolean;
  signupMode: "open" | "invite" | "closed";
  allowedEmailDomains: readonly string[];
  socialProviders?: BetterAuthOptions["socialProviders"];
  oauthProviders?: Parameters<typeof authPlugins>[0];
  mail?: AuthMail;
  stripe?: {
    client: Stripe;
    webhookSecret: string;
    priceId: string;
    embeddingsPriceId: string;
    capturePriceId: string;
    embeddingUsagePriceId: string;
    captureMeterId: string;
    embeddingMeterId: string;
    captureEventName: string;
    embeddingEventName: string;
    captureCentsPer1000: number;
    embeddingCentsPer1000: number;
    includedRecords: number;
  };
}
/** The configuration request authentication and job re-authorization read. */
export type IdentityPolicy = Pick<
  AuthConfiguration,
  "allowedEmailDomains" | "instanceMode"
>;
export interface PasswordDelivery {
  userId: string;
  email: string;
  token: string;
  url: string;
}
export const PASSWORD_SETUP_SECONDS = 3600;
/** Where Stripe checkout, the portal and the subscription return redirect land. */
export function billingReturnUrl(config: Pick<AuthConfiguration, "publicUrl">) {
  return `${config.publicUrl}/app/billing`;
}
/** The dashboard page a native reset token opens for first password setup. */
export function passwordSetupUrl(config: Pick<AuthConfiguration, "publicUrl">) {
  return `${config.publicUrl}/setup-password`;
}
const identityRedactor = new Redactor();
async function redactUserName<T extends { name?: string }>(
  user: T,
): Promise<{ data: T }> {
  return {
    data: {
      ...user,
      ...(typeof user.name === "string"
        ? { name: (await identityRedactor.text(user.name)).value }
        : {}),
    },
  };
}

/** The lowercase domain part of an email address. */
export function emailDomain(email: string): string | undefined {
  return email.toLowerCase().split("@").at(-1);
}

export function emailDomainAllowed(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  const domain = emailDomain(email);
  return (
    allowedDomains.length === 0 ||
    (domain !== undefined && allowedDomains.includes(domain))
  );
}

export function domainEnrollmentEnabled(config: AuthConfiguration): boolean {
  return (
    config.signupMode !== "closed" &&
    Object.keys(config.socialProviders ?? {}).length === 1 &&
    Boolean(config.socialProviders?.google) &&
    !config.oauthProviders?.length
  );
}

export function createAuth(
  db: PrismaClient | Prisma.TransactionClient,
  config: AuthConfiguration,
  deliver?: (value: PasswordDelivery) => void,
): NativeAuth {
  if (
    !config.emailPasswordEnabled &&
    !Object.keys(config.socialProviders ?? {}).length &&
    !config.oauthProviders?.length
  ) {
    throw new Error("Configure at least one login method.");
  }
  return betterAuth<NativeOptions>({
    baseURL: config.publicUrl,
    basePath: "/auth",
    logger: { disabled: true },
    secret: config.secret,
    database: prismaAdapter(db, { provider: "postgresql" }),
    plugins: authPlugins(
      config.oauthProviders,
      domainEnrollmentEnabled(config),
      config.instanceMode === "saas" && config.stripe
        ? {
            stripeClient: config.stripe.client,
            stripeWebhookSecret: config.stripe.webhookSecret,
            createCustomerOnSignUp: false,
            organization: { enabled: true },
            subscription: {
              enabled: true,
              requireEmailVerification: true,
              plans: [
                {
                  name: "pro",
                  priceId: config.stripe.priceId,
                  lineItems: [{ price: config.stripe.capturePriceId }],
                },
                {
                  name: "pro_embeddings",
                  priceId: config.stripe.embeddingsPriceId,
                  lineItems: [
                    { price: config.stripe.capturePriceId },
                    { price: config.stripe.embeddingUsagePriceId },
                  ],
                },
              ],
              authorizeReference: async ({ user, referenceId }) => {
                return (
                  (await db.member.count({
                    where: {
                      userId: user.id,
                      organizationId: referenceId,
                      role: "owner",
                      suspended: false,
                      removedAt: null,
                    },
                  })) === 1
                );
              },
            },
          }
        : undefined,
    ),
    ...(config.socialProviders
      ? { socialProviders: config.socialProviders }
      : {}),
    advanced: {
      useSecureCookies: new URL(config.publicUrl).protocol === "https:",
    },
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: config.instanceMode === "saas",
        trustedProviders: [],
      },
    },
    user: {
      additionalFields: authUserFields,
      validateUserInfo: async ({ user, source }) => {
        if (
          typeof user.email !== "string" ||
          !emailDomainAllowed(user.email, config.allowedEmailDomains)
        )
          return { error: "email_domain_not_allowed" };
        if (source.method === "oauth") {
          if (user.emailVerified !== true)
            return { error: "provider_email_unverified" };
          if (source.action === "create-user" && config.signupMode !== "open") {
            const domain = emailDomain(user.email);
            const providers =
              domain &&
              config.signupMode === "invite" &&
              domainEnrollmentEnabled(config)
                ? await db.ssoProvider.findMany({
                    where: {
                      domain,
                      domainVerified: true,
                      organizationId: { not: null },
                      issuer: "https://accounts.google.com",
                    },
                    take: 2,
                  })
                : [];
            if (providers.length !== 1)
              return { error: "account_not_provisioned" };
          }
        }
      },
    },
    databaseHooks: {
      user: {
        create: { before: redactUserName },
        update: { before: redactUserName },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({
              where: { id: session.userId },
            });
            if (
              !user ||
              !emailDomainAllowed(user.email, config.allowedEmailDomains)
            )
              throw new APIError("FORBIDDEN", {
                message: "This email domain is not allowed.",
              });
          },
        },
      },
      account: {
        create: {
          after: async (account) => {
            await invalidateSetupTokens(db, account.userId);
          },
        },
      },
    },
    ...(config.instanceMode === "saas"
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              if (!config.mail)
                throw new APIError("SERVICE_UNAVAILABLE", {
                  message: "Email delivery is not configured.",
                });
              await config.mail.send({
                to: user.email,
                kind: "verification",
                url,
              });
            },
          },
        }
      : {}),
    emailAndPassword: {
      enabled: config.emailPasswordEnabled,
      disableSignUp: config.instanceMode !== "saas",
      requireEmailVerification: config.instanceMode === "saas",
      resetPasswordTokenExpiresIn: PASSWORD_SETUP_SECONDS,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await invalidateSetupTokens(db, user.id);
      },
      sendResetPassword: async ({ user, token, url }) => {
        if (!deliver && config.instanceMode === "saas" && config.mail) {
          await config.mail.send({ to: user.email, kind: "reset", url });
          return;
        }
        if (!deliver)
          throw new Error(
            "Password setup must be requested by an administrator.",
          );
        deliver({ userId: user.id, email: user.email, token, url });
        return Promise.resolve();
      },
    },
  });
}

type NativeOptions = BetterAuthOptions & {
  plugins: ReturnType<typeof authPlugins>;
};
export type NativeAuth = Auth<NativeOptions>;
