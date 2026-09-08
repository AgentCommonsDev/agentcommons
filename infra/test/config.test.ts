import { expect, it } from "vitest";
import { applicationSecretsSchema, environmentSchema } from "../config.js";

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
  ]) {
    expect(environmentSchema.safeParse({ [key]: "value" }).success).toBe(false);
  }
  expect(
    environmentSchema.safeParse({
      AUTH_SIGNUP_MODE: "invite",
      EMBEDDINGS_ENABLED: "false",
    }).success,
  ).toBe(true);
});
// @req R-INF-02
it("allows IdP and embedding secrets without permitting migration credential injection", () => {
  expect(
    applicationSecretsSchema.safeParse({
      AUTH_GOOGLE_CLIENT_SECRET: "value",
      AUTH_OIDC_CLIENT_SECRET: "value",
      OPENAI_API_KEY: "value",
    }).success,
  ).toBe(true);
  expect(
    applicationSecretsSchema.safeParse({ DATABASE_MIGRATION_URL: "value" })
      .success,
  ).toBe(false);
});
