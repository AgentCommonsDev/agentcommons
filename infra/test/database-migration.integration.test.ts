// @req R-INF-11
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { PrismaClient } from "../../packages/db/src/index.js";
import {
  startTlsPostgres,
  TLS_ROLE_PASSWORD,
} from "../../packages/traces/test/postgres-tls.js";
import { cleanup } from "../../scripts/cleanup.js";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const script = join(repository, "scripts", "self-host", "migrate-database.sh");

function run(args: string[]) {
  // Both containers publish on the loopback interface; the tool containers share the
  // host network to reach them, where the real host uses the stack's Compose network.
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      AGENTCOMMONS_DOCKER_NETWORK: "host",
    },
  });
}
/** `pnpm db:migrate`'s PostgreSQL half against one server's URLs. */
function migrate(environment: Record<string, string>) {
  return promisify(execFile)("pnpm", ["migrate"], {
    cwd: join(repository, "packages", "db"),
    env: { ...process.env, ...environment },
    timeout: 120_000,
  });
}

// The runbook's copy step (ADR 0063): a migrated database whose owner is `agentcommons`
// (the bundled container's POSTGRES_USER) moves into an empty database owned by a
// non-superuser `agentcommons`, the way Aurora's master user owns its database; both
// servers enforce TLS, and `pnpm db:migrate` then finds nothing left to apply.
it("copies roles, schemas and rows into an empty TLS-only PostgreSQL, passes the migration check and refuses a populated target", async () => {
  const release: Array<() => Promise<unknown>> = [];
  try {
    const source = await startTlsPostgres();
    release.unshift(() => source.stop());
    const seeded = await migrate(source.environment);
    expect(seeded.stdout).toContain("migrations");
    const target = await startTlsPostgres();
    release.unshift(() => target.stop());
    const work = mkdtempSync(join(tmpdir(), "agentcommons-database-copy-"));
    release.unshift(() => {
      rmSync(work, { recursive: true, force: true });
      return Promise.resolve();
    });
    const urls = [
      "--source",
      source.environment.DATABASE_MIGRATION_URL,
      "--target",
      target.environment.DATABASE_MIGRATION_URL,
    ];
    const copy = run(["copy", ...urls, "--work", work]);
    expect(copy.status, copy.stderr).toBe(0);
    expect(copy.stdout).toContain("Row counts match");
    expect(copy.stdout).toContain(`Copy complete; the dump stays in ${work}`);
    const roles = readFileSync(join(work, "roles.sql"), "utf8");
    expect(roles).toMatch(
      /^CREATE ROLE ac_app LOGIN NOINHERIT NOCREATEROLE NOCREATEDB;$/m,
    );
    expect(roles).toMatch(
      /^CREATE ROLE ac_trace_control LOGIN NOINHERIT NOCREATEROLE NOCREATEDB;$/m,
    );
    expect(roles).toMatch(
      /^ALTER ROLE ac_trace_control SET default_transaction_read_only = 'on';$/m,
    );
    expect(roles).toMatch(
      /^ALTER ROLE ac_trace_control SET statement_timeout = '5s';$/m,
    );
    // No password hashes (db:migrate sets them), no superuser-only attributes, and the
    // owner role is never copied.
    expect(roles).not.toMatch(/PASSWORD|SUPERUSER|REPLICATION|BYPASSRLS/);
    expect(roles).not.toMatch(/ROLE agentcommons\b/);
    // libpq refuses the node-postgres flag, so the tools never see it.
    expect(readFileSync(join(work, "urls.env"), "utf8")).not.toContain(
      "uselibpqcompat",
    );
    expect(readFileSync(join(work, "counts.source"), "utf8")).toMatch(
      /^pgboss\.queue \d+$/m,
    );

    const check = await migrate(target.environment);
    expect(check.stdout).toContain("No pending migrations");
    const verify = run(["verify", ...urls]);
    expect(verify.status, verify.stderr).toBe(0);
    expect(verify.stdout).toContain("Row counts match");

    // The application role answers over TLS with its copied grants and settings.
    const app = new PrismaClient({
      datasources: { db: { url: target.url("ac_app", TLS_ROLE_PASSWORD) } },
    });
    release.unshift(() => app.$disconnect());
    const [queues] = await app.$queryRawUnsafe<{ n: string }[]>(
      "SELECT count(*)::text AS n FROM pgboss.queue",
    );
    expect(Number(queues?.n)).toBeGreaterThan(0);
    const [control] = await app.$queryRawUnsafe<{ rolconfig: string[] }[]>(
      "SELECT rolconfig FROM pg_roles WHERE rolname = 'ac_trace_control'",
    );
    expect(control?.rolconfig).toEqual(
      expect.arrayContaining([
        "default_transaction_read_only=on",
        "search_path=trace_control",
      ]),
    );
    const again = run(["copy", ...urls, "--work", `${work}-again`]);
    release.unshift(() => {
      rmSync(`${work}-again`, { recursive: true, force: true });
      return Promise.resolve();
    });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("already holds");
  } finally {
    expect(await cleanup(release)).toEqual([]);
  }
}, 300_000);
