import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  copyFile,
  symlink,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { PrismaClient } from "@agentcommons/db";
import { expect, it } from "vitest";
import { releaser } from "./support.js";

it("runs documented migration and bootstrap commands using only an unexported root .env", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const workspace = await mkdtemp(join(tmpdir(), "agentcommons-setup-review-"));
  const { defer, release } = releaser();
  defer(() => rm(workspace, { recursive: true, force: true }));
  const errors: unknown[] = [];
  try {
    const database = await startTraceDatabase();
    defer(() => database.close());
    for (const file of ["package.json", "pnpm-workspace.yaml"]) {
      await copyFile(join(root, file), join(workspace, file));
    }
    await symlink(join(root, "node_modules"), join(workspace, "node_modules"));
    for (const directory of ["packages/db", "packages/traces", "apps/api"]) {
      await mkdir(join(workspace, directory), { recursive: true });
      await copyFile(
        join(root, directory, "package.json"),
        join(workspace, directory, "package.json"),
      );
      for (const linked of ["src", "node_modules"]) {
        await symlink(
          join(root, directory, linked),
          join(workspace, directory, linked),
        );
      }
    }
    const values = {
      DATABASE_MIGRATION_URL: database.urls.migration,
      DATABASE_URL: database.urls.app,
      DATABASE_TRACE_CONTROL_URL: database.urls.traceControl,
      ...traceEnvironment(database.traceConfig),
      CLICKHOUSE_MIGRATION_USER: database.traceMigration.username,
      CLICKHOUSE_MIGRATION_PASSWORD: database.traceMigration.password,
      CLICKHOUSE_POSTGRES_HOST: new URL(
        database.traceMigration.postgresControlUrl,
      ).hostname,
      PUBLIC_URL: "http://localhost:5173",
      BETTER_AUTH_SECRET:
        "local-development-setup-secret-at-least-32-characters",
      AUTH_EMAIL_PASSWORD_ENABLED: "true",
      AUTH_SIGNUP_MODE: "invite",
    };
    await writeFile(
      join(workspace, ".env"),
      Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n"),
      { mode: 0o600 },
    );
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !name.startsWith("DATABASE_") &&
          !name.startsWith("CLICKHOUSE_") &&
          !name.startsWith("AUTH_") &&
          name !== "PUBLIC_URL" &&
          name !== "BETTER_AUTH_SECRET",
      ),
    );
    await promisify(execFile)("pnpm", ["db:migrate"], {
      cwd: workspace,
      env: environment,
      timeout: 90_000,
    });
    await promisify(execFile)(
      "pnpm",
      ["db:seed", "--admin", "setup-review@example.com"],
      { cwd: workspace, env: environment, timeout: 90_000 },
    );
    const prisma = new PrismaClient({ datasourceUrl: values.DATABASE_URL });
    defer(() => prisma.$disconnect());
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "setup-review@example.com" },
    });
    expect(user.email).toBe("setup-review@example.com");
    expect(
      await prisma.member.findFirst({
        where: { userId: user.id, role: "owner" },
      }),
    ).not.toBeNull();
    expect(await prisma.redactionPolicy.count()).toBeGreaterThan(0);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Development setup or cleanup failed");
}, 120_000);
