import { z } from "zod";
export const clickHouseConfigSchema = z.object({
  url: z.url(),
  database: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .default("ac_trace"),
  username: z.string().min(1),
  password: z.string().min(1),
  readerSecret: z.string().min(32),
  accessUsername: z.string().min(1),
  accessPassword: z.string().min(1),
  /**
   * Memory one reader query may use, in MiB (§7.5, ADR 0100). The default fits the smallest
   * supported host; a deployment sizes it with its ClickHouse container.
   */
  readerMemoryMb: z.coerce.number().int().min(64).max(65536).default(256),
});
export type ClickHouseConfig = z.infer<typeof clickHouseConfigSchema>;
export interface TraceMigrationConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  writerUsername: string;
  writerPassword: string;
  accessUsername: string;
  accessPassword: string;
  postgresControlUrl: string;
}

/** Environment variable per ClickHouse setting; the runtime reads them and test fixtures write them. */
export const clickHouseEnvironmentKeys = {
  url: "CLICKHOUSE_URL",
  database: "CLICKHOUSE_DATABASE",
  username: "CLICKHOUSE_WRITER_USER",
  password: "CLICKHOUSE_WRITER_PASSWORD",
  readerSecret: "CLICKHOUSE_READER_SECRET",
  accessUsername: "CLICKHOUSE_ACCESS_USER",
  accessPassword: "CLICKHOUSE_ACCESS_PASSWORD",
  readerMemoryMb: "CLICKHOUSE_READER_MEMORY_MB",
} as const satisfies Record<keyof ClickHouseConfig, string>;

/** Shared runtime/migration environment boundary; no fallback database or credentials. */
export function clickHouseEnvironment(
  environment: Record<string, string | undefined>,
): ClickHouseConfig {
  return clickHouseConfigSchema.parse(
    Object.fromEntries(
      clickHouseConfigSchema
        .keyof()
        .options.map((setting) => [
          setting,
          environment[clickHouseEnvironmentKeys[setting]],
        ]),
    ),
  );
}
