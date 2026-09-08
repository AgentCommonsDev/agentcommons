import { setTimeout } from "node:timers/promises";
import { createTraceClient } from "./client.js";
import { z } from "zod";
import { clickHouseEnvironment } from "./config.js";
import { migrateTraces } from "./migrate.js";

try {
  const runtime = clickHouseEnvironment(process.env);
  const migration = z
    .object({
      CLICKHOUSE_MIGRATION_USER: z.string().min(1),
      CLICKHOUSE_MIGRATION_PASSWORD: z.string().min(1),
      DATABASE_TRACE_CONTROL_URL: z.url(),
      CLICKHOUSE_POSTGRES_HOST: z.string().min(1).optional(),
      CLICKHOUSE_POSTGRES_PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional(),
    })
    .parse(process.env);
  const control = new URL(migration.DATABASE_TRACE_CONTROL_URL);
  if (migration.CLICKHOUSE_POSTGRES_HOST)
    control.hostname = migration.CLICKHOUSE_POSTGRES_HOST;
  if (migration.CLICKHOUSE_POSTGRES_PORT)
    control.port = String(migration.CLICKHOUSE_POSTGRES_PORT);
  const readiness = createTraceClient({
    url: runtime.url,
    username: migration.CLICKHOUSE_MIGRATION_USER,
    password: migration.CLICKHOUSE_MIGRATION_PASSWORD,
    request_timeout: 1000,
  });
  try {
    const deadline = Date.now() + 300_000;
    while (!(await readiness.ping()).success) {
      if (Date.now() >= deadline)
        throw new Error("ClickHouse readiness deadline exceeded.");
      await setTimeout(1000);
    }
  } finally {
    await readiness.close();
  }
  await migrateTraces({
    url: runtime.url,
    database: runtime.database,
    username: migration.CLICKHOUSE_MIGRATION_USER,
    password: migration.CLICKHOUSE_MIGRATION_PASSWORD,
    writerUsername: runtime.username,
    writerPassword: runtime.password,
    accessUsername: runtime.accessUsername,
    accessPassword: runtime.accessPassword,
    postgresControlUrl: control.toString(),
  });
  process.stdout.write("ClickHouse schema migration completed.\n");
} catch {
  // Native migration errors may quote DDL containing role passwords.
  process.stderr.write(
    "ClickHouse schema migration failed. Verify its configuration and database connectivity.\n",
  );
  process.exitCode = 1;
}
