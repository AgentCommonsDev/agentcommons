import {
  clickHouseEnvironment,
  EMBEDDING_DIMENSIONS,
} from "@agentcommons/traces";
import { emailTransportSchema } from "./auth/mail.js";
import { EMBEDDING_MODEL } from "./embeddings/provider.js";
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
/** Which embedding provider main.ts instantiates, with the credential it needs. */
type EmbeddingProviderConfiguration =
  { name: "fake" } | { name: "openai"; apiKey: string };
function embeddingProviderConfiguration(env: {
  EMBEDDINGS_ENABLED: boolean;
  EMBEDDINGS_PROVIDER: "openai" | "fake";
  OPENAI_API_KEY?: string | undefined;
}): EmbeddingProviderConfiguration | null {
  if (!env.EMBEDDINGS_ENABLED) return null;
  if (env.EMBEDDINGS_PROVIDER === "fake") return { name: "fake" };
  if (!env.OPENAI_API_KEY)
    throw new Error(
      "OPENAI_API_KEY is required when OpenAI embeddings are enabled.",
    );
  return { name: "openai", apiKey: env.OPENAI_API_KEY };
}
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
      // Identical MCP handshakes from one key and client write one audit row per window
      // (§8.1, ADR 0073); 0 writes every handshake.
      MCP_HANDSHAKE_WINDOW_SECONDS: z.coerce
        .number()
        .int()
        .min(0)
        .max(86_400)
        .default(300),
      EMBEDDINGS_ENABLED: boolean.default(false),
      EMBEDDINGS_PROVIDER: z.enum(["openai", "fake"]).default("openai"),
      // Both values are fixed by the deployment (§11); the variables exist so a
      // mismatched operator configuration fails at boot instead of at first use.
      EMBEDDINGS_MODEL: z.literal(EMBEDDING_MODEL).default(EMBEDDING_MODEL),
      EMBEDDINGS_DIMENSIONS: z.coerce
        .number()
        .pipe(z.literal(EMBEDDING_DIMENSIONS))
        .default(EMBEDDING_DIMENSIONS),
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
      // Baked into the published image by the release workflow (ADR 0059); the host's
      // updater reads AUTO_UPDATE from the same .env, and Admin → Status reports both.
      AGENTCOMMONS_VERSION: z.string().min(1).max(100).default("development"),
      AUTO_UPDATE: boolean.default(true),
      // The host updater's state file, visible inside the container only when
      // docker-compose.updater.yml mounts its directory; Admin → Status reports it.
      UPDATE_STATE_FILE: z
        .string()
        .min(1)
        .default("/var/lib/agentcommons/update-state"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
  const embeddingProvider = embeddingProviderConfiguration(env);
  if (env.PRO_INCLUDED_RECORDS < env.FREE_MONTHLY_RECORDS)
    throw new Error(
      "PRO_INCLUDED_RECORDS must be at least FREE_MONTHLY_RECORDS.",
    );
  return {
    ...env,
    saas: env.INSTANCE_MODE === "saas",
    server: {
      version: env.AGENTCOMMONS_VERSION,
      autoUpdate: env.AUTO_UPDATE,
      updateStateFile: env.UPDATE_STATE_FILE,
    },
    embeddingProvider,
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
