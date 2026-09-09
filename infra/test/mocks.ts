import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";

export const record = z.record(z.string(), z.unknown());

/** Resolves mock inputs, unwrapping RPC secrets so tests can assert on values. */
function unwrap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => unwrap(item));
  if (value !== null && typeof value === "object") {
    const parsed = record.parse(value);
    if (pulumi.runtime.isRpcSecret(parsed)) return unwrap(parsed.value);
    return Object.fromEntries(
      Object.entries(parsed).map(([key, item]) => [key, unwrap(item)]),
    );
  }
  return value;
}

/** Lookups over the resources a mocked program registered, with inputs unwrapped. */
export function resourceQueries(resources: pulumi.runtime.MockResourceArgs[]) {
  const find = (type: string, suffix = "") => {
    const resource = resources.find(
      (item) => item.type === type && item.name.endsWith(suffix),
    );
    if (resource === undefined)
      throw new Error(`Resource absent: ${type} ${suffix}`);
    return record.parse(unwrap(resource.inputs));
  };
  const all = (type: string) =>
    resources
      .filter((item) => item.type === type)
      .map((item) => record.parse(unwrap(item.inputs)));
  return { find, all };
}

/** Stack secrets both deployment shapes read through `readSecrets`. */
export const fixtureSecrets = {
  databaseMigrationPassword: "migration-password-fixture",
  databaseAppPassword: "application-password-fixture",
  databaseTraceControlPassword: "trace-control-password-fixture",
  clickhouseAdminPassword: "clickhouse-admin-password-fixture",
  clickhouseWriterPassword: "clickhouse-writer-password-fixture",
  clickhouseAccessPassword: "clickhouse-access-password-fixture",
  clickhouseReaderSecret: "clickhouse-reader-principal-secret-fixture",
  betterAuthSecret: "test-only-authentication-secret-at-least-32",
};
/** The same secrets as `agentcommons:*` config keys for `setAllConfig`. */
export const fixtureSecretConfig = Object.fromEntries(
  Object.entries(fixtureSecrets).map(([key, value]) => [
    `agentcommons:${key}`,
    value,
  ]),
);
