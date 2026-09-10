import { expect, it } from "vitest";
import {
  applicationSecretsSchema,
  environmentSchema,
  clickhouseCloudUrlSchema,
  settingsSchema,
  singleNodeSettingsSchema,
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

// @req R-INF-07
it("selects the Fargate shape by default and validates single-node settings separately", () => {
  const fargate = settingsSchema.parse({
    stack: "dev",
    hostname: "dev.example.com",
    certificateArn: "arn:aws:acm:us-west-2:123456789012:certificate/test",
    githubRepository: "example/agentcommons",
    githubOidcProviderArn:
      "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
  });
  expect(fargate.deployment).toBe("fargate");
  const node = singleNodeSettingsSchema.parse({
    deployment: "single-node",
    stack: "zpghl",
    hostname: "hooks.example.com",
    environment: { INSTANCE_MODE: "customer", EMBEDDINGS_ENABLED: "false" },
  });
  expect(node).toMatchObject({
    instanceType: "t4g.large",
    volumeSize: 60,
    snapshotRetention: 7,
    autoUpdate: true,
  });
  // Pulumi config values arrive as strings; only the two spellings are accepted.
  expect(
    singleNodeSettingsSchema.parse({
      deployment: "single-node",
      stack: "zpghl",
      hostname: "hooks.example.com",
      autoUpdate: "false",
    }).autoUpdate,
  ).toBe(false);
  expect(
    singleNodeSettingsSchema.safeParse({
      deployment: "single-node",
      stack: "zpghl",
      hostname: "hooks.example.com",
      autoUpdate: "yes",
    }).success,
  ).toBe(false);
  expect(
    singleNodeSettingsSchema.safeParse({
      deployment: "single-node",
      stack: "zpghl",
      hostname: "hooks.example.com",
      volumeSize: "30",
    }).success,
  ).toBe(false);
  expect(
    singleNodeSettingsSchema.safeParse({
      deployment: "single-node",
      stack: "Prod Stack",
      hostname: "hooks.example.com",
    }).success,
  ).toBe(false);
  expect(
    singleNodeSettingsSchema.safeParse({
      deployment: "single-node",
      stack: "zpghl",
      hostname: "hooks.example.com",
      environment: { OPENAI_API_KEY: "value" },
    }).success,
  ).toBe(false);
});

// @req R-INF-07
it("requires a ClickHouse Cloud endpoint for the cloud trace store and parses its provider and region", () => {
  expect(
    clickhouseCloudUrlSchema.parse(
      "https://cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443",
    ),
  ).toEqual({
    origin: "https://cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443",
    provider: "aws",
    region: "us-west-2",
  });
  for (const value of [
    "http://cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443",
    "https://user:pw@cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443",
    "https://cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443/db",
    "https://example.com:8443",
  ])
    expect(clickhouseCloudUrlSchema.safeParse(value).success).toBe(false);
  const base = {
    deployment: "single-node",
    stack: "zpghl",
    hostname: "hooks.example.com",
  };
  expect(singleNodeSettingsSchema.parse(base).traceStore).toBe("local");
  expect(
    singleNodeSettingsSchema.safeParse({
      ...base,
      traceStore: "clickhouse-cloud",
    }).success,
  ).toBe(false);
  expect(
    singleNodeSettingsSchema.parse({
      ...base,
      traceStore: "clickhouse-cloud",
      clickhouseCloudUrl: "https://abc.us-west-2.aws.clickhouse.cloud:8443",
    }).clickhouseCloudUrl,
  ).toMatchObject({ provider: "aws", region: "us-west-2" });
  expect(
    singleNodeSettingsSchema.parse({ ...base }).clickhouseCloudPostgresTls,
  ).toBe("default");
  expect(
    singleNodeSettingsSchema.safeParse({
      ...base,
      clickhouseCloudPostgresTls: "verify-ca",
    }).success,
  ).toBe(false);
});

// @req R-INF-11
it("keeps the bundled PostgreSQL container by default and validates the Aurora Serverless v2 option", () => {
  const base = {
    deployment: "single-node",
    stack: "zpghl",
    hostname: "hooks.example.com",
  };
  expect(singleNodeSettingsSchema.parse(base).database).toEqual({
    kind: "bundled",
  });
  // Pulumi object config arrives with string leaves; capacities coerce.
  expect(
    singleNodeSettingsSchema.parse({
      ...base,
      database: { kind: "aurora-serverless-v2" },
    }).database,
  ).toEqual({
    kind: "aurora-serverless-v2",
    minCapacity: 0.5,
    maxCapacity: 4,
    engineVersion: "16",
    forceSsl: true,
  });
  expect(
    singleNodeSettingsSchema.parse({
      ...base,
      database: {
        kind: "aurora-serverless-v2",
        minCapacity: "1",
        maxCapacity: "2.5",
        engineVersion: "16.11",
        forceSsl: "false",
      },
    }).database,
  ).toMatchObject({
    minCapacity: 1,
    maxCapacity: 2.5,
    engineVersion: "16.11",
    forceSsl: false,
  });
  for (const database of [
    { kind: "rds" },
    { kind: "aurora-serverless-v2", minCapacity: 0 },
    { kind: "aurora-serverless-v2", minCapacity: 0.75 },
    { kind: "aurora-serverless-v2", minCapacity: 4, maxCapacity: 2 },
    { kind: "aurora-serverless-v2", maxCapacity: 256 },
    { kind: "aurora-serverless-v2", engineVersion: "15.8" },
    { kind: "aurora-serverless-v2", engineVersion: "17" },
    { kind: "aurora-serverless-v2", forceSsl: "yes" },
  ])
    expect(
      singleNodeSettingsSchema.safeParse({ ...base, database }).success,
      JSON.stringify(database),
    ).toBe(false);
  // ClickHouse Cloud reaches PostgreSQL at the public address; a private cluster cannot serve it.
  expect(
    singleNodeSettingsSchema.safeParse({
      ...base,
      traceStore: "clickhouse-cloud",
      clickhouseCloudUrl: "https://abc.us-west-2.aws.clickhouse.cloud:8443",
      database: { kind: "aurora-serverless-v2" },
    }).success,
  ).toBe(false);
});
