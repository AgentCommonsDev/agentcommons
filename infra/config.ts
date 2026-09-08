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

export const settingsSchema = z
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
    sesIdentityArn: config.get("sesIdentityArn"),
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
    additional: (
      config.getSecretObject<Record<string, string>>("applicationSecrets") ??
      pulumi.secret<Record<string, string>>({})
    ).apply((value) => applicationSecretsSchema.parse(value)),
  };
}
