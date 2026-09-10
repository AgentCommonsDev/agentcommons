// @req R-INF-11
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { cleanup } from "../../../scripts/cleanup.js";
import { PrismaClient } from "../../db/src/index.js";
import { createTraceClient } from "../src/client.js";
import { migrateTraces, type ClickHouseConfig } from "../src/index.js";
import {
  startTlsPostgres,
  TLS_QUERY,
  TLS_ROLE_PASSWORD,
} from "./postgres-tls.js";
import {
  CLICKHOUSE_TEST_ADMIN_PASSWORD,
  startClickHouse,
  traceEnvironment,
} from "./support.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));

// The single-node stack renders these URLs for a managed PostgreSQL such as Aurora
// (ADR 0063): `sslmode=require` for Prisma and ClickHouse, `uselibpqcompat=true` so
// node-postgres (pg-boss, the migration) follows libpq instead of verifying the server
// certificate against Node's store. The server here enforces TLS like Aurora's
// `rds.force_ssl=1` and its owner is not a superuser, like Aurora's master user.
it("bootstraps the control plane on a TLS-only PostgreSQL owned by a non-superuser and lets ClickHouse read its control tables and dictionaries over TLS", async () => {
  const release: Array<() => Promise<unknown>> = [];
  try {
    const postgres = await startTlsPostgres();
    release.unshift(() => postgres.stop());
    // prisma migrate deploy, pg-boss and the role grants all connect with the TLS URLs.
    const bootstrap = await promisify(execFile)("pnpm", ["migrate"], {
      cwd: new URL("../../db/", import.meta.url),
      env: { ...process.env, ...postgres.environment },
      timeout: 120_000,
    });
    expect(bootstrap.stdout).toContain("migrations");

    const clickhouse = await startClickHouse();
    release.unshift(() => clickhouse.stop());
    const config: ClickHouseConfig = {
      url: clickhouse.url,
      database: "ac_trace",
      username: "ac_trace_writer",
      password: "native-trace-writer-test-password",
      readerSecret: "native-reader-secret-long-enough-for-tests-only",
      accessUsername: "ac_trace_access",
      accessPassword: "native-trace-access-test-password",
    };
    await migrateTraces({
      url: config.url,
      username: "default",
      password: CLICKHOUSE_TEST_ADMIN_PASSWORD,
      database: config.database,
      writerUsername: config.username,
      writerPassword: config.password,
      accessUsername: config.accessUsername,
      accessPassword: config.accessPassword,
      postgresControlUrl: postgres.url(
        "ac_trace_control",
        TLS_ROLE_PASSWORD,
        "container",
      ),
    });
    const admin = createTraceClient({
      url: config.url,
      username: "default",
      password: CLICKHOUSE_TEST_ADMIN_PASSWORD,
    });
    release.unshift(() => admin.close());
    const rows = async <T>(query: string) =>
      (await admin.query({ query, format: "JSONEachRow" })).json<T>();
    // The engine table and the direct dictionary both carry the TLS option and answer.
    const [engine] = await rows<{ statement: string }>(
      "SHOW CREATE TABLE ac_trace.control_session_scope",
    );
    expect(engine?.statement).toMatch(/sslmode\s*=\s*'require'/);
    expect(engine?.statement).not.toContain("uselibpqcompat");
    expect(
      await rows<{ n: number }>(
        "SELECT count() AS n FROM ac_trace.control_session_scope",
      ),
    ).toEqual([{ n: 0 }]);
    expect(
      await rows<{ purged: number }>(
        "SELECT dictGet('ac_trace.session_scope','purged',('probe',toUUID('00000000-0000-0000-0000-000000000000'))) AS purged",
      ),
    ).toEqual([{ purged: 1 }]);
    // The migration CLI keeps the TLS option while it rewrites the host ClickHouse dials.
    const cli = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "packages/traces/src/migrate-cli.ts"],
      {
        cwd: repository,
        env: {
          PATH: process.env.PATH,
          ...traceEnvironment(config),
          DATABASE_TRACE_CONTROL_URL:
            postgres.environment.DATABASE_TRACE_CONTROL_URL,
          CLICKHOUSE_POSTGRES_HOST: "host.docker.internal",
          CLICKHOUSE_MIGRATION_USER: "default",
          CLICKHOUSE_MIGRATION_PASSWORD: CLICKHOUSE_TEST_ADMIN_PASSWORD,
        },
        timeout: 60_000,
      },
    );
    expect(cli.stdout.trim()).toBe("ClickHouse schema migration completed.");
    expect(cli.stderr).toBe("");

    // The application role works over TLS with the migrated grants, and plaintext is
    // refused, so the encryption the URLs ask for is enforced rather than optional.
    const app = new PrismaClient({
      datasources: { db: { url: postgres.environment.DATABASE_URL } },
    });
    release.unshift(() => app.$disconnect());
    const [queues] = await app.$queryRawUnsafe<{ n: string }[]>(
      "SELECT count(*)::text AS n FROM pgboss.queue",
    );
    expect(Number(queues?.n)).toBeGreaterThan(0);
    const plain = new PrismaClient({
      datasources: {
        db: {
          url: postgres.environment.DATABASE_URL.replace(
            TLS_QUERY,
            "?sslmode=disable",
          ),
        },
      },
    });
    release.unshift(() => plain.$disconnect());
    // Prisma reports the server's "no pg_hba.conf entry ... no encryption" rejection as
    // an unreachable server.
    await expect(plain.$queryRawUnsafe("SELECT 1")).rejects.toThrow(
      /Can't reach database server|no encryption|pg_hba/,
    );
  } finally {
    expect(await cleanup(release)).toEqual([]);
  }
}, 300_000);
