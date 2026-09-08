import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { cleanup } from "../../../scripts/cleanup.js";
import { provisionOrganization } from "../../../apps/api/test/support.js";
import { requireCaller } from "../../../apps/api/src/services/context.js";
import { startTraceDatabase, traceEnvironment } from "./support.js";
import { TraceFixtures } from "./fixtures.js";

// @req R-INF-01
it("runs the native migration CLI repeatedly without erasing published traces or losing restricted reader access", async () => {
  const release: Array<() => Promise<unknown>> = [];
  try {
    const db = await startTraceDatabase();
    release.unshift(() => db.close());
    const fixtures = new TraceFixtures(db);
    release.unshift(() => fixtures.close());
    const org = await provisionOrganization(db, "migration-cli");
    const caller = requireCaller(org.context);
    const installationId = randomUUID();
    await db.prisma.installation.create({
      data: {
        organizationId: caller.organizationId,
        id: installationId,
        hostname: "migration-fixture",
        osUser: "fixture",
        platform: "linux",
        arch: "x64",
      },
    });
    const sessionId = await fixtures.session({
      organizationId: caller.organizationId,
      userId: caller.userId,
      keyId: caller.apiKeyId ?? "",
      installationId,
      fields: { title: "Preserved across native migration", message_count: 0 },
    });
    const environment = {
      PATH: process.env.PATH,
      ...traceEnvironment(db.traceConfig),
      DATABASE_TRACE_CONTROL_URL: db.urls.traceControl,
      CLICKHOUSE_POSTGRES_HOST: "host.docker.internal",
      CLICKHOUSE_MIGRATION_USER: db.traceMigration.username,
      CLICKHOUSE_MIGRATION_PASSWORD: db.traceMigration.password,
    };
    for (let pass = 0; pass < 2; pass++) {
      const result = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "packages/traces/src/migrate-cli.ts"],
        {
          cwd: fileURLToPath(new URL("../../../", import.meta.url)),
          env: environment,
          timeout: 60_000,
        },
      );
      expect(result.stdout.trim()).toBe(
        "ClickHouse schema migration completed.",
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(db.traceMigration.password);
      const visible = await db.traceReaders.read(caller, (client) =>
        client.query(
          "SELECT session_id,title FROM api_ro.sessions WHERE session_id={id:UUID}",
          { id: sessionId },
        ),
      );
      expect(visible.rows).toEqual([
        { session_id: sessionId, title: "Preserved across native migration" },
      ]);
    }
  } finally {
    expect(await cleanup(release)).toEqual([]);
  }
}, 120_000);
