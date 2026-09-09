import { readFileSync } from "node:fs";
import { z } from "zod";
import { sqlString } from "./client.js";

/**
 * Native libpq TLS options, shared by PostgreSQL engines and direct dictionaries. Only
 * options the control URL names are emitted: libpq already defaults to `sslmode=prefer`,
 * and ClickHouse releases before 26.8 (ClickHouse Cloud runs 26.2) reject every TLS
 * key-value argument, so an unrequested option would break the migration there.
 */
function postgresTlsOptions(connection: string): Record<string, string> {
  const url = new URL(connection);
  const result: Record<string, string> = {};
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== null)
    result.sslmode = z
      .enum([
        "disable",
        "allow",
        "prefer",
        "require",
        "verify-ca",
        "verify-full",
      ])
      .parse(sslmode);
  for (const name of ["sslrootcert", "sslcert", "sslkey"]) {
    const path = url.searchParams.get(name);
    if (path) {
      const pem = readFileSync(path, "utf8");
      z.string()
        .min(1)
        .max(1024 * 1024)
        .parse(pem);
      result[name + "_pem"] = pem;
    }
  }
  return result;
}
/** Empty when the URL requests no TLS option; callers must not add a separator for it. */
function postgresTlsSql(
  connection: string,
  style: "engine" | "dictionary",
): string {
  return Object.entries(postgresTlsOptions(connection))
    .map(
      ([key, value]) =>
        `${key}${style === "engine" ? "=" : " "}${sqlString(value)}`,
    )
    .join(style === "engine" ? "," : " ");
}
/**
 * One `trace_control` view of the PostgreSQL control URL as the complete `ENGINE=PostgreSQL(...)`
 * clause of a mirrored table or the `SOURCE(POSTGRESQL(...))` clause of a direct dictionary.
 */
export function postgresSourceSql(
  connection: string,
  table: string,
  style: "engine" | "dictionary",
): string {
  const url = new URL(connection);
  const host = url.hostname;
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const tls = postgresTlsSql(connection, style);
  if (style === "engine")
    return `ENGINE=PostgreSQL(${[
      `${host}:${port}`,
      database,
      table,
      user,
      password,
      "trace_control",
    ]
      .map(sqlString)
      .concat(tls ? [tls] : [])
      .join(",")})`;
  return `SOURCE(POSTGRESQL(HOST ${sqlString(host)} PORT ${port} DB ${sqlString(database)} USER ${sqlString(user)} PASSWORD ${sqlString(password)} SCHEMA 'trace_control' TABLE ${sqlString(table)}${tls ? ` ${tls}` : ""}))`;
}
