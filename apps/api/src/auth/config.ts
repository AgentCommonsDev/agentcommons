import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authPlugins } from "@agentcommons/db/auth-plugins";
import type { Prisma, PrismaClient } from "@agentcommons/db";

export interface AuthConfiguration {
  publicUrl: string;
  secret: string;
  emailPasswordEnabled: boolean;
  signupMode: "open" | "invite" | "closed";
  allowedEmailDomains: readonly string[];
  socialProviders?: BetterAuthOptions["socialProviders"];
  oauthProviders?: Parameters<typeof authPlugins>[0];
}
export interface PasswordDelivery {
  userId: string;
  email: string;
  token: string;
  url: string;
}
export const PASSWORD_SETUP_SECONDS = 3600;

export function emailDomainAllowed(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  const domain = email.toLowerCase().split("@").at(-1);
  return (
    allowedDomains.length === 0 ||
    (domain !== undefined && allowedDomains.includes(domain))
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
  const invalidateSetupTokens = async (userId: string) => {
    await db.verification.deleteMany({
      where: { value: userId, identifier: { startsWith: "reset-password:" } },
    });
  };
  return betterAuth<NativeOptions>({
    baseURL: config.publicUrl,
    basePath: "/auth",
    logger: { disabled: true },
    secret: config.secret,
    database: prismaAdapter(db, { provider: "postgresql" }),
    plugins: authPlugins(config.oauthProviders),
    ...(config.socialProviders
      ? { socialProviders: config.socialProviders }
      : {}),
    advanced: {
      useSecureCookies: new URL(config.publicUrl).protocol === "https:",
    },
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: false,
        trustedProviders: [],
      },
    },
    user: {
      validateUserInfo: ({ user, source }) => {
        if (
          typeof user.email !== "string" ||
          !emailDomainAllowed(user.email, config.allowedEmailDomains)
        )
          return { error: "email_domain_not_allowed" };
        if (source.method === "oauth") {
          if (user.emailVerified !== true)
            return { error: "provider_email_unverified" };
          if (source.action === "create-user" && config.signupMode !== "open")
            return { error: "account_not_provisioned" };
        }
      },
    },
    databaseHooks: {
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
            await invalidateSetupTokens(account.userId);
          },
        },
      },
    },
    emailAndPassword: {
      enabled: config.emailPasswordEnabled,
      disableSignUp: true,
      resetPasswordTokenExpiresIn: PASSWORD_SETUP_SECONDS,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await invalidateSetupTokens(user.id);
      },
      sendResetPassword: ({ user, token, url }) => {
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
