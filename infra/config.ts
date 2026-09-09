import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";

export const applicationSecretsSchema = z.record(
  z
    .string()
    .regex(
      /^(?:AUTH_[A-Z0-9_]+_CLIENT_(?:ID|SECRET)|OPENAI_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SMTP_URL)$/,
    ),
  z.string(),
);
export const environmentSchema = z.record(
  z
    .string()
    .regex(
      /^(?!DATABASE_|POSTGRES_|BETTER_AUTH_SECRET$|SMTP_URL$)(?!.*(?:_SECRET|_KEY|_PASSWORD)$)[A-Z][A-Z0-9_]*$/,
    ),
  z.string(),
);
const hostnameSchema = z
  .string()
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  );

export const settingsSchema = z
  .object({
    deployment: z.literal("fargate").default("fargate"),
    stack: z.enum(["dev", "prod"]),
    hostname: hostnameSchema,
    databaseInstanceClass: z.enum(["db.t4g.micro", "db.t4g.small"]).optional(),
    hostedZoneId: z.string().min(1).optional(),
    certificateArn: z.string().startsWith("arn:aws:acm:").optional(),
    githubRepository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    githubOidcProviderArn: z.string().startsWith("arn:aws:iam:"),
    alarmEmail: z.email().optional(),
    sesIdentityArn: z
      .string()
      .regex(
        /^arn:(?:aws|aws-us-gov|aws-cn):ses:[a-z0-9-]+:\d{12}:identity\/[A-Za-z0-9@._+-]+$/,
      )
      .optional(),
    environment: environmentSchema.default({}),
  })
  .refine(
    (v) => v.hostedZoneId !== undefined || v.certificateArn !== undefined,
    {
      message:
        "Provide hostedZoneId for managed ACM validation or an issued certificateArn.",
    },
  )
  .superRefine((settings, context) => {
    if (settings.environment.EMAIL_TRANSPORT === "ses") {
      if (!settings.sesIdentityArn)
        context.addIssue({
          code: "custom",
          path: ["sesIdentityArn"],
          message: "SES delivery requires the ARN of a verified SES identity.",
        });
      if (!z.email().safeParse(settings.environment.EMAIL_FROM).success)
        context.addIssue({
          code: "custom",
          path: ["environment", "EMAIL_FROM"],
          message: "SES delivery requires a valid sender email.",
        });
    }
  });
export type FargateSettings = z.infer<typeof settingsSchema>;

/** A ClickHouse Cloud endpoint, `https://<id>.<region>.<provider>.clickhouse.cloud:8443`. */
export const clickhouseCloudUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^[a-z0-9]+\.[a-z0-9-]+\.(?:aws|gcp|azure)\.clickhouse\.cloud$/.test(
        url.hostname,
      ) &&
      url.pathname === "/" &&
      !url.search &&
      !url.username
    );
  }, "Use the https ClickHouse Cloud endpoint without path or credentials.")
  .transform((value) => {
    const url = new URL(value);
    const [, region, provider] = url.hostname.split(".");
    return {
      origin: url.origin,
      provider: z.string().parse(provider),
      region: z.string().parse(region),
    };
  });

/** One Compose host behind Caddy; the stack name becomes the resource and parameter prefix. */
export const singleNodeSettingsSchema = z
  .object({
    deployment: z.literal("single-node"),
    stack: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
    hostname: hostnameSchema,
    instanceType: z
      .enum(["t4g.medium", "t4g.large", "t4g.xlarge"])
      .default("t4g.large"),
    volumeSize: z.coerce.number().int().min(40).max(1000).default(60),
    snapshotRetention: z.coerce.number().int().min(1).max(35).default(7),
    alarmEmail: z.email().optional(),
    traceStore: z.enum(["local", "clickhouse-cloud"]).default("local"),
    clickhouseCloudUrl: clickhouseCloudUrlSchema.optional(),
    /**
     * libpq options ClickHouse passes when reading PostgreSQL. `default` sends none:
     * libpq still prefers TLS and the host's pg_hba.conf accepts only TLS, but the
     * certificate is not verified. ClickHouse Cloud 26.2 rejects any explicit option.
     */
    clickhouseCloudPostgresTls: z
      .enum(["default", "require", "verify-full"])
      .default("default"),
    environment: environmentSchema.default({}),
  })
  .refine(
    (v) => v.traceStore === "local" || v.clickhouseCloudUrl !== undefined,
    {
      message: "traceStore clickhouse-cloud requires clickhouseCloudUrl.",
      path: ["clickhouseCloudUrl"],
    },
  );
