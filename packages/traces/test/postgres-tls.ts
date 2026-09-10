import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenericContainer, Wait } from "testcontainers";

/** The query string every client of a TLS-enforcing PostgreSQL receives (ADR 0063). */
export const TLS_QUERY = "?sslmode=require&uselibpqcompat=true";
const TLS_OWNER_PASSWORD = "tls-owner-test-password";
export const TLS_ROLE_PASSWORD = "tls-role-test-password";

/**
 * A PostgreSQL 16 container shaped like a managed server that enforces TLS: a self-signed
 * certificate, a `hostssl`-only `pg_hba.conf`, and an empty `agentcommons` database owned
 * by a non-superuser role with CREATEROLE and CREATEDB (Aurora's master user has the same
 * shape). Tests run the control-plane bootstrap and the ClickHouse control reads against it.
 */
export async function startTlsPostgres(owner = "agentcommons") {
  const material = mkdtempSync(join(tmpdir(), "agentcommons-postgres-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,DNS:host.docker.internal",
      "-keyout",
      join(material, "server.key"),
      "-out",
      join(material, "server.crt"),
    ],
    { stdio: "ignore" },
  );
  writeFileSync(
    join(material, "pg_hba.conf"),
    "local   all all     trust\nhostssl all all all scram-sha-256\n",
  );
  writeFileSync(
    join(material, "owner.sql"),
    `CREATE ROLE ${owner} LOGIN CREATEROLE CREATEDB NOSUPERUSER PASSWORD '${TLS_OWNER_PASSWORD}';\nCREATE DATABASE agentcommons OWNER ${owner};\n`,
  );
  // The entrypoint drops to the postgres user, which must own the private key; TLS and
  // the restricted pg_hba.conf apply to the bootstrap server as well, whose init scripts
  // arrive over the trusted local socket.
  writeFileSync(
    join(material, "start.sh"),
    [
      "#!/bin/sh",
      "set -eu",
      "install -o postgres -g postgres -m 0600 /tls/server.key /var/run/postgresql/server.key",
      "exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/var/run/postgresql/server.key -c hba_file=/tls/pg_hba.conf",
      "",
    ].join("\n"),
  );
  const container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "tls-superuser-test-password",
    })
    .withCopyFilesToContainer([
      { source: join(material, "server.crt"), target: "/tls/server.crt" },
      { source: join(material, "server.key"), target: "/tls/server.key" },
      { source: join(material, "pg_hba.conf"), target: "/tls/pg_hba.conf" },
      { source: join(material, "start.sh"), target: "/tls/start.sh" },
      {
        source: join(material, "owner.sql"),
        target: "/docker-entrypoint-initdb.d/10-owner.sql",
      },
    ])
    .withCommand(["sh", "/tls/start.sh"])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();
  const host = container.getHost();
  const port = String(container.getMappedPort(5432));
  /** A libpq-style URL for one role, at the host's address or the one containers use. */
  const url = (
    role: string,
    password: string,
    from: "host" | "container" = "host",
  ) =>
    `postgres://${role}:${encodeURIComponent(password)}@${from === "host" ? host : "host.docker.internal"}:${port}/agentcommons${TLS_QUERY}`;
  return {
    owner,
    host,
    port,
    url,
    /** The three URLs `pnpm db:migrate` reads, as the stack renders them. */
    environment: {
      DATABASE_MIGRATION_URL: url(owner, TLS_OWNER_PASSWORD),
      DATABASE_URL: url("ac_app", TLS_ROLE_PASSWORD),
      DATABASE_TRACE_CONTROL_URL: url("ac_trace_control", TLS_ROLE_PASSWORD),
    },
    async stop() {
      await container.stop();
      rmSync(material, { recursive: true, force: true });
    },
  };
}
