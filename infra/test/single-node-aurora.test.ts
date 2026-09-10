// @req R-INF-11
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  all,
  find,
  fixtureSecrets,
  singleNodeFixture,
} from "./single-node-fixture.js";

const { mocksReady } = singleNodeFixture({
  "agentcommons:database": JSON.stringify({
    kind: "aurora-serverless-v2",
    minCapacity: "1",
    maxCapacity: 8,
  }),
});
const endpoint =
  "agentcommons-zpghl-database.cluster-fixture.us-west-2.rds.amazonaws.com";
const suffix = "?sslmode=require&uselibpqcompat=true";
let exported: Record<string, unknown> = {};

describe("single-node with the control database on Aurora Serverless v2", () => {
  beforeAll(async () => {
    await mocksReady;
    const outputs = (await import("../index.js")).default();
    if (!("publicIp" in outputs))
      throw new Error("The single-node shape must export its address.");
    exported = await new Promise((resolve) => {
      pulumi.output(outputs).apply(resolve);
    });
    await pulumi.runtime.disconnect();
  }, 30000);
  it("provisions one encrypted, protected PostgreSQL 16 cluster with a serverless writer in the host's zone", () => {
    const cluster = find("aws:rds/cluster:Cluster");
    expect(cluster).toMatchObject({
      engine: "aurora-postgresql",
      engineMode: "provisioned",
      engineVersion: "16",
      databaseName: "agentcommons",
      masterUsername: "agentcommons",
      masterPassword: fixtureSecrets.databaseMigrationPassword,
      serverlessv2ScalingConfiguration: { minCapacity: 1, maxCapacity: 8 },
      storageEncrypted: true,
      backupRetentionPeriod: 7,
      deletionProtection: true,
      skipFinalSnapshot: false,
      finalSnapshotIdentifier: "agentcommons-zpghl-database-final",
      applyImmediately: false,
      copyTagsToSnapshot: true,
      enabledCloudwatchLogsExports: ["postgresql"],
      dbSubnetGroupName: "agentcommons-zpghl-database",
      dbClusterParameterGroupName: "agentcommons-zpghl-database",
    });
    expect(cluster).not.toHaveProperty("manageMasterUserPassword");
    expect(all("aws:rds/clusterInstance:ClusterInstance")).toHaveLength(1);
    expect(find("aws:rds/clusterInstance:ClusterInstance")).toMatchObject({
      instanceClass: "db.serverless",
      engine: "aurora-postgresql",
      availabilityZone: "us-west-2d",
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
      applyImmediately: false,
      performanceInsightsEnabled: true,
    });
    expect(find("aws:rds/subnetGroup:SubnetGroup")).toMatchObject({
      subnetIds: ["subnet-public-b", "subnet-public-a"],
    });
    expect(
      find("aws:rds/clusterParameterGroup:ClusterParameterGroup"),
    ).toMatchObject({
      family: "aurora-postgresql16",
      parameters: [{ name: "rds.force_ssl", value: "1" }],
    });
    expect(all("aws:rds/instance:Instance")).toHaveLength(0);
  });
  it("admits PostgreSQL only from the host's security group", () => {
    const database = find("aws:ec2/securityGroup:SecurityGroup", "-database");
    expect(database.vpcId).toBe("vpc-default");
    expect(database.ingress).toEqual([
      expect.objectContaining({
        protocol: "tcp",
        fromPort: 5432,
        toPort: 5432,
        securityGroups: ["agentcommons-zpghl-id"],
      }),
    ]);
    expect(database.egress).toEqual([]);
    // The host itself still admits only HTTP and HTTPS.
    const host = find(
      "aws:ec2/securityGroup:SecurityGroup",
      "agentcommons-zpghl",
    );
    const ports = z
      .array(z.object({ fromPort: z.number() }))
      .parse(host.ingress)
      .map((rule) => rule.fromPort)
      .sort((a, b) => a - b);
    expect(ports).toEqual([80, 443]);
  });
  it("renders the cluster endpoint into every database URL with TLS and parks the bundled db service", () => {
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
      AGENTCOMMONS_DATABASE: "external",
      TRACE_STORE: "local",
      CLICKHOUSE_URL: "http://clickhouse:8123",
      CLICKHOUSE_POSTGRES_HOST: endpoint,
      CLICKHOUSE_POSTGRES_PORT: "5432",
      POSTGRES_PASSWORD: fixtureSecrets.databaseMigrationPassword,
      DATABASE_MIGRATION_URL: `postgres://agentcommons:${fixtureSecrets.databaseMigrationPassword}@${endpoint}:5432/agentcommons${suffix}`,
      DATABASE_URL: `postgres://ac_app:${fixtureSecrets.databaseAppPassword}@${endpoint}:5432/agentcommons${suffix}`,
      DATABASE_TRACE_CONTROL_URL: `postgres://ac_trace_control:${fixtureSecrets.databaseTraceControlPassword}@${endpoint}:5432/agentcommons${suffix}`,
    });
    for (const value of Object.values(values))
      expect(value).not.toMatch(/['\r\n]/);
    expect(exported).toMatchObject({ databaseEndpoint: endpoint });
  });
  it("adds database CPU, capacity, memory and connection alarms to the same topic", () => {
    const topic =
      "arn:aws:mock:us-west-2:123456789012:agentcommons-zpghl-alerts";
    const alarms = all("aws:cloudwatch/metricAlarm:MetricAlarm").filter(
      (alarm) => alarm.namespace === "AWS/RDS",
    );
    expect(
      alarms.map((alarm) => z.string().parse(alarm.metricName)).sort(),
    ).toEqual([
      "ACUUtilization",
      "CPUUtilization",
      "DatabaseConnections",
      "FreeableMemory",
    ]);
    for (const alarm of alarms) {
      expect(alarm.dimensions).toEqual({
        DBInstanceIdentifier: "agentcommons-zpghl-database",
      });
      expect(alarm.alarmActions).toEqual([topic]);
      expect(alarm.okActions).toEqual([topic]);
    }
    expect(all("aws:cloudwatch/metricAlarm:MetricAlarm")).toHaveLength(10);
  });
});
