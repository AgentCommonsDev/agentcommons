import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

function unwrap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => unwrap(item));
  if (value !== null && typeof value === "object") {
    const record = z.record(z.string(), z.unknown()).parse(value);
    if (pulumi.runtime.isRpcSecret(record)) return unwrap(record.value);
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, unwrap(item)]),
    );
  }
  return value;
}

export function stackContract(stack: "dev" | "prod") {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  const mocksReady = pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        const arn = `arn:aws:mock:us-east-1:123456789012:${args.name}`;
        const state: Record<string, unknown> = {
          ...z.record(z.string(), z.unknown()).parse(args.inputs),
          name: args.name,
          arn,
          address: "database.internal",
          identifier: args.name,
          versionId: "version-1",
          url: "123456789012.dkr.ecr.us-east-1.amazonaws.com/api",
          vpcId: "vpc-123",
          privateSubnetIds: ["subnet-private-a", "subnet-private-b"],
          publicSubnetIds: ["subnet-public-a", "subnet-public-b"],
          imageUri: "example.com/api@sha256:1234",
          loadBalancer: {
            dnsName: "alb.example.com",
            zoneId: "zone-alb",
            arnSuffix: "app/agentcommons/123",
          },
          defaultTargetGroup: { arn: `${arn}-target-group` },
          service: { name: args.name },
          taskDefinition: { arn: `${arn}-task-definition` },
        };
        return { id: `${args.name}-id`, state };
      },
      call(args) {
        if (args.token === "aws:index/getRegion:getRegion")
          return { region: "us-east-1" };
        return z.record(z.string(), z.unknown()).parse(args.inputs);
      },
    },
    "agentcommons",
    stack,
    false,
  );
  pulumi.runtime.setAllConfig({
    "agentcommons:hostname": `${stack}.example.com`,
    "agentcommons:certificateArn":
      "arn:aws:acm:us-east-1:123456789012:certificate/test",
    "agentcommons:githubRepository": "example/agentcommons",
    "agentcommons:githubOidcProviderArn":
      "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
    "agentcommons:databaseMigrationPassword": "migration-password-fixture",
    "agentcommons:databaseAppPassword": "application-password-fixture",
    "agentcommons:databaseReaderUserPassword": "reader-user-password-fixture",
    "agentcommons:databaseReaderAdminPassword": "reader-admin-password-fixture",
    "agentcommons:betterAuthSecret":
      "test-only-authentication-secret-at-least-32",
  });
  const find = (type: string, suffix = "") => {
    const resource = resources.find(
      (item) => item.type === type && item.name.endsWith(suffix),
    );
    if (resource === undefined)
      throw new Error(`Resource absent: ${type} ${suffix}`);
    return z.record(z.string(), z.unknown()).parse(unwrap(resource.inputs));
  };
  describe(`${stack} resource contract`, () => {
    beforeAll(async () => {
      await mocksReady;
      const outputs = await import("../index.js");
      await new Promise<void>((resolve) => {
        pulumi
          .all([
            outputs.serviceName,
            outputs.githubDeploymentRoleArn,
            outputs.alarmTopicArn,
          ])
          .apply(() => {
            resolve();
          });
      });
      await pulumi.runtime.disconnect();
    }, 30000);
    // @req R-INF-02
    it("uses two AZs, private tasks, and the required NAT strategy", () => {
      expect(find("awsx:ec2:Vpc")).toMatchObject({
        numberOfAvailabilityZones: 2,
        natGateways: { strategy: stack === "prod" ? "OnePerAz" : "Single" },
      });
      expect(find("awsx:ecs:FargateService")).toMatchObject({
        desiredCount: stack === "prod" ? 2 : 1,
        continueBeforeSteadyState: false,
        networkConfiguration: {
          assignPublicIp: false,
          subnets: ["subnet-private-a", "subnet-private-b"],
        },
      });
    });
    // @req R-INF-02
    it("encrypts PostgreSQL 16 with backups and production deletion protection", () => {
      expect(find("aws:rds/instance:Instance")).toMatchObject({
        engine: "postgres",
        engineVersion: "16",
        storageType: "gp3",
        storageEncrypted: true,
        publiclyAccessible: false,
        backupRetentionPeriod: stack === "prod" ? 35 : 7,
        deletionProtection: stack === "prod",
        skipFinalSnapshot: stack !== "prod",
        instanceClass: stack === "prod" ? "db.t4g.small" : "db.t4g.micro",
      });
    });
    // @req R-INF-02
    it("redirects HTTP to TLS and uses the readiness health check with 120 second idle timeout", () => {
      expect(find("awsx:lb:ApplicationLoadBalancer")).toMatchObject({
        idleTimeout: 120,
        defaultTargetGroup: { healthCheck: { path: "/ready" } },
        listeners: [
          {
            port: 443,
            protocol: "HTTPS",
            certificateArn:
              "arn:aws:acm:us-east-1:123456789012:certificate/test",
          },
          {
            port: 80,
            defaultActions: [
              {
                type: "redirect",
                redirect: { protocol: "HTTPS", port: "443" },
              },
            ],
          },
        ],
      });
    });
    // @req R-INF-02
    it("gives only the migration task the migration secret", () => {
      const service = find("awsx:ecs:FargateService");
      const migration = find("awsx:ecs:FargateTaskDefinition");
      const serviceTask = z
        .object({
          container: z.object({
            secrets: z.array(
              z.object({ name: z.string(), valueFrom: z.string() }),
            ),
          }),
        })
        .parse(service.taskDefinitionArgs);
      const migrationTask = z
        .object({
          secrets: z.array(
            z.object({ name: z.string(), valueFrom: z.string() }),
          ),
          command: z.array(z.string()),
        })
        .parse(migration.container);
      expect(serviceTask.container.secrets.map((value) => value.name)).toEqual(
        expect.arrayContaining([
          "DATABASE_URL",
          "DATABASE_READER_USER_URL",
          "DATABASE_READER_ADMIN_URL",
          "BETTER_AUTH_SECRET",
        ]),
      );
      expect(
        serviceTask.container.secrets.some(
          (value) => value.name === "DATABASE_MIGRATION_URL",
        ),
      ).toBe(false);
      expect(
        migrationTask.secrets.some(
          (value) => value.name === "DATABASE_MIGRATION_URL",
        ),
      ).toBe(true);
      expect(migrationTask.command).toEqual(["pnpm", "db:migrate"]);
      expect(find("command:local:Command")).toMatchObject({
        create: "pnpm exec tsx scripts/migrate.ts",
        update: "pnpm exec tsx scripts/migrate.ts",
      });
    });
    // @req R-INF-02
    it("creates ECR, logs, four alarms, and an environment-bound OIDC deployment role", () => {
      expect(find("awsx:ecr:Repository")).toMatchObject({
        forceDelete: stack !== "prod",
      });
      expect(find("aws:cloudwatch/logGroup:LogGroup")).toMatchObject({
        retentionInDays: stack === "prod" ? 90 : 14,
      });
      expect(
        resources.filter(
          (resource) =>
            resource.type === "aws:cloudwatch/metricAlarm:MetricAlarm",
        ),
      ).toHaveLength(4);
      const role = find("aws:iam/role:Role", "-github");
      const trust = JSON.parse(
        z.string().parse(role.assumeRolePolicy),
      ) as unknown;
      expect(trust).toMatchObject({
        Statement: [
          {
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": `repo:example/agentcommons:environment:${stack}`,
              },
            },
          },
        ],
      });
    });
  });
}
