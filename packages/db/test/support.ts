import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { cleanup } from "../../../scripts/cleanup.js";
import { PrismaClient } from "../src/index.js";

/**
 * A migrated PostgreSQL control database in a container, with the application, migration
 * and trace-control connection URLs. Application-level fixtures layer their services on top.
 */
export async function startDatabase() {
  const container = await new PostgreSqlContainer("postgres:16").start();
  const release: Array<() => Promise<unknown>> = [() => container.stop()];
  try {
    const url = (role: string) => {
      const parsed = new URL(container.getConnectionUri());
      parsed.username = role;
      parsed.password = "test-database-password";
      return parsed.toString();
    };
    const urls = {
      app: url("ac_app"),
      migration: container.getConnectionUri(),
      traceControl: url("ac_trace_control"),
    };
    await promisify(execFile)("pnpm", ["migrate"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        DATABASE_MIGRATION_URL: urls.migration,
        DATABASE_TRACE_CONTROL_URL: urls.traceControl,
        DATABASE_URL: urls.app,
      },
    });
    const prisma = new PrismaClient({ datasources: { db: { url: urls.app } } });
    release.unshift(() => prisma.$disconnect());
    return {
      prisma,
      urls,
      async close() {
        const errors = await cleanup(release.splice(0));
        if (errors.length)
          throw new AggregateError(
            errors,
            "Integration database cleanup failed.",
          );
      },
    };
  } catch (error) {
    const errors = await cleanup(release.splice(0));
    if (errors.length)
      throw new AggregateError(
        [error, ...errors],
        "Integration database setup and cleanup failed.",
        { cause: error },
      );
    throw error;
  }
}
