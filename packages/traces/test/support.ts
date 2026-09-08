import { setTimeout } from "node:timers/promises";
import type { PrismaClient } from "@agentcommons/db";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import { startDatabase } from "../../../apps/api/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import {
  migrateTraces,
  CLICKHOUSE_IMAGE,
  TraceReaders,
  TraceRepository,
  type ClickHouseConfig,
} from "../src/index.js";

export async function startTraceDatabase(
  authConfiguration?: Parameters<typeof startDatabase>[0],
) {
  const release: Array<() => Promise<unknown>> = [];
  try {
    const db = await startDatabase(authConfiguration);
    release.unshift(() => db.close());
    const container = await new GenericContainer(CLICKHOUSE_IMAGE)
      .withCopyFilesToContainer([
        {
          source: fileURLToPath(
            new URL("../config/privacy.xml", import.meta.url),
          ),
          target: "/etc/clickhouse-server/config.d/privacy.xml",
        },
      ])
      .withEnvironment({
        CLICKHOUSE_PASSWORD: "native-clickhouse-integration-password",
        CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
      })
      .withExposedPorts(8123)
      .withExtraHosts([
        { host: "host.docker.internal", ipAddress: "host-gateway" },
      ])
      .withResourcesQuota({ memory: 4 * 1024 * 1024 * 1024, cpu: 4 })
      .withWaitStrategy(Wait.forHttp("/ping", 8123))
      .start();
    release.unshift(() => container.stop());
    const url = `http://${container.getHost()}:${String(container.getMappedPort(8123))}`;
    const postgresControlUrl = new URL(db.urls.traceControl);
    postgresControlUrl.hostname = "host.docker.internal";
    const config: ClickHouseConfig = {
      url,
      database: "ac_trace",
      username: "ac_trace_writer",
      password: "native-trace-writer-test-password",
      readerSecret: "native-reader-secret-long-enough-for-tests-only",
      accessUsername: "ac_trace_access",
      accessPassword: "native-trace-access-test-password",
    };
    const migration = {
      url,
      username: "default",
      password: "native-clickhouse-integration-password",
      database: config.database,
      writerUsername: config.username,
      writerPassword: config.password,
      accessUsername: config.accessUsername,
      accessPassword: config.accessPassword,
      postgresControlUrl: postgresControlUrl.toString(),
    };
    await migrateTraces(migration);
    const traces = new TraceRepository(config);
    release.unshift(() => traces.close());
    const readers = new TraceReaders(config, db.prisma, { embeddings: true });
    release.unshift(() => readers.close());
    return {
      ...db,
      traces,
      traceReaders: readers,
      traceConfig: config,
      traceMigration: migration,
      traceContainer: container,
      async close() {
        const errors = await cleanup(release.splice(0));
        if (errors.length)
          throw new AggregateError(errors, "Trace database cleanup failed.");
      },
    };
  } catch (error) {
    const errors = await cleanup(release.splice(0));
    if (errors.length)
      throw new AggregateError(
        [error, ...errors],
        "Trace database setup failed.",
        { cause: error },
      );
    throw error;
  }
}

/** The actual runtime boundary for native dual-store integration fixtures. */
export function traceEnvironment(
  config: ClickHouseConfig,
): Record<string, string> {
  return {
    CLICKHOUSE_URL: config.url,
    CLICKHOUSE_DATABASE: config.database,
    CLICKHOUSE_WRITER_USER: config.username,
    CLICKHOUSE_WRITER_PASSWORD: config.password,
    CLICKHOUSE_ACCESS_USER: config.accessUsername,
    CLICKHOUSE_ACCESS_PASSWORD: config.accessPassword,
    CLICKHOUSE_READER_SECRET: config.readerSecret,
  };
}

/** Await accepted revisions becoming visible; callers start the actual worker separately. */
export async function waitForTracePublication(
  prisma: PrismaClient,
  sessionIds: readonly string[],
  options: { allowPurged?: boolean; timeoutMs?: number } = {},
) {
  const ids = [...new Set(sessionIds)];
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessions = await prisma.traceSessionControl.findMany({
      where: { id: { in: ids } },
      select: {
        purgedAt: true,
        projectionState: true,
        acceptedRevision: true,
        publishedRevision: true,
      },
    });
    if (
      sessions.length === ids.length &&
      sessions.every(
        (session) =>
          (options.allowPurged && session.purgedAt !== null) ||
          (session.projectionState === "published" &&
            session.acceptedRevision === session.publishedRevision),
      )
    )
      return;
    await setTimeout(50);
  }
  const states = await prisma.traceSessionControl.groupBy({
    by: ["projectionState"],
    where: { id: { in: ids } },
    _count: true,
  });
  const pending = await prisma.traceSessionControl.findMany({
    where: { id: { in: ids }, projectionState: { not: "published" } },
    select: {
      projectionState: true,
      acceptedRevision: true,
      publishedRevision: true,
    },
    take: 5,
  });
  throw new Error(
    `Accepted native traces were not published within ${String(timeoutMs)} milliseconds: ${JSON.stringify({ expected: ids.length, states, pending }, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value))}.`,
  );
}
