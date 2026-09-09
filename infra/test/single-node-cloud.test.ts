// @req R-INF-07
import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { all, find, singleNodeFixture } from "./single-node-fixture.js";

const { mocksReady } = singleNodeFixture({
  "agentcommons:traceStore": "clickhouse-cloud",
  "agentcommons:clickhouseCloudUrl":
    "https://cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443",
  "agentcommons:clickhouseCloudPassword": "cloud-issued-secret",
  "agentcommons:clickhouseWriterPassword": "clickhouse-writer-fixture-Aa!",
  "agentcommons:clickhouseAccessPassword": "clickhouse-access-fixture-Aa!",
});
const egress = z
  .object({
    egress: z.object({
      aws: z.object({ "us-west-2": z.array(z.ipv4()).min(1) }),
    }),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../compose/clickhouse-cloud-egress.json", import.meta.url),
        "utf8",
      ),
    ),
  ).egress.aws["us-west-2"];

describe("single-node with the ClickHouse Cloud trace store", () => {
  beforeAll(async () => {
    await mocksReady;
    const outputs = (await import("../index.js")).default();
    if (!("publicIp" in outputs))
      throw new Error("The single-node shape must export its address.");
    await new Promise((resolve) => {
      pulumi.output(outputs).apply(resolve);
    });
    await pulumi.runtime.disconnect();
  }, 30000);
  it("opens PostgreSQL only to the Cloud region's egress addresses", () => {
    const ingress = z
      .array(
        z.object({ fromPort: z.number(), cidrBlocks: z.array(z.string()) }),
      )
      .parse(find("aws:ec2/securityGroup:SecurityGroup").ingress);
    const postgres = ingress.filter((rule) => rule.fromPort === 5432);
    expect(postgres).toHaveLength(1);
    expect(postgres[0]?.cidrBlocks).toEqual(egress.map((ip) => `${ip}/32`));
    expect(postgres[0]?.cidrBlocks).not.toContain("0.0.0.0/0");
    expect(ingress.map((rule) => rule.fromPort).sort((a, b) => a - b)).toEqual([
      80, 443, 5432,
    ]);
  });
  it("points the API and migration at Cloud and publishes PostgreSQL to it without libpq options", () => {
    const values = Object.fromEntries(
      all("aws:ssm/parameter:Parameter").map(
        (parameter) =>
          [
            z
              .string()
              .parse(z.string().parse(parameter.name).split("/").at(-1)),
            z.string().parse(parameter.value),
          ] as const,
      ),
    );
    expect(values).toMatchObject({
      TRACE_STORE: "clickhouse-cloud",
      CLICKHOUSE_URL: "https://cjudcc6tio.us-west-2.aws.clickhouse.cloud:8443",
      CLICKHOUSE_POSTGRES_HOST: "203.0.113.10",
      CLICKHOUSE_POSTGRES_PORT: "5432",
      CLICKHOUSE_MIGRATION_USER: "default",
      CLICKHOUSE_MIGRATION_PASSWORD: "cloud-issued-secret",
      CLICKHOUSE_WRITER_PASSWORD: "clickhouse-writer-fixture-Aa!",
      CLICKHOUSE_ACCESS_PASSWORD: "clickhouse-access-fixture-Aa!",
      CLICKHOUSE_DATABASE: "ac_trace",
    });
    // No libpq TLS options by default: ClickHouse Cloud 26.2 rejects them; the host's
    // pg_hba.conf still admits Cloud over TLS only.
    expect(values.DATABASE_TRACE_CONTROL_URL).toBe(
      "postgres://ac_trace_control:trace-control-password-fixture@db:5432/agentcommons",
    );
    expect(values.DATABASE_URL).toBe(
      "postgres://ac_app:application-password-fixture@db:5432/agentcommons",
    );
  });
});
