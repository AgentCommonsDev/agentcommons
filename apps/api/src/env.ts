import { clickHouseEnvironment } from "@agentcommons/traces";
import { emailTransportSchema } from "./auth/mail.js";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  calendarUrlSchema,
  defaultBillingConfig,
  instanceModeSchema,
} from "@agentcommons/core";
import { authEnvironment, publicUrlSchema } from "./auth/environment.js";

const boolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
export function environment(runtimeEnv: NodeJS.ProcessEnv = process.env) {
  const env = createEnv({
    server: {
      PUBLIC_URL: publicUrlSchema,
      DATABASE_URL: z.url(),
      BETTER_AUTH_SECRET: z.string().min(32),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      HOST: z.string().default("0.0.0.0"),
      INSTANCE_MODE: instanceModeSchema.default(defaultBillingConfig.mode),
      FREE_MONTHLY_RECORDS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .default(defaultBillingConfig.plans.free.monthly_records),
      PRO_INCLUDED_RECORDS: z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .default(defaultBillingConfig.plans.pro.included_records),
      CAPTURE_CENTS_PER_1000: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(1_000_000)
        .optional(),
      EMBEDDING_CENTS_PER_1000: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(1_000_000)
        .optional(),
      STRIPE_CAPTURE_EVENT_NAME: z.string().min(1).max(100).optional(),
      STRIPE_EMBEDDING_EVENT_NAME: z.string().min(1).max(100).optional(),
      CAL_COM_URL: calendarUrlSchema.optional(),
      TRUST_PROXY: z
        .string()
        .default("127.0.0.1/8,::1/128")
        .transform((value) =>
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      EMAIL_TRANSPORT: emailTransportSchema.default("none"),
      AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
      EMBEDDINGS_ENABLED: boolean.default(false),
      EMBEDDINGS_PROVIDER: z.enum(["openai", "fake"]).default("openai"),
      EMBEDDINGS_MODEL: z
        .literal("text-embedding-3-small")
        .default("text-embedding-3-small"),
      EMBEDDINGS_DIMENSIONS: z.coerce
        .number()
        .pipe(z.literal(1024))
        .default(1024),
      EMBEDDINGS_DAILY_TOKEN_BUDGET: z.coerce
        .number()
        .int()
        .positive()
        .default(5_000_000),
      OPENAI_API_KEY: z.string().optional(),
      SEARCH_CONTEXT_DEFAULT: z.coerce.number().int().min(0).max(3).default(1),
      SEARCH_LIMIT_DEFAULT: z.coerce.number().int().min(1).max(50).default(5),
      REDACTION_EXTRA_PATTERNS: z.string().default("[]"),
      LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
  if (
    env.EMBEDDINGS_ENABLED &&
    env.EMBEDDINGS_PROVIDER === "openai" &&
    !env.OPENAI_API_KEY
  )
    throw new Error(
      "OPENAI_API_KEY is required when OpenAI embeddings are enabled.",
    );
  if (env.PRO_INCLUDED_RECORDS < env.FREE_MONTHLY_RECORDS)
    throw new Error(
      "PRO_INCLUDED_RECORDS must be at least FREE_MONTHLY_RECORDS.",
    );
  return {
    ...env,
    auth: authEnvironment(runtimeEnv).auth,
    clickhouse: clickHouseEnvironment(runtimeEnv),
    billing: {
      mode: env.INSTANCE_MODE,
      freeMonthlyRecords: env.FREE_MONTHLY_RECORDS,
      proIncludedRecords: env.PRO_INCLUDED_RECORDS,
      calComUrl: env.CAL_COM_URL ?? null,
      captureCentsPer1000: env.CAPTURE_CENTS_PER_1000 ?? null,
      embeddingCentsPer1000: env.EMBEDDING_CENTS_PER_1000 ?? null,
      captureEventName: env.STRIPE_CAPTURE_EVENT_NAME ?? null,
      embeddingEventName: env.STRIPE_EMBEDDING_EVENT_NAME ?? null,
    },
  };
}
export type Env = ReturnType<typeof environment>;
