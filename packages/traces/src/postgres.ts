import { readFileSync } from "node:fs";
import { z } from "zod";
import { sqlString } from "./client.js";

/** Native libpq TLS options, shared by PostgreSQL engines and direct dictionaries. */
function postgresTlsOptions(connection: string): Record<string, string> {
  const url = new URL(connection);
  const sslmode = z
    .enum(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"])
    .parse(url.searchParams.get("sslmode") ?? "prefer");
  const result: Record<string, string> = { sslmode };
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
