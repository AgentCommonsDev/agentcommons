import { z } from "zod";
import { socialProviderList } from "better-auth/social-providers";
import type { AuthConfiguration } from "./config.js";

export const publicUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, "PUBLIC_URL must be an HTTP or HTTPS origin.")
  .transform((value) => new URL(value).origin);

const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const schema = z.object({
  PUBLIC_URL: publicUrlSchema,
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  AUTH_EMAIL_PASSWORD_ENABLED: z.enum(["true", "false"]).default("true"),
  AUTH_SIGNUP_MODE: z.enum(["open", "invite", "closed"]).default("invite"),
  AUTH_ALLOWED_EMAIL_DOMAINS: z.string().default(""),
  AUTH_SOCIAL_PROVIDER: optionalText,
  AUTH_OIDC_ISSUER: optionalText,
  AUTH_OIDC_CLIENT_ID: optionalText,
  AUTH_OIDC_CLIENT_SECRET: optionalText,
  AUTH_OIDC_SCOPES: z.string().default("openid,email,profile"),
});

/** The API and operator commands share the same native provider configuration. */
export function authEnvironment(environment: NodeJS.ProcessEnv): {
  databaseUrl: string;
  auth: AuthConfiguration;
} {
  const env = schema.parse(environment);
  if (
    env.AUTH_SOCIAL_PROVIDER &&
    (env.AUTH_OIDC_ISSUER ||
      env.AUTH_OIDC_CLIENT_ID ||
      env.AUTH_OIDC_CLIENT_SECRET)
  )
    throw new Error("Configure one social or OIDC provider.");
  const auth: AuthConfiguration = {
    publicUrl: env.PUBLIC_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailPasswordEnabled: env.AUTH_EMAIL_PASSWORD_ENABLED === "true",
    signupMode: env.AUTH_SIGNUP_MODE,
    allowedEmailDomains: env.AUTH_ALLOWED_EMAIL_DOMAINS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  };
  if (env.AUTH_SOCIAL_PROVIDER) {
    const provider = z.enum(socialProviderList).parse(env.AUTH_SOCIAL_PROVIDER);
    const prefix = `AUTH_${provider.toUpperCase()}_`;
    const clientId = z.string().min(1).parse(environment[`${prefix}CLIENT_ID`]);
    const clientSecret = z
      .string()
      .min(1)
      .parse(environment[`${prefix}CLIENT_SECRET`]);
    auth.socialProviders = { [provider]: { clientId, clientSecret } };
  }
  if (
    env.AUTH_OIDC_ISSUER ||
    env.AUTH_OIDC_CLIENT_ID ||
    env.AUTH_OIDC_CLIENT_SECRET
  ) {
    const issuer = z.url().parse(env.AUTH_OIDC_ISSUER);
    auth.oauthProviders = [
      {
        providerId: "oidc",
        discoveryUrl: `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        requireIdTokenVerification: true,
        clientId: z.string().min(1).parse(env.AUTH_OIDC_CLIENT_ID),
        clientSecret: z.string().min(1).parse(env.AUTH_OIDC_CLIENT_SECRET),
        scopes: env.AUTH_OIDC_SCOPES.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    ];
  }
  return { databaseUrl: env.DATABASE_URL, auth };
}
