import { z } from "zod";
import { socialProviderList } from "better-auth/social-providers";
import type { AuthConfiguration } from "./config.js";
import Stripe from "stripe";
import { authMail } from "./mail.js";

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
  INSTANCE_MODE: z.enum(["customer", "public", "saas"]).default("customer"),
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
  STRIPE_SECRET_KEY: optionalText,
  STRIPE_WEBHOOK_SECRET: optionalText,
  STRIPE_PRO_PRICE_ID: optionalText,
  STRIPE_PRO_EMBEDDINGS_PRICE_ID: optionalText,
  STRIPE_CAPTURE_PRICE_ID: optionalText,
  STRIPE_EMBEDDING_USAGE_PRICE_ID: optionalText,
  STRIPE_CAPTURE_METER_ID: optionalText,
  STRIPE_EMBEDDING_METER_ID: optionalText,
  STRIPE_CAPTURE_EVENT_NAME: optionalText,
  STRIPE_EMBEDDING_EVENT_NAME: optionalText,
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
    instanceMode: env.INSTANCE_MODE,
    publicUrl: env.PUBLIC_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailPasswordEnabled: env.AUTH_EMAIL_PASSWORD_ENABLED === "true",
    signupMode: env.INSTANCE_MODE === "saas" ? "open" : env.AUTH_SIGNUP_MODE,
    allowedEmailDomains: env.AUTH_ALLOWED_EMAIL_DOMAINS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  };
  const mail = authMail(environment);
  if (mail) auth.mail = mail;
  if (
    env.STRIPE_SECRET_KEY ||
    env.STRIPE_WEBHOOK_SECRET ||
    env.STRIPE_PRO_PRICE_ID
  ) {
    auth.stripe = {
      client: new Stripe(z.string().min(1).parse(env.STRIPE_SECRET_KEY)),
      webhookSecret: z.string().min(1).parse(env.STRIPE_WEBHOOK_SECRET),
      priceId: z.string().min(1).parse(env.STRIPE_PRO_PRICE_ID),
      embeddingsPriceId: z
        .string()
        .min(1)
        .parse(env.STRIPE_PRO_EMBEDDINGS_PRICE_ID),
      capturePriceId: z.string().min(1).parse(env.STRIPE_CAPTURE_PRICE_ID),
      embeddingUsagePriceId: z
        .string()
        .min(1)
        .parse(env.STRIPE_EMBEDDING_USAGE_PRICE_ID),
      captureMeterId: z.string().min(1).parse(env.STRIPE_CAPTURE_METER_ID),
      embeddingMeterId: z.string().min(1).parse(env.STRIPE_EMBEDDING_METER_ID),
      captureEventName: z.string().min(1).parse(env.STRIPE_CAPTURE_EVENT_NAME),
      embeddingEventName: z
        .string()
        .min(1)
        .parse(env.STRIPE_EMBEDDING_EVENT_NAME),
      captureCentsPer1000: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(1_000_000)
        .parse(environment.CAPTURE_CENTS_PER_1000),
      embeddingCentsPer1000: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(1_000_000)
        .parse(environment.EMBEDDING_CENTS_PER_1000),
      includedRecords: z.coerce
        .number()
        .int()
        .positive()
        .default(10_000)
        .parse(environment.PRO_INCLUDED_RECORDS),
    };
  }
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
