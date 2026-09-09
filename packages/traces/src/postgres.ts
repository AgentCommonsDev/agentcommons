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
export function postgresTlsSql(
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
