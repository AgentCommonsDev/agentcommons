import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";

export const applicationSecretsSchema = z.record(
  z.string().regex(/^(?:AUTH_[A-Z0-9_]+_CLIENT_(?:ID|SECRET)|OPENAI_API_KEY)$/),
  z.string(),
);
export const environmentSchema = z.record(
  z
    .string()
    .regex(
      /^(?!DATABASE_|POSTGRES_|BETTER_AUTH_SECRET$)(?!.*(?:_SECRET|_KEY|_PASSWORD)$)[A-Z][A-Z0-9_]*$/,
    ),
  z.string(),
);

const settingsSchema = z
  .object({
    stack: z.enum(["dev", "prod"]),
    hostname: z
      .string()
      .regex(
        /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      ),
    databaseInstanceClass: z.enum(["db.t4g.micro", "db.t4g.small"]).optional(),
    hostedZoneId: z.string().min(1).optional(),
    certificateArn: z.string().startsWith("arn:aws:acm:").optional(),
    githubRepository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    githubOidcProviderArn: z.string().startsWith("arn:aws:iam:"),
    alarmEmail: z.email().optional(),
    environment: environmentSchema.default({}),
  })
  .refine(
    (v) => v.hostedZoneId !== undefined || v.certificateArn !== undefined,
    {
      message:
        "Provide hostedZoneId for managed ACM validation or an issued certificateArn.",
    },
  );
type Settings = z.infer<typeof settingsSchema>;
export function readSettings(): Settings {
  const config = new pulumi.Config();
  return settingsSchema.parse({
    stack: pulumi.getStack(),
    hostname: config.require("hostname"),
    databaseInstanceClass: config.get("databaseInstanceClass"),
    hostedZoneId: config.get("hostedZoneId"),
    certificateArn: config.get("certificateArn"),
    githubRepository: config.require("githubRepository"),
    githubOidcProviderArn: config.require("githubOidcProviderArn"),
    alarmEmail: config.get("alarmEmail"),
    environment: config.getObject<unknown>("environment"),
  });
}

export function readSecrets() {
  const config = new pulumi.Config();
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
    userPassword: config.requireSecret("databaseReaderUserPassword"),
    adminPassword: config.requireSecret("databaseReaderAdminPassword"),
    authSecret: config.requireSecret("betterAuthSecret"),
    additional: (
      config.getSecretObject<Record<string, string>>("applicationSecrets") ??
      pulumi.secret<Record<string, string>>({})
    ).apply((value) => applicationSecretsSchema.parse(value)),
  };
}
