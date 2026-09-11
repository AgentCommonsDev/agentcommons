import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repository = fileURLToPath(new URL("../..", import.meta.url));
function compose(files: string[], extraEnv = "") {
  const cwd = mkdtempSync(join(tmpdir(), "agentcommons-compose-test-"));
  try {
    for (const file of files)
      copyFileSync(join(repository, file), join(cwd, file));
    mkdirSync(join(cwd, "infra", "caddy"), { recursive: true });
    copyFileSync(
      join(repository, "infra", "caddy", "Caddyfile"),
      join(cwd, "infra", "caddy", "Caddyfile"),
    );
    // Compose validates service env_file paths even with --no-env-resolution.
    // Supply the documented example inside the fixture, never the user's .env.
    writeFileSync(
      join(cwd, ".env"),
      readFileSync(join(repository, ".env.example"), "utf8") + extraEnv,
    );
    const output = execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        ".env",
        ...files.flatMap((file) => ["-f", file]),
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
    const services = compose(["docker-compose.yml"]);
    expect(Object.keys(services).sort()).toEqual([
      "api",
      "clickhouse",
      "db",
      "migrate",
    ]);
    expect(services.api).toMatchObject({
      image: "ghcr.io/agentcommonsdev/agentcommons:stable",
      depends_on: { migrate: { condition: "service_completed_successfully" } },
      environment: { DATABASE_MIGRATION_URL: "", POSTGRES_PASSWORD: "" },
      ports: [{ host_ip: "127.0.0.1", target: 3000, published: "3000" }],
      logging: {
        driver: "json-file",
        options: { "max-size": "50m", "max-file": "5" },
      },
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
      // libpq reads ~/.postgresql when PostgreSQL offers TLS; root's HOME is unreadable.
      environment: { HOME: "/var/lib/clickhouse" },
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
  // @req R-INF-09
  it("runs the published release by default, pins another image through AGENTCOMMONS_IMAGE and documents the update settings", () => {
    const pinned = compose(
      ["docker-compose.yml"],
      "AGENTCOMMONS_IMAGE=ghcr.io/agentcommonsdev/agentcommons:sha-0123456789ab\n",
    );
    for (const service of ["api", "migrate"]) {
      expect(pinned[service]?.image).toBe(
        "ghcr.io/agentcommonsdev/agentcommons:sha-0123456789ab",
      );
      // The build block stays so development and the Compose e2e can build locally.
      expect(pinned[service]?.build).toMatchObject({
        dockerfile: "Dockerfile",
      });
    }
    const example = readFileSync(join(repository, ".env.example"), "utf8");
    expect(example).toMatch(/^AGENTCOMMONS_IMAGE=$/m);
    expect(example).toMatch(/^AUTO_UPDATE=true$/m);
    const dockerfile = readFileSync(join(repository, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("ARG AGENTCOMMONS_VERSION=development");
    expect(dockerfile).toMatch(
      /^ENV .*AGENTCOMMONS_VERSION=\$AGENTCOMMONS_VERSION/m,
    );
  });
  // @req R-INF-07
  it("terminates TLS with Caddy in front of the self-host API and trusts only the Compose network as a proxy", () => {
    const services = compose([
      "docker-compose.yml",
      "docker-compose.caddy.yml",
    ]);
    expect(Object.keys(services).sort()).toEqual([
      "api",
      "caddy",
      "clickhouse",
      "db",
      "migrate",
    ]);
    expect(services.caddy).toMatchObject({
      image: "caddy:2.11.4",
      entrypoint: ["/bin/sh", "/etc/caddy/entrypoint.sh"],
      command: [
        "caddy",
        "run",
        "--config",
        "/etc/caddy/Caddyfile",
        "--adapter",
        "caddyfile",
      ],
      environment: {
        PUBLIC_URL: "http://localhost:5173",
        CADDY_TRUSTED_PROXIES: "cloudflare",
      },
      depends_on: { api: { condition: "service_started" } },
      restart: "unless-stopped",
    });
    expect(services.caddy?.ports).toEqual([
      expect.objectContaining({ target: 80, published: "80" }),
      expect.objectContaining({ target: 443, published: "443" }),
    ]);
    // The whole directory: a release replaces the files, and `caddy reload` must see them.
    const caddyVolumes = z
      .array(
        z.object({
          type: z.string(),
          source: z.string().optional(),
          target: z.string(),
          read_only: z.boolean().optional(),
        }),
      )
      .parse(services.caddy?.volumes);
    expect(caddyVolumes.map((volume) => volume.target).sort()).toEqual([
      "/config",
      "/data",
      "/etc/caddy",
    ]);
    expect(
      caddyVolumes.find((volume) => volume.target === "/etc/caddy"),
    ).toMatchObject({
      type: "bind",
      read_only: true,
    });
    expect(
      caddyVolumes.find((volume) => volume.target === "/etc/caddy")?.source,
    ).toMatch(/\/infra\/caddy$/);
    expect(caddyVolumes.find((volume) => volume.target === "/data")?.type).toBe(
      "volume",
    );
    expect(services.caddy?.env_file).toBeUndefined();
    expect(services.api).toMatchObject({
      environment: {
        TRUST_PROXY: "uniquelocal",
        DATABASE_MIGRATION_URL: "",
        POSTGRES_PASSWORD: "",
      },
      ports: [{ host_ip: "127.0.0.1", target: 3000, published: "3000" }],
    });
    expect(services.db?.ports).toBeUndefined();
    expect(services.clickhouse?.ports).toBeUndefined();
    // Memory limits for one 8 GiB host; every long-running service restarts.
    const limits = z.object({
      deploy: z.object({
        resources: z.object({
          limits: z.object({ memory: z.coerce.number() }),
        }),
      }),
      restart: z.string().optional(),
    });
    expect(limits.parse(services.clickhouse)).toMatchObject({
      deploy: { resources: { limits: { memory: 3.5 * 1024 ** 3 } } },
      restart: "unless-stopped",
    });
    expect(limits.parse(services.db)).toMatchObject({
      deploy: { resources: { limits: { memory: 1024 ** 3 } } },
      restart: "unless-stopped",
    });
    expect(limits.parse(services.api)).toMatchObject({
      deploy: { resources: { limits: { memory: 1024 ** 3 } } },
      restart: "unless-stopped",
    });
    expect(limits.parse(services.migrate)).toMatchObject({
      deploy: { resources: { limits: { memory: 1024 ** 3 } } },
    });
    expect(limits.parse(services.caddy)).toMatchObject({
      deploy: { resources: { limits: { memory: 256 * 1024 ** 2 } } },
    });
    expect(services.db?.command).toEqual(["sh", "/etc/postgresql/start.sh"]);
    const start = readFileSync(
      join(repository, "infra", "compose", "postgres-start.sh"),
      "utf8",
    );
    execFileSync("sh", ["-n"], { input: start });
    expect(start).toContain("-c shared_buffers=256MB");
    expect(start).toContain("-c ssl=on");
    expect(start).toContain("-c hba_file=/etc/postgresql/pg_hba.conf");
    expect(start.trim().endsWith('exec docker-entrypoint.sh "$@"')).toBe(true);
    expect(services.api?.environment).toMatchObject({
      NODE_OPTIONS: "--max-old-space-size=768",
    });
    expect(services.clickhouse?.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "/etc/clickhouse-server/config.d/single-node.xml",
          read_only: true,
        }),
        expect.objectContaining({
          target: "/etc/clickhouse-server/users.d/single-node.xml",
          read_only: true,
        }),
      ]),
    );
    const server = readFileSync(
      join(repository, "infra", "compose", "clickhouse-server.xml"),
      "utf8",
    );
    expect(server).toContain(
      "<max_server_memory_usage>3221225472</max_server_memory_usage>",
    );
    expect(server).toContain(
      "<max_concurrent_queries>32</max_concurrent_queries>",
    );
    // System logs nothing reads; their merges outweigh the trace data on two vCPUs.
    expect(server).toContain('<asynchronous_metric_log remove="1" />');
    expect(server).toContain('<processors_profile_log remove="1" />');
    expect(
      readFileSync(
        join(repository, "infra", "compose", "clickhouse-users.xml"),
        "utf8",
      ),
    ).toContain("<max_memory_usage>2147483648</max_memory_usage>");
    const agent = z
      .object({
        metrics: z.object({
          metrics_collected: z.object({ mem: z.unknown(), disk: z.unknown() }),
          aggregation_dimensions: z.array(z.array(z.string())),
        }),
      })
      .parse(
        JSON.parse(
          readFileSync(
            join(repository, "infra", "compose", "cloudwatch-agent.json"),
            "utf8",
          ),
        ),
      );
    expect(agent.metrics.aggregation_dimensions).toEqual([["InstanceId"]]);
    const caddyfile = readFileSync(
      join(repository, "infra", "caddy", "Caddyfile"),
      "utf8",
    );
    expect(caddyfile).toContain("{$PUBLIC_URL} {");
    expect(caddyfile).toContain("http:// {");
    // One upstream definition, imported by both sites.
    expect(caddyfile.match(/reverse_proxy api:3000/g)).toHaveLength(1);
    expect(caddyfile).toContain("(upstream) {");
    expect(caddyfile.match(/^\timport upstream$/gm)).toHaveLength(2);
    // Forwarded headers are trusted only from configured upstream proxies (empty by
    // default); the API always receives the real client address.
    expect(caddyfile).toContain(
      "trusted_proxies static {$CADDY_TRUSTED_PROXIES}",
    );
    expect(caddyfile).toContain("client_ip_headers {$CADDY_CLIENT_IP_HEADER}");
    // The entrypoint fills the list from Cloudflare (fetched, cached, or shipped) and
    // starts whatever command Compose passes.
    const entrypoint = readFileSync(
      join(repository, "infra", "caddy", "entrypoint.sh"),
      "utf8",
    );
    execFileSync("sh", ["-n"], { input: entrypoint });
    expect(entrypoint).toContain("https://www.cloudflare.com/ips-v4");
    expect(entrypoint).toContain("https://www.cloudflare.com/ips-v6");
    expect(entrypoint).toContain("/data/cloudflare-ranges.txt");
    expect(entrypoint).toContain("/etc/caddy/cloudflare-ranges.txt");
    expect(entrypoint.trim().endsWith('exec "$@"')).toBe(true);
    // Modes: cloudflare (default, CF-Connecting-IP), none (trust nothing), literal list.
    expect(entrypoint).toContain("mode=${CADDY_TRUSTED_PROXIES:-cloudflare}");
    expect(entrypoint).toContain("cloudflare)");
    expect(entrypoint).toContain("none)");
    expect(entrypoint).toContain("CADDY_CLIENT_IP_HEADER=CF-Connecting-IP");
    expect(entrypoint).toContain("CADDY_CLIENT_IP_HEADER=X-Forwarded-For");
    expect(entrypoint).toContain(
      "export CADDY_TRUSTED_PROXIES CADDY_CLIENT_IP_HEADER",
    );
    const shipped = readFileSync(
      join(repository, "infra", "caddy", "cloudflare-ranges.txt"),
      "utf8",
    )
      .trim()
      .split("\n");
    expect(shipped.length).toBeGreaterThanOrEqual(10);
    for (const range of shipped)
      expect(range).toMatch(
        /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]+\/\d{1,3}$/,
      );
    expect(
      caddyfile.match(/header_up X-Forwarded-For \{client_ip\}/g),
    ).toHaveLength(1);
  });
  // @req R-INF-07
  it("holds requests while a release swaps the API container and reloads Caddy instead of restarting it", () => {
    const caddyfile = readFileSync(
      join(repository, "infra", "caddy", "Caddyfile"),
      "utf8",
    );
    // Every failure during the swap is a dial error (no address, then connection refused),
    // which Caddy retries for any method until the duration runs out. The hosted instance
    // measured 27 s from the old container's stop to the new one's listen.
    expect(caddyfile).toMatch(/^\t\tlb_try_duration 45s$/m);
    expect(caddyfile).toMatch(/^\t\tlb_try_interval 250ms$/m);
    // The API opens its port only once its databases are connected, so a port that accepts
    // is ready; an active check on /ready would take the static manifest down with them.
    expect(caddyfile).not.toContain("health_uri");
    expect(caddyfile).not.toContain("fail_duration");
    // The release step reloads through the entrypoint (refreshed proxy ranges, shipped
    // Caddyfile, listening sockets kept open) and restarts only when the reload fails.
    const lib = readFileSync(
      join(repository, "scripts", "self-host", "lib.sh"),
      "utf8",
    );
    const reload =
      "compose exec -T caddy sh /etc/caddy/entrypoint.sh caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile";
    expect(lib).toContain(reload);
    expect(lib.indexOf("compose restart caddy")).toBeGreaterThan(
      lib.indexOf(reload),
    );
    expect(lib.match(/compose restart caddy/g)).toHaveLength(1);
  });
  // @req R-INF-07
  it("moves the trace store to ClickHouse Cloud and publishes PostgreSQL to it over TLS only", () => {
    const services = compose(
      [
        "docker-compose.yml",
        "docker-compose.caddy.yml",
        "docker-compose.clickhouse-cloud.yml",
      ],
      [
        "TRACE_STORE=clickhouse-cloud",
        "CLICKHOUSE_URL=https://abc.us-west-2.aws.clickhouse.cloud:8443",
        "CLICKHOUSE_POSTGRES_HOST=203.0.113.10",
        "",
      ].join("\n"),
    );
    // The local clickhouse service is parked behind a profile.
    expect(Object.keys(services).sort()).toEqual([
      "api",
      "caddy",
      "db",
      "migrate",
    ]);
    expect(services.migrate).toMatchObject({
      depends_on: { db: { condition: "service_healthy" } },
      environment: {
        CLICKHOUSE_URL: "https://abc.us-west-2.aws.clickhouse.cloud:8443",
        CLICKHOUSE_POSTGRES_HOST: "203.0.113.10",
        CLICKHOUSE_POSTGRES_PORT: "5432",
      },
    });
    expect(services.migrate?.depends_on).not.toHaveProperty("clickhouse");
    expect(services.migrate?.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "/etc/agentcommons/postgres-tls/server.crt",
          read_only: true,
        }),
      ]),
    );
    expect(services.api?.environment).toMatchObject({
      CLICKHOUSE_URL: "https://abc.us-west-2.aws.clickhouse.cloud:8443",
    });
    expect(services.db?.ports).toEqual([
      expect.objectContaining({ target: 5432, published: "5432" }),
    ]);
    expect(services.db?.command).toEqual(["sh", "/etc/postgresql/start.sh"]);
    expect(services.db?.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "/etc/postgresql/start.sh" }),
        expect.objectContaining({ target: "/etc/postgresql/tls/server.crt" }),
        expect.objectContaining({ target: "/etc/postgresql/tls/server.key" }),
        expect.objectContaining({ target: "/etc/postgresql/pg_hba.conf" }),
      ]),
    );
    const snapshot = z
      .object({
        fetched: z.string(),
        egress: z.record(z.string(), z.record(z.string(), z.array(z.ipv4()))),
      })
      .parse(
        JSON.parse(
          readFileSync(
            join(
              repository,
              "infra",
              "compose",
              "clickhouse-cloud-egress.json",
            ),
            "utf8",
          ),
        ),
      );
    expect(snapshot.egress.aws?.["us-west-2"]?.length).toBeGreaterThan(0);
  });
  // @req R-INF-11
  it("moves the control database outside the stack with docker-compose.external-database.yml", () => {
    const url =
      "postgres://agentcommons:pw@cluster.example.internal:5432/agentcommons?sslmode=require&uselibpqcompat=true";
    const external = [
      "AGENTCOMMONS_DATABASE=external",
      `DATABASE_MIGRATION_URL=${url}`,
      "CLICKHOUSE_POSTGRES_HOST=cluster.example.internal",
      "",
    ].join("\n");
    const services = compose(
      [
        "docker-compose.yml",
        "docker-compose.caddy.yml",
        "docker-compose.external-database.yml",
      ],
      external,
    );
    // The bundled db service is parked behind a profile; its volume declaration stays.
    expect(Object.keys(services).sort()).toEqual([
      "api",
      "caddy",
      "clickhouse",
      "migrate",
    ]);
    expect(services.migrate?.depends_on).not.toHaveProperty("db");
    expect(services.migrate).toMatchObject({
      depends_on: { clickhouse: { condition: "service_healthy" } },
      environment: {
        DATABASE_MIGRATION_URL: url,
        CLICKHOUSE_POSTGRES_HOST: "cluster.example.internal",
        CLICKHOUSE_POSTGRES_PORT: "5432",
      },
    });
    expect(services.api).toMatchObject({
      depends_on: { migrate: { condition: "service_completed_successfully" } },
    });
    // Both "component elsewhere" files compose: nothing left for the migration to wait on.
    const both = compose(
      [
        "docker-compose.yml",
        "docker-compose.caddy.yml",
        "docker-compose.clickhouse-cloud.yml",
        "docker-compose.external-database.yml",
      ],
      [
        external,
        "TRACE_STORE=clickhouse-cloud",
        "CLICKHOUSE_URL=https://abc.us-west-2.aws.clickhouse.cloud:8443",
        "",
      ].join("\n"),
    );
    expect(Object.keys(both).sort()).toEqual(["api", "caddy", "migrate"]);
    expect(both.migrate?.depends_on ?? {}).toEqual({});
    const example = readFileSync(join(repository, ".env.example"), "utf8");
    expect(example).toMatch(/^AGENTCOMMONS_DATABASE=bundled$/m);
  });
  // @req R-INF-01
  it("exposes both databases only on loopback in development", () => {
    const services = compose(["docker-compose.dev.yml"]);
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
