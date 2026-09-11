// @req R-INF-07
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  all,
  find,
  fixtureSecrets,
  googleSecret,
  singleNodeFixture,
} from "./single-node-fixture.js";

const { mocksReady } = singleNodeFixture();

const statements = z.array(
  z.object({
    Effect: z.string(),
    Action: z.array(z.string()),
    Resource: z.union([z.string(), z.array(z.string())]),
    Condition: z.unknown().optional(),
  }),
);
const scripts = [
  "single-node-release.sh",
  "single-node/lib.sh",
  "single-node/host-lib.sh",
  "single-node/apply.sh",
  "single-node/bootstrap.sh",
  "single-node-run.sh",
  "single-node/isolation-check.sh",
  "single-node/revoke-key.sh",
  "single-node/add-members.sh",
  "single-node/migrate-database.sh",
  "clickhouse-cloud-egress.sh",
];
let exported: Record<string, unknown> = {};
let exportedKeys: string[] = [];

describe("single-node resource contract", () => {
  beforeAll(async () => {
    await mocksReady;
    const outputs = (await import("../index.js")).default();
    if (!("publicIp" in outputs))
      throw new Error("The single-node shape must export its address.");
    exportedKeys = Object.keys(outputs).sort();
    exported = await new Promise((resolve) => {
      pulumi.output(outputs).apply(resolve);
    });
    await pulumi.runtime.disconnect();
  }, 30000);
  it("creates no load balancer, cluster, RDS or VPC and exports the fixed address", () => {
    for (const type of [
      "awsx:ec2:Vpc",
      "awsx:ecs:FargateService",
      "awsx:lb:ApplicationLoadBalancer",
      "aws:rds/instance:Instance",
      "aws:secretsmanager/secret:Secret",
      "aws:ec2/eip:Eip",
    ])
      expect(all(type)).toHaveLength(type === "aws:ec2/eip:Eip" ? 1 : 0);
    expect(exported).toMatchObject({
      url: "https://hooks.example.com",
      publicIp: "203.0.113.10",
      instanceId: "agentcommons-zpghl-id",
      releaseBucket: "agentcommons-zpghl-releases-bucket",
      parameterPath: "/agentcommons/zpghl/env",
      region: "us-west-2",
    });
    expect(exportedKeys).toEqual([
      "alarmTopicArn",
      "instanceId",
      "parameterPath",
      "publicIp",
      "region",
      "releaseBucket",
      "url",
    ]);
  });
  it("admits only HTTP and HTTPS and manages the host through SSM instead of SSH", () => {
    const security = find("aws:ec2/securityGroup:SecurityGroup");
    const ingress = z
      .array(z.object({ fromPort: z.number(), toPort: z.number() }))
      .parse(security.ingress);
    expect(ingress.map((rule) => rule.fromPort).sort((a, b) => a - b)).toEqual([
      80, 443,
    ]);
    expect(ingress.every((rule) => rule.fromPort === rule.toPort)).toBe(true);
    expect(security.vpcId).toBe("vpc-default");
    const attachments = all(
      "aws:iam/rolePolicyAttachment:RolePolicyAttachment",
    );
    expect(attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "agentcommons-zpghl",
          policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        }),
        expect.objectContaining({
          role: "agentcommons-zpghl",
          policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
        }),
        expect.objectContaining({
          role: "agentcommons-zpghl-backup",
          policyArn:
            "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole",
        }),
      ]),
    );
  });
  it("alarms on status checks (self-healing), CPU, credits, disk and memory to an email topic", () => {
    expect(find("aws:sns/topicSubscription:TopicSubscription")).toMatchObject({
      protocol: "email",
      endpoint: "ops@example.com",
      topic: "arn:aws:mock:us-west-2:123456789012:agentcommons-zpghl-alerts",
    });
    const alarms = all("aws:cloudwatch/metricAlarm:MetricAlarm");
    const byMetric = Object.fromEntries(
      alarms.map(
        (alarm) => [z.string().parse(alarm.metricName), alarm] as const,
      ),
    );
    expect(Object.keys(byMetric).sort()).toEqual([
      "CPUCreditBalance",
      "CPUUtilization",
      "StatusCheckFailed_Instance",
      "StatusCheckFailed_System",
      "disk_used_percent",
      "mem_used_percent",
    ]);
    const topic =
      "arn:aws:mock:us-west-2:123456789012:agentcommons-zpghl-alerts";
    for (const alarm of alarms) {
      expect(alarm.dimensions).toEqual({ InstanceId: "agentcommons-zpghl-id" });
      expect(alarm.alarmActions).toEqual(expect.arrayContaining([topic]));
      expect(alarm.okActions).toEqual([topic]);
    }
    expect(byMetric.StatusCheckFailed_System?.alarmActions).toEqual([
      topic,
      "arn:aws:automate:us-west-2:ec2:recover",
    ]);
    expect(byMetric.StatusCheckFailed_Instance?.alarmActions).toEqual([
      topic,
      "arn:aws:automate:us-west-2:ec2:reboot",
    ]);
    expect(byMetric.CPUUtilization).toMatchObject({
      threshold: 80,
      period: 300,
      evaluationPeriods: 3,
    });
    expect(byMetric.disk_used_percent).toMatchObject({
      namespace: "CWAgent",
      threshold: 80,
      comparisonOperator: "GreaterThanThreshold",
    });
    expect(byMetric.mem_used_percent).toMatchObject({
      namespace: "CWAgent",
      threshold: 90,
    });
    expect(byMetric.CPUCreditBalance).toMatchObject({
      comparisonOperator: "LessThanThreshold",
      threshold: 60,
    });
  });
  it("runs one arm64 Ubuntu 24.04 host with IMDSv2, an encrypted root volume and a fixed public address", () => {
    const host = find("aws:ec2/instance:Instance");
    expect(host).toMatchObject({
      ami: "ami-ubuntu-arm64-fixture",
      instanceType: "t4g.large",
      subnetId: "subnet-public-a",
      associatePublicIpAddress: true,
      iamInstanceProfile: "agentcommons-zpghl",
      metadataOptions: { httpTokens: "required", httpPutResponseHopLimit: 1 },
      rootBlockDevice: { volumeType: "gp3", volumeSize: 60, encrypted: true },
      tags: { Backup: "agentcommons-zpghl" },
    });
    expect(find("aws:ec2/eip:Eip")).toMatchObject({ domain: "vpc" });
    expect(find("aws:ec2/eipAssociation:EipAssociation")).toMatchObject({
      instanceId: "agentcommons-zpghl-id",
      allocationId: "agentcommons-zpghl-id",
    });
  });
  it("boots without secrets, installing Docker and a release wrapper bound to the bucket and parameter path", () => {
    const script = z.string().parse(find("aws:ec2/instance:Instance").userData);
    execFileSync("bash", ["-n"], { input: script });
    expect(script).toContain("docker.io docker-compose-v2");
    expect(script).toContain("awscli-exe-linux-aarch64.zip");
    expect(script).toContain(
      "AGENTCOMMONS_RELEASE_BUCKET='agentcommons-zpghl-releases-bucket'",
    );
    expect(script).toContain(
      "AGENTCOMMONS_PARAMETER_PATH='/agentcommons/zpghl/env'",
    );
    expect(script).toContain("infra/scripts/single-node/apply.sh");
    for (const value of [...Object.values(fixtureSecrets), googleSecret])
      expect(script).not.toContain(value);
  });
  it("lets the host read only its release bucket and parameter path", () => {
    const policy = find("aws:iam/rolePolicy:RolePolicy", "-instance");
    expect(policy.role).toBe("agentcommons-zpghl-id");
    const parsed = statements.parse(
      z
        .object({ Statement: z.unknown() })
        .parse(JSON.parse(z.string().parse(policy.policy))).Statement,
    );
    expect(parsed.map((statement) => statement.Action)).toEqual([
      ["s3:GetObject"],
      ["s3:ListBucket"],
      ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"],
      ["kms:Decrypt"],
    ]);
    expect(parsed[0]?.Resource).toBe(
      "arn:aws:mock:us-west-2:123456789012:agentcommons-zpghl-releases/*",
    );
    expect(parsed[2]?.Resource).toEqual([
      "arn:aws:ssm:us-west-2:123456789012:parameter/agentcommons/zpghl/env",
      "arn:aws:ssm:us-west-2:123456789012:parameter/agentcommons/zpghl/env/*",
    ]);
    expect(parsed[3]?.Condition).toEqual({
      StringEquals: { "kms:ViaService": "ssm.us-west-2.amazonaws.com" },
    });
    for (const statement of parsed) {
      expect(statement.Action).not.toContain("*");
      expect(statement.Resource).not.toBe("*");
    }
    expect(
      find("aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock"),
    ).toMatchObject({
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });
  });
  it("renders the whole Compose .env as SecureString parameters with Compose hostnames", () => {
    const parameters = all("aws:ssm/parameter:Parameter");
    const values = Object.fromEntries(
      parameters.map(
        (parameter) =>
          [
            z
              .string()
              .parse(z.string().parse(parameter.name).split("/").at(-1)),
            z.string().parse(parameter.value),
          ] as const,
      ),
    );
    expect(
      parameters.every((parameter) => parameter.type === "SecureString"),
    ).toBe(true);
    expect(
      parameters.every((parameter) =>
        z.string().parse(parameter.name).startsWith("/agentcommons/zpghl/env/"),
      ),
    ).toBe(true);
    expect(values).toMatchObject({
      COMPOSE_PROJECT_NAME: "agentcommons",
      TRACE_STORE: "local",
      AUTO_UPDATE: "true",
      AGENTCOMMONS_DATABASE: "bundled",
      CLICKHOUSE_POSTGRES_PORT: "5432",
      PUBLIC_URL: "https://hooks.example.com",
      INSTANCE_MODE: "customer",
      AUTH_SOCIAL_PROVIDER: "google",
      AUTH_GOOGLE_CLIENT_ID: "google-client-id-fixture",
      AUTH_GOOGLE_CLIENT_SECRET: googleSecret,
      EMBEDDINGS_ENABLED: "false",
      POSTGRES_PASSWORD: fixtureSecrets.databaseMigrationPassword,
      DATABASE_MIGRATION_URL: `postgres://agentcommons:${fixtureSecrets.databaseMigrationPassword}@db:5432/agentcommons`,
      DATABASE_URL: `postgres://ac_app:${fixtureSecrets.databaseAppPassword}@db:5432/agentcommons`,
      DATABASE_TRACE_CONTROL_URL: `postgres://ac_trace_control:${fixtureSecrets.databaseTraceControlPassword}@db:5432/agentcommons`,
      CLICKHOUSE_URL: "http://clickhouse:8123",
      CLICKHOUSE_POSTGRES_HOST: "db",
      CLICKHOUSE_MIGRATION_USER: "default",
      CLICKHOUSE_MIGRATION_PASSWORD: fixtureSecrets.clickhouseAdminPassword,
      CLICKHOUSE_WRITER_USER: "ac_trace_writer",
      CLICKHOUSE_ACCESS_USER: "ac_trace_access",
      CLICKHOUSE_READER_SECRET: fixtureSecrets.clickhouseReaderSecret,
      BETTER_AUTH_SECRET: fixtureSecrets.betterAuthSecret,
    });
    expect(Object.keys(values)).toHaveLength(parameters.length);
    for (const value of Object.values(values))
      expect(value).not.toMatch(/['\r\n]/);
  });
  it("snapshots the host daily and keeps seven copies", () => {
    expect(find("aws:dlm/lifecyclePolicy:LifecyclePolicy")).toMatchObject({
      state: "ENABLED",
      executionRoleArn:
        "arn:aws:mock:us-west-2:123456789012:agentcommons-zpghl-backup",
      policyDetails: {
        resourceTypes: ["INSTANCE"],
        targetTags: { Backup: "agentcommons-zpghl" },
        schedules: [
          {
            createRule: { interval: 24, intervalUnit: "HOURS" },
            retainRule: { count: 7 },
          },
        ],
      },
    });
  });
  it("ships syntactically valid operator and host scripts that share one SSM runner", () => {
    for (const script of scripts) {
      const path = new URL(`../scripts/${script}`, import.meta.url);
      const source = readFileSync(path, "utf8");
      execFileSync("bash", ["-n", path.pathname]);
      expect(source).toContain("set -euo pipefail");
      if (script.startsWith("single-node-"))
        expect(source).toContain('. "$(dirname "$0")/single-node/lib.sh"');
      // On-host scripts share one library, shipped or released next to them.
      if (script.startsWith("single-node/") && !script.endsWith("lib.sh"))
        expect(source).toContain('. "$(dirname "$0")/host-lib.sh"');
      if (script.endsWith("lib.sh")) expect(source).not.toContain("#!");
      if (script === "clickhouse-cloud-egress.sh")
        expect(source).toContain(
          "https://api.clickhouse.cloud/static-ips.json",
        );
    }
    const release = readFileSync(
      new URL("../scripts/single-node-release.sh", import.meta.url),
      "utf8",
    );
    expect(release).toContain('git -C "$repo" archive --format=tar.gz');
    expect(release).toContain("/usr/local/bin/agentcommons-release $commit");
    // --build is the escape hatch for a host without registry access (ADR 0059).
    expect(release).toContain('--build) build="AGENTCOMMONS_BUILD=true " ;;');
    const apply = readFileSync(
      new URL("../scripts/single-node/apply.sh", import.meta.url),
      "utf8",
    );
    // The .env rendering and the Compose file list live in the host library, shared with
    // the database cutover script; the list is data in .env, shared with the updater, and
    // the image is pulled unless --build asks for an on-host build.
    expect(apply).toContain("render_env .env.new");
    const shipping = readFileSync(
      new URL("../scripts/single-node/lib.sh", import.meta.url),
      "utf8",
    );
    // Shipped scripts inherit the release wrapper's parameter environment on the host.
    expect(shipping).toContain(
      "grep -E '^export (AWS_REGION|AGENTCOMMONS_PARAMETER_PATH)=' /usr/local/bin/agentcommons-release",
    );
    expect(apply).toContain("files=$(compose_files .env)");
    expect(apply).toContain(`printf "COMPOSE_FILE='%s'\\n" "$files" >>.env`);
    expect(apply).toContain("build=${AGENTCOMMONS_BUILD:-false}");
    expect(apply).toContain("--build) build=true ;;");
    expect(apply).toContain('stack_up "$mode" "$log"');
    // A start alone is not a success: the apply runs the post-deploy self-check against the
    // deployed commit and image before announcing readiness (R-INF-15).
    expect(apply).toContain(
      'verify_deploy "$AGENTCOMMONS_VERSION" "$(local_image "$(configured_image)")"',
    );
    expect(apply).not.toContain("--build --remove-orphans");
    expect(apply).toContain("/opt/agentcommons/agentcommons-update.sh");
    expect(apply).toContain('agentcommons-update.timer" /etc/systemd/system/');
    expect(apply).toContain("systemctl enable --now agentcommons-update.timer");
    expect(apply).toContain("amazon-cloudwatch-agent-ctl -a fetch-config");
    // ClickHouse Cloud mode: a certificate for the public address, pg_hba.conf limited to
    // Cloud egress addresses, and a dictionary probe after start (also in external
    // database mode, where the local ClickHouse must reach the managed PostgreSQL).
    expect(apply).toContain("openssl req -x509");
    expect(apply).toContain("subjectAltName=IP:$host,DNS:db");
    expect(apply).toContain(
      "hostssl agentcommons ac_trace_control $address/32 scram-sha-256",
    );
    expect(apply).toContain("infra/compose/clickhouse-cloud-egress.json");
    expect(apply).toContain(
      '[ "$(setting TRACE_STORE)" = clickhouse-cloud ] || [ "$(setting AGENTCOMMONS_DATABASE)" = external ]',
    );
    expect(apply).toContain("lookup=$(probe_control_dictionary)");
    expect(apply).toContain("infra/compose/cloudwatch-agent.json");
    const bootstrap = readFileSync(
      new URL("../scripts/single-node/bootstrap.sh", import.meta.url),
      "utf8",
    );
    expect(bootstrap).toContain("src/seed.ts --admin");
    expect(bootstrap).toContain("src/domain.ts --organization");
    expect(bootstrap).toContain("/auth/reset-password");
    expect(bootstrap).toContain('owner_sign_in "$organization"');
    expect(bootstrap).toContain("--key)");
    expect(bootstrap).toContain("/api/v1/me/keys");
    expect(bootstrap).toContain('permissions: {sessions: ["read", "ingest"]}');
    // The operator's checkout ships on-host scripts through the release bucket (lib.sh).
    const runner = readFileSync(
      new URL("../scripts/single-node-run.sh", import.meta.url),
      "utf8",
    );
    expect(runner).toContain(
      'ship_run "$repo/infra/scripts/single-node/$name" "$@"',
    );
    const lib = readFileSync(
      new URL("../scripts/single-node/lib.sh", import.meta.url),
      "utf8",
    );
    expect(lib).toContain('"s3://$bucket/scripts/$name"');
    expect(lib).toContain('"s3://$bucket/scripts/host-lib.sh"');
    expect(lib).toContain("/opt/agentcommons/$name $arguments");
    const hostLib = readFileSync(
      new URL("../scripts/single-node/host-lib.sh", import.meta.url),
      "utf8",
    );
    for (const helper of [
      "require_public_url()",
      "require_owner_state()",
      "owner_sign_in()",
      "api()",
      "sign_out()",
      "render_env()",
      "compose_files()",
      "probe_control_dictionary()",
      "/auth/sign-in/email",
      "/auth/sign-out",
      "/root/agentcommons",
      "get-parameters-by-path",
      "--with-decryption",
      "files=docker-compose.yml:docker-compose.caddy.yml:docker-compose.updater.yml",
      "files=$files:docker-compose.clickhouse-cloud.yml",
      "files=$files:docker-compose.external-database.yml",
      "dictGet(",
    ])
      expect(hostLib).toContain(helper);
    // The stack reader and Compose steps live once, in the library the updater shares.
    expect(hostLib).toContain(
      '. "${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}/scripts/self-host/lib.sh"',
    );
    expect(hostLib).not.toContain("setting()");
    const shared = readFileSync(
      new URL("../../scripts/self-host/lib.sh", import.meta.url),
      "utf8",
    );
    for (const helper of [
      "setting()",
      "lock_stack()",
      "configured_image()",
      "wait_ready()",
      "verify_deploy()",
      "stack_up()",
      "compose pull --quiet api",
      "compose up -d --no-build --remove-orphans",
      "compose exec -T caddy sh /etc/caddy/entrypoint.sh caddy reload",
      "compose restart caddy",
    ])
      expect(shared).toContain(helper);
    expect(bootstrap).toContain('state="$state_dir/owner-$organization.json"');
    // The database cutover renders the stack's new parameters beside the running .env,
    // copies through the generic self-host script and keeps a rollback path (ADR 0063).
    const cutover = readFileSync(
      new URL("../scripts/single-node/migrate-database.sh", import.meta.url),
      "utf8",
    );
    for (const text of [
      "render_env .env.external",
      "compose_files .env.external",
      '[ "$(setting AGENTCOMMONS_DATABASE .env.external)" = external ]',
      "compose stop api",
      'scripts/self-host/migrate-database.sh" copy',
      "cp .env .env.bundled",
      "stack_up start",
      "probe_control_dictionary",
      "/api/v1/sessions?limit=1",
      "--rollback",
      "mv .env.bundled .env",
    ])
      expect(cutover).toContain(text);
    const copy = readFileSync(
      new URL("../../scripts/self-host/migrate-database.sh", import.meta.url),
      "utf8",
    );
    execFileSync("bash", ["-n"], { input: copy });
    for (const text of [
      "set -euo pipefail",
      "FROM pg_roles WHERE rolname IN ('ac_app', 'ac_trace_control')",
      "JOIN pg_db_role_setting s ON s.setrole = r.oid",
      'pg_dump -d "$SOURCE_URL" -Fc --no-owner',
      '--no-owner --role="$TARGET_ROLE" --single-transaction --exit-on-error',
      "uselibpqcompat",
      "--env-file",
    ])
      expect(copy).toContain(text);
    const isolation = readFileSync(
      new URL("../scripts/single-node/isolation-check.sh", import.meta.url),
      "utf8",
    );
    for (const text of [
      "/api/v1/sessions?limit=50",
      '{"sql":"SELECT count() AS n FROM sessions"}',
      "/api/v1/sessions/$first",
      "LEAK:",
    ])
      expect(isolation).toContain(text);
  });
});
