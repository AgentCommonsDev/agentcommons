import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
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
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@agentcommons/db";
import { expect, it } from "vitest";

it("runs documented migration and bootstrap commands using only an unexported root .env", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const workspace = await mkdtemp(join(tmpdir(), "agentcommons-setup-review-"));
  const cleanup: (() => Promise<unknown>)[] = [
    () => rm(workspace, { recursive: true, force: true }),
  ];
  const errors: unknown[] = [];
  try {
    const container = await new PostgreSqlContainer(
      "pgvector/pgvector:pg16",
    ).start();
    cleanup.push(() => container.stop());
    for (const file of ["package.json", "pnpm-workspace.yaml"]) {
      await copyFile(join(root, file), join(workspace, file));
    }
    await symlink(join(root, "node_modules"), join(workspace, "node_modules"));
    for (const directory of ["packages/db", "apps/api"]) {
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
    const roleUrl = (role: string) => {
      const url = new URL(container.getConnectionUri());
      url.username = role;
      url.password = "local-setup-test-password";
      return url.toString();
    };
    const values = {
      DATABASE_MIGRATION_URL: container.getConnectionUri(),
      DATABASE_URL: roleUrl("ac_app"),
      DATABASE_READER_USER_URL: roleUrl("ac_reader_user"),
      DATABASE_READER_ADMIN_URL: roleUrl("ac_reader_admin"),
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
    cleanup.push(() => prisma.$disconnect());
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
    errors.push(...(await cleanupAll(cleanup.splice(0).reverse())));
  }
  if (errors.length)
    throw new AggregateError(errors, "Development setup or cleanup failed");
}, 120_000);
