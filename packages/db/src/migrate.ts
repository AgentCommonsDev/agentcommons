import { spawn } from "node:child_process";
import { Client, escapeIdentifier, escapeLiteral } from "pg";
import { z } from "zod";
import PgBoss from "pg-boss";
import { JOB_QUEUES } from "./jobs.js";

const env = z
  .object({
    DATABASE_MIGRATION_URL: z.url(),
    DATABASE_TRACE_CONTROL_URL: z.url(),
    DATABASE_URL: z.url(),
  })
  .parse(process.env);

const roles = [
  ["ac_app", env.DATABASE_URL],
  ["ac_trace_control", env.DATABASE_TRACE_CONTROL_URL],
] as const;
const migrationUrl = new URL(env.DATABASE_MIGRATION_URL);
for (const [role, connection] of roles) {
  const url = new URL(connection);
  if (
    decodeURIComponent(url.username) !== role ||
    !decodeURIComponent(url.password) ||
    url.hostname !== migrationUrl.hostname ||
    url.port !== migrationUrl.port ||
    url.pathname !== migrationUrl.pathname
  ) {
    throw new Error(
      `Database URL must identify ${role} on the migration database with a password`,
    );
  }
}
const status = await new Promise<number | null>((resolve, reject) => {
  const child = spawn("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, DATABASE_URL: env.DATABASE_MIGRATION_URL },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", resolve);
});
if (status !== 0) throw new Error("Database migration failed");

// The library owns its schema and migration version. Only this operator command
// receives the migration credential; the API starts pg-boss with migrate:false.
const jobs = new PgBoss({
  connectionString: env.DATABASE_MIGRATION_URL,
  supervise: false,
});
let jobMigrationError: unknown;
jobs.on("error", (error: unknown) => {
  jobMigrationError = error;
});
try {
  await jobs.start();
  for (const name of Object.values(JOB_QUEUES)) await jobs.createQueue(name);
} finally {
  await jobs.stop();
}
if (jobMigrationError) throw new Error("Job schema initialization failed.");

const client = new Client({ connectionString: env.DATABASE_MIGRATION_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("REVOKE ALL ON SCHEMA pgboss FROM PUBLIC");
  await client.query("REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM PUBLIC");
  await client.query(
    "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC",
  );
  await client.query("GRANT USAGE ON SCHEMA pgboss TO ac_app");
  await client.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO ac_app",
  );
  await client.query(
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO ac_app",
  );
  const database = decodeURIComponent(migrationUrl.pathname.slice(1));
  await client.query(
    `REVOKE CONNECT, TEMPORARY ON DATABASE ${escapeIdentifier(database)} FROM PUBLIC`,
  );
  for (const [role, connection] of roles) {
    const password = decodeURIComponent(new URL(connection).password);
    await client.query(
      `ALTER ROLE ${escapeIdentifier(role)} PASSWORD ${escapeLiteral(password)}`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${escapeIdentifier(database)} TO ${escapeIdentifier(role)}`,
    );
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
