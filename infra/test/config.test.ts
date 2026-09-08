import { expect, it } from "vitest";
import {
  applicationSecretsSchema,
  environmentSchema,
  settingsSchema,
} from "../config.js";

// @req R-INF-02
it("rejects credentials in plain environment configuration", () => {
  for (const key of [
    "DATABASE_MIGRATION_URL",
    "DATABASE_URL",
    "POSTGRES_PASSWORD",
    "BETTER_AUTH_SECRET",
    "AUTH_GOOGLE_CLIENT_SECRET",
    "OPENAI_API_KEY",
    "SMTP_PASSWORD",
    "SMTP_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    expect(environmentSchema.safeParse({ [key]: "value" }).success).toBe(false);
  }
  expect(
    environmentSchema.safeParse({
      AUTH_SIGNUP_MODE: "invite",
      EMBEDDINGS_ENABLED: "false",
      INSTANCE_MODE: "saas",
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "hello@example.com",
      STRIPE_PRO_PRICE_ID: "price_pro",
      FREE_MONTHLY_RECORDS: "1000",
      PRO_INCLUDED_RECORDS: "10000",
      CAL_COM_URL: "https://cal.com/example/demo",
    }).success,
  ).toBe(true);
});
// @req R-INF-02
it("allows IdP, embedding, payment and SMTP secrets without permitting migration credential injection", () => {
  expect(
    applicationSecretsSchema.safeParse({
      AUTH_GOOGLE_CLIENT_SECRET: "value",
      AUTH_OIDC_CLIENT_SECRET: "value",
      OPENAI_API_KEY: "value",
      STRIPE_SECRET_KEY: "value",
      STRIPE_WEBHOOK_SECRET: "value",
      SMTP_URL: "smtp://user:password@mail.example.com:587",
    }).success,
  ).toBe(true);
  expect(
    applicationSecretsSchema.safeParse({ DATABASE_MIGRATION_URL: "value" })
      .success,
  ).toBe(false);
});

// @req R-INF-02
it("requires explicit verified-identity scope and sender only for SES delivery", () => {
  const base = {
    stack: "prod",
    hostname: "example.com",
    certificateArn: "arn:aws:acm:us-west-2:123456789012:certificate/test",
    githubRepository: "example/agentcommons",
    githubOidcProviderArn:
      "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
  };
  expect(
    settingsSchema.safeParse({
      ...base,
      environment: { INSTANCE_MODE: "customer", EMAIL_TRANSPORT: "none" },
    }).success,
  ).toBe(true);
  expect(
    settingsSchema.safeParse({
      ...base,
      environment: { INSTANCE_MODE: "saas", EMAIL_TRANSPORT: "smtp" },
    }).success,
  ).toBe(true);
  const ses = {
    ...base,
    environment: {
      INSTANCE_MODE: "saas",
      EMAIL_TRANSPORT: "ses",
      EMAIL_FROM: "hello@example.com",
    },
  };
  expect(settingsSchema.safeParse(ses).success).toBe(false);
  for (const arn of [
    "*",
    "arn:aws:ses:us-west-2:123456789012:identity/*",
    "arn:aws:iam::123456789012:role/mail",
  ])
    expect(
      settingsSchema.safeParse({ ...ses, sesIdentityArn: arn }).success,
    ).toBe(false);
  const configured = {
    ...ses,
    sesIdentityArn: "arn:aws:ses:us-west-2:123456789012:identity/example.com",
  };
  expect(settingsSchema.safeParse(configured).success).toBe(true);
  expect(
    settingsSchema.safeParse({
      ...configured,
      environment: { EMAIL_TRANSPORT: "ses", EMAIL_FROM: "invalid" },
    }).success,
  ).toBe(false);
});
