import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repository = fileURLToPath(new URL("../..", import.meta.url));
function compose(file: string) {
  const cwd = mkdtempSync(join(tmpdir(), "agentcommons-compose-test-"));
  try {
    copyFileSync(join(repository, file), join(cwd, file));
    // Compose validates service env_file paths even with --no-env-resolution.
    // Supply the documented example inside the fixture, never the user's .env.
    copyFileSync(join(repository, ".env.example"), join(cwd, ".env"));
    const output = execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        ".env",
        "-f",
        file,
        "config",
        "--no-env-resolution",
        "--format",
        "json",
      ],
      {
        cwd,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: cwd },
      },
    );
    return z
      .object({
        services: z.record(z.string(), z.record(z.string(), z.unknown())),
      })
      .parse(JSON.parse(output) as unknown).services;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
describe("Compose configuration", () => {
  // @req R-INF-01
  it("starts the self-host API only after a healthy database and successful migration", () => {
    const services = compose("docker-compose.yml");
    expect(Object.keys(services).sort()).toEqual([
      "api",
      "clickhouse",
      "db",
      "migrate",
    ]);
    expect(services.api).toMatchObject({
      image: "agentcommons:local",
      depends_on: { migrate: { condition: "service_completed_successfully" } },
      environment: { DATABASE_MIGRATION_URL: "", POSTGRES_PASSWORD: "" },
      ports: [{ host_ip: "127.0.0.1", target: 3000, published: "3000" }],
    });
    expect(services.migrate).toMatchObject({
      command: ["pnpm", "db:migrate"],
      depends_on: {
        db: { condition: "service_healthy" },
        clickhouse: { condition: "service_healthy" },
      },
    });
    expect(services.db).toMatchObject({
      image: "postgres:16",
      environment: { POSTGRES_PASSWORD: "agentcommons" },
    });
    expect(services.db?.ports).toBeUndefined();
    expect(services.clickhouse?.ports).toBeUndefined();
    expect(services.clickhouse).toMatchObject({
      image: "clickhouse/clickhouse-server:26.8.2.7",
    });
    expect(services.clickhouse?.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "/etc/clickhouse-server/config.d/privacy.xml",
          read_only: true,
        }),
        expect.objectContaining({
          target: "/var/lib/clickhouse",
          type: "volume",
        }),
      ]),
    );
  });
  // @req R-INF-01
  it("exposes both databases only on loopback in development", () => {
    const services = compose("docker-compose.dev.yml");
    expect(Object.keys(services).sort()).toEqual(["clickhouse", "db"]);
    expect(services.clickhouse).toMatchObject({
      image: "clickhouse/clickhouse-server:26.8.2.7",
      ports: [{ host_ip: "127.0.0.1", target: 8123, published: "8123" }],
    });
    expect(services.db).toMatchObject({
      image: "postgres:16",
      ports: [{ host_ip: "127.0.0.1", target: 5432, published: "5432" }],
    });
  });
});
