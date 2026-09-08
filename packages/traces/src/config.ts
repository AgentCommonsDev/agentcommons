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

/** Shared runtime/migration environment boundary; no fallback database or credentials. */
export function clickHouseEnvironment(
  environment: Record<string, string | undefined>,
): ClickHouseConfig {
  return clickHouseConfigSchema.parse({
    url: environment.CLICKHOUSE_URL,
    database: environment.CLICKHOUSE_DATABASE,
    username: environment.CLICKHOUSE_WRITER_USER,
    password: environment.CLICKHOUSE_WRITER_PASSWORD,
    accessUsername: environment.CLICKHOUSE_ACCESS_USER,
    accessPassword: environment.CLICKHOUSE_ACCESS_PASSWORD,
    readerSecret: environment.CLICKHOUSE_READER_SECRET,
  });
}
