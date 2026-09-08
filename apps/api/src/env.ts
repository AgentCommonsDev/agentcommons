import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { authEnvironment, publicUrlSchema } from "./auth/environment.js";

const boolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
export function environment(runtimeEnv: NodeJS.ProcessEnv = process.env) {
  const env = createEnv({
    server: {
      PUBLIC_URL: publicUrlSchema,
      DATABASE_URL: z.url(),
      DATABASE_READER_USER_URL: z.url(),
      DATABASE_READER_ADMIN_URL: z.url(),
      BETTER_AUTH_SECRET: z.string().min(32),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      HOST: z.string().default("0.0.0.0"),
      INSTANCE_MODE: z.enum(["customer", "public"]).default("customer"),
      TRUST_PROXY: z
        .string()
        .default("127.0.0.1/8,::1/128")
        .transform((value) =>
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      EMAIL_TRANSPORT: z.literal("none").default("none"),
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
  return { ...env, auth: authEnvironment(runtimeEnv).auth };
}
export type Env = ReturnType<typeof environment>;
