import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { fixtureSecretConfig, record, resourceQueries } from "./mocks.js";

export function stackContract(stack: "dev" | "prod") {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  const generatedAlbHostname = `${stack}-alb.fixture.elb.amazonaws.com`;
  let exportedAlbHostname: string | undefined;
  const mocksReady = pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        const arn = `arn:aws:mock:us-east-1:123456789012:${args.name}`;
        const state: Record<string, unknown> = {
          ...record.parse(args.inputs),
          name: args.name,
          arn,
          address: "database.internal",
          privateIp: "10.42.1.25",
          identifier: args.name,
          versionId: args.name.endsWith("-traces-bootstrap")
            ? "trace-bootstrap-version-fixture"
            : "version-1",
          url: "123456789012.dkr.ecr.us-east-1.amazonaws.com/api",
          vpcId: "vpc-123",
          privateSubnetIds: ["subnet-private-a", "subnet-private-b"],
          publicSubnetIds: ["subnet-public-a", "subnet-public-b"],
          imageUri: "example.com/api@sha256:1234",
          loadBalancer: {
            dnsName: generatedAlbHostname,
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
        const inputs = record.parse(args.inputs);
        if (args.token === "aws:ec2/getSubnet:getSubnet")
          return { ...inputs, availabilityZone: "us-east-1a" };
        if (args.token === "aws:ssm/getParameter:getParameter")
          return { ...inputs, value: "ami-native-fixture" };
        if (args.token === "aws:index/getRegion:getRegion")
          return { region: "us-east-1" };
        return inputs;
      },
    },
    "agentcommons",
    stack,
    false,
  );
  pulumi.runtime.setAllConfig({
    "agentcommons:hostname": `${stack}.example.com`,
    "agentcommons:environment": JSON.stringify(
      stack === "prod"
        ? {
            INSTANCE_MODE: "saas",
            EMAIL_TRANSPORT: "ses",
            EMAIL_FROM: "hello@example.com",
            STRIPE_PRO_PRICE_ID: "price_pro",
            FREE_MONTHLY_RECORDS: "1000",
            PRO_INCLUDED_RECORDS: "10000",
          }
        : { INSTANCE_MODE: "customer", EMAIL_TRANSPORT: "none" },
    ),
    // A configured identity alone must not grant mail access when transport is none.
    "agentcommons:sesIdentityArn":
      "arn:aws:ses:us-east-1:123456789012:identity/example.com",
    "agentcommons:applicationSecrets": JSON.stringify({
      STRIPE_SECRET_KEY: "stripe-secret-fixture",
      STRIPE_WEBHOOK_SECRET: "stripe-webhook-fixture",
      SMTP_URL: "smtp://fixture:password@mail.example.com:587",
    }),
    "agentcommons:certificateArn":
      "arn:aws:acm:us-east-1:123456789012:certificate/test",
    "agentcommons:githubRepository": "example/agentcommons",
    "agentcommons:githubOidcProviderArn":
      "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
    ...fixtureSecretConfig,
  });
  const { find } = resourceQueries(resources);
  describe(`${stack} resource contract`, () => {
    beforeAll(async () => {
      await mocksReady;
      const outputs = (await import("../index.js")).default();
      if (!("serviceName" in outputs))
        throw new Error("The Fargate shape must export its service outputs.");
      await new Promise<void>((resolve) => {
        pulumi
          .all([
            outputs.serviceName,
            outputs.githubDeploymentRoleArn,
            outputs.alarmTopicArn,
            outputs.loadBalancerDnsName,
          ])
          .apply(([, , , dnsName]) => {
            exportedAlbHostname = dnsName;
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
    it("keeps the ClickHouse host private with encrypted retained data, native privacy settings and scoped backups", () => {
      const host = find("aws:ec2/instance:Instance", "-traces");
      expect(host).toMatchObject({
        instanceType: "t3.large",
        associatePublicIpAddress: false,
        subnetId: "subnet-private-a",
        metadataOptions: { httpTokens: "required", httpPutResponseHopLimit: 1 },
      });
      const volume = find("aws:ebs/volume:Volume", "-traces");
      expect(volume).toMatchObject({
        encrypted: true,
        type: "gp3",
        size: 100,
        availabilityZone: "us-east-1a",
      });
      expect(
        find("aws:ec2/securityGroup:SecurityGroup", "-traces"),
      ).toMatchObject({
        ingress: [
          {
            protocol: "tcp",
            fromPort: 8123,
            toPort: 8123,
            securityGroups: [`agentcommons-${stack}-tasks-id`],
          },
        ],
      });
      expect(
        find("aws:ec2/securityGroup:SecurityGroup", "-database"),
      ).toMatchObject({
        ingress: [
          {
            fromPort: 5432,
            toPort: 5432,
            securityGroups: [
              `agentcommons-${stack}-tasks-id`,
              `agentcommons-${stack}-traces-id`,
            ],
          },
        ],
      });
      const script = z.string().parse(host.userData);
      execFileSync("bash", ["-n"], { input: script });
      expect(script).not.toContain("clickhouse-admin-password-fixture");
      expect(script).toContain(
        readFileSync(
          new URL("../../packages/traces/config/privacy.xml", import.meta.url),
        ).toString("base64"),
      );
      expect(script).toContain("/var/lib/clickhouse");
      expect(script).toContain("lsblk -dn -o PATH,SERIAL");
      const backups = find(
        "aws:dlm/lifecyclePolicy:LifecyclePolicy",
        "-backup",
      );
      expect(backups).toMatchObject({
        state: "ENABLED",
        policyDetails: {
          resourceTypes: ["VOLUME"],
          targetTags: { TraceBackup: `agentcommons-${stack}` },
          schedules: [
            {
              createRule: { interval: 24, intervalUnit: "HOURS" },
              retainRule: { count: stack === "prod" ? 35 : 7 },
            },
          ],
        },
      });
    });
    // @req R-INF-02
    it("refreshes the private storage host and migration gate on bootstrap credential rotation while retaining its data volume", () => {
      const host = find("aws:ec2/instance:Instance", "-traces");
      expect(host.userDataReplaceOnChange).toBe(true);
      expect(host.userData).toContain(
        "--version-id 'trace-bootstrap-version-fixture'",
      );
      expect(host.userData).not.toContain("clickhouse-admin-password-fixture");
      expect(find("command:local:Command").triggers).toContain(
        "trace-bootstrap-version-fixture",
      );
      expect(
        find("aws:ec2/volumeAttachment:VolumeAttachment", "-traces"),
      ).toMatchObject({
        volumeId: `agentcommons-${stack}-traces-id`,
        stopInstanceBeforeDetaching: true,
      });
      expect(find("aws:ebs/volume:Volume", "-traces")).not.toHaveProperty(
        "instanceId",
      );
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
    it("exports the generated load balancer hostname for external DNS", () => {
      expect(exportedAlbHostname).toBe(generatedAlbHostname);
      expect(exportedAlbHostname).not.toBe(`${stack}.example.com`);
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
        expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET"]),
      );
      expect(
        serviceTask.container.secrets.some(
          (value) => value.name === "DATABASE_MIGRATION_URL",
        ),
      ).toBe(false);
      expect(
        serviceTask.container.secrets.some((value) =>
          value.name.startsWith("DATABASE_READER_"),
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
    it("mounts SaaS credentials as secrets and scopes SES only to the API task and configured sender", () => {
      const service = find("awsx:ecs:FargateService");
      const api = z
        .object({
          taskRole: z.object({ roleArn: z.string() }),
          container: z.object({
            secrets: z.array(
              z.object({ name: z.string(), valueFrom: z.string() }),
            ),
            environment: z.array(
              z.object({ name: z.string(), value: z.string() }),
            ),
          }),
        })
        .parse(service.taskDefinitionArgs);
      expect(api.container.secrets.map((entry) => entry.name)).toEqual(
        expect.arrayContaining([
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "SMTP_URL",
        ]),
      );
      expect(
        api.container.environment.some((entry) =>
          ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SMTP_URL"].includes(
            entry.name,
          ),
        ),
      ).toBe(false);
      const migration = z
        .object({ taskRole: z.object({ roleArn: z.string() }) })
        .parse(find("awsx:ecs:FargateTaskDefinition"));
      expect(migration.taskRole.roleArn).not.toBe(api.taskRole.roleArn);
      const mail = resources.filter(
        (resource) =>
          resource.type === "aws:iam/rolePolicy:RolePolicy" &&
          resource.name.endsWith("-mail"),
      );
      expect(mail).toHaveLength(stack === "prod" ? 1 : 0);
      if (stack === "prod") {
        const policy = find("aws:iam/rolePolicy:RolePolicy", "-mail");
        expect(policy.role).toBe(`agentcommons-${stack}-task-id`);
        expect(JSON.parse(z.string().parse(policy.policy))).toEqual({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["ses:SendEmail"],
              Resource:
                "arn:aws:ses:us-east-1:123456789012:identity/example.com",
              Condition: {
                StringEquals: { "ses:FromAddress": "hello@example.com" },
              },
            },
          ],
        });
      }
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