export type SingleNodeSettings = z.infer<typeof singleNodeSettingsSchema>;
type Settings = FargateSettings | SingleNodeSettings;

export function readSettings(): Settings {
  const config = new pulumi.Config();
  const deployment = config.get("deployment") ?? "fargate";
  if (deployment === "single-node")
    return singleNodeSettingsSchema.parse({
      deployment,
      stack: pulumi.getStack(),
      hostname: config.require("hostname"),
      instanceType: config.get("instanceType"),
      volumeSize: config.get("volumeSize"),
      snapshotRetention: config.get("snapshotRetention"),
      alarmEmail: config.get("alarmEmail"),
      traceStore: config.get("traceStore"),
      clickhouseCloudUrl: config.get("clickhouseCloudUrl"),
      clickhouseCloudPostgresTls: config.get("clickhouseCloudPostgresTls"),
      environment: config.getObject<unknown>("environment"),
    });
  return settingsSchema.parse({
    deployment,
    stack: pulumi.getStack(),
    hostname: config.require("hostname"),
    databaseInstanceClass: config.get("databaseInstanceClass"),
    hostedZoneId: config.get("hostedZoneId"),
    certificateArn: config.get("certificateArn"),
    githubRepository: config.require("githubRepository"),
    githubOidcProviderArn: config.require("githubOidcProviderArn"),
    alarmEmail: config.get("alarmEmail"),
    sesIdentityArn: config.get("sesIdentityArn"),
    environment: config.getObject<unknown>("environment"),
  });
}

export function readSecrets() {
  const config = new pulumi.Config();
  const additionalKeys = Object.keys(
    applicationSecretsSchema.parse(
      config.getObject<unknown>("applicationSecrets") ?? {},
    ),
  );
  return {
    masterPassword: config
      .requireSecret("databaseMigrationPassword")
      .apply((value) =>
        z
          .string()
          .regex(/^[^\s"@/]{16,128}$/)
          .parse(value),
      ),
    appPassword: config.requireSecret("databaseAppPassword"),
    authSecret: config.requireSecret("betterAuthSecret"),
    traceControlPassword: config.requireSecret("databaseTraceControlPassword"),
    clickhouseAdminPassword: config
      .requireSecret("clickhouseAdminPassword")
      .apply((value) =>
        z
          .string()
          .min(16)
          .regex(/^[^\r\n]+$/)
          .parse(value),
      ),
    clickhouseWriterPassword: config.requireSecret("clickhouseWriterPassword"),
    clickhouseAccessPassword: config.requireSecret("clickhouseAccessPassword"),
    clickhouseReaderSecret: config
      .requireSecret("clickhouseReaderSecret")
      .apply((value) => z.string().min(32).parse(value)),
    /** ClickHouse Cloud issues this password for `default`; present only for the cloud trace store. */
    clickhouseCloudPassword: config
      .getSecret("clickhouseCloudPassword")
      ?.apply((value) =>
        z
          .string()
          .min(8)
          .regex(/^[^'\r\n]+$/)
          .parse(value),
      ),
    additional: (
      config.getSecretObject<Record<string, string>>("applicationSecrets") ??
      pulumi.secret<Record<string, string>>({})
    ).apply((value) => applicationSecretsSchema.parse(value)),
    /** Key names only, so per-key parameters exist at preview time without revealing values. */
    additionalKeys,
  };
}
export type Secrets = ReturnType<typeof readSecrets>;
