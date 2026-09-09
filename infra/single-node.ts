import { readFileSync } from "node:fs";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import type { Secrets, SingleNodeSettings } from "./config.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
/** Canonical's public parameter for the current Ubuntu 24.04 arm64 image. */
const ubuntuImageParameter =
  "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id";
const egressSnapshot = z.object({
  fetched: z.string(),
  egress: z.record(z.string(), z.record(z.string(), z.array(z.ipv4()))),
});
/** ClickHouse Cloud egress addresses for one region, from the reviewed repository snapshot. */
function clickhouseCloudEgress(provider: string, region: string) {
  const snapshot = egressSnapshot.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../infra/compose/clickhouse-cloud-egress.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const addresses = snapshot.egress[provider]?.[region];
  if (addresses === undefined || addresses.length === 0)
    throw new Error(
      `No ClickHouse Cloud egress addresses for ${provider}/${region}; run infra/scripts/clickhouse-cloud-egress.sh.`,
    );
  return addresses;
}
/** Every `.env` value is single-quoted for Compose, so quotes and line breaks are refused. */
const environmentValue = z.string().regex(/^[^'\r\n]*$/);

function renderUserData(input: {
  bucket: string;
  region: string;
  parameterPath: string;
}) {
  return [
    "#!/bin/bash",
    "# First boot: Docker, the AWS CLI, swap, log rotation and the release wrapper. Application",
    "# code arrives through infra/scripts/single-node-release.sh; nothing here holds a secret.",
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get -o DPkg::Lock::Timeout=600 update",
    "apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends docker.io docker-compose-v2 jq unzip curl ca-certificates",
    "curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o /tmp/awscli.zip",
    "unzip -q -o /tmp/awscli.zip -d /tmp",
    "/tmp/aws/install --update",
    "rm -rf /tmp/aws /tmp/awscli.zip",
    "if [ ! -f /swapfile ]; then",
    "  fallocate -l 4G /swapfile",
    "  chmod 600 /swapfile",
    "  mkswap /swapfile",
    "  swapon /swapfile",
    "  printf '/swapfile none swap sw 0 0\\n' >> /etc/fstab",
    "fi",
    "install -d -m 0755 /etc/docker",
    `printf '%s\\n' '{"log-driver":"json-file","log-opts":{"max-size":"50m","max-file":"5"}}' > /etc/docker/daemon.json`,
    "systemctl enable docker",
    "systemctl restart docker",
    "cat > /usr/local/bin/agentcommons-release <<'SH'",
    "#!/bin/bash",
    "# Fetches one published source release and hands over to its apply script.",
    "set -euo pipefail",
    `export AWS_REGION=${quote(input.region)}`,
    `export AGENTCOMMONS_PARAMETER_PATH=${quote(input.parameterPath)}`,
    `export AGENTCOMMONS_RELEASE_BUCKET=${quote(input.bucket)}`,
    "root=/opt/agentcommons",
    'install -d -m 0755 "$root"',
    'if [ $# -ge 1 ]; then commit=$1; elif ! commit=$(aws s3 cp "s3://$AGENTCOMMONS_RELEASE_BUCKET/current" - 2>/dev/null); then',
    '  echo "No release has been published; run infra/scripts/single-node-release.sh <commit>."',
    "  exit 0",
    "fi",
    "commit=$(printf '%s' \"$commit\" | tr -d '[:space:]')",
    '[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid release commit: $commit" >&2; exit 1; }',
    'rm -rf "$root/app.new"',
    'install -d -m 0755 "$root/app.new"',
    'aws s3 cp "s3://$AGENTCOMMONS_RELEASE_BUCKET/releases/$commit.tar.gz" - | tar -xzf - -C "$root/app.new"',
    'if [ -d "$root/app" ]; then rm -rf "$root/app.previous"; mv "$root/app" "$root/app.previous"; fi',
    'mv "$root/app.new" "$root/app"',
    'printf \'%s\\n\' "$commit" > "$root/current-commit"',
    'exec "$root/app/infra/scripts/single-node/apply.sh"',
    "SH",
    "chmod 0755 /usr/local/bin/agentcommons-release",
    "/usr/local/bin/agentcommons-release",
  ].join("\n");
}

/** One arm64 host running the Compose stack behind Caddy with a fixed public address. */
export function singleNodeStack(
  settings: SingleNodeSettings,
  secrets: Secrets,
) {
  const name = `agentcommons-${settings.stack}`;
  const tags = { Application: "agentcommons", Environment: settings.stack };
  const region = aws.getRegionOutput().region;
  const account = aws.getCallerIdentityOutput().accountId;
  const vpc = aws.ec2.getVpcOutput({ default: true });
  const subnets = aws.ec2.getSubnetsOutput({
    filters: [
      { name: "vpc-id", values: [vpc.id] },
      { name: "default-for-az", values: ["true"] },
    ],
  });
  const subnetId = subnets.ids.apply((ids) =>
    z.string().parse([...ids].sort()[0]),
  );
  const image = aws.ssm.getParameterOutput({ name: ubuntuImageParameter });
  const parameterPath = `/agentcommons/${settings.stack}/env`;
  const publicUrl = `https://${settings.hostname}`;

  const releases = new aws.s3.Bucket(`${name}-releases`, {
    forceDestroy: true,
    tags,
  });
  new aws.s3.BucketPublicAccessBlock(`${name}-releases`, {
    bucket: releases.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  const address = new aws.ec2.Eip(name, { domain: "vpc", tags });
  const cloud =
    settings.traceStore === "clickhouse-cloud"
      ? z
          .object({
            origin: z.string(),
            provider: z.string(),
            region: z.string(),
          })
          .parse(settings.clickhouseCloudUrl)
      : undefined;
  const cloudEgress = cloud
    ? clickhouseCloudEgress(cloud.provider, cloud.region)
    : [];
  // ClickHouse Cloud accepts only passwords with an uppercase letter and a special
  // character; the migration creates the writer and access users with these values.
  const cloudPolicy = z
    .string()
    .regex(/[A-Z]/, "ClickHouse Cloud passwords need an uppercase letter.")
    .regex(
      /[^A-Za-z0-9]/,
      "ClickHouse Cloud passwords need a special character.",
    );
  const policed = (value: pulumi.Output<string>) =>
    cloud ? value.apply((password) => cloudPolicy.parse(password)) : value;
  const cloudPassword = cloud ? secrets.clickhouseCloudPassword : undefined;
  if (cloud && cloudPassword === undefined)
    throw new Error(
      "traceStore clickhouse-cloud requires the clickhouseCloudPassword secret.",
    );
  // Cloud reads PostgreSQL at the public address. Explicit libpq TLS options are opt-in
  // (ClickHouse Cloud 26.2 rejects them); without them libpq prefers TLS and the host's
  // pg_hba.conf admits Cloud only over TLS, so the link is encrypted but unverified.
  const controlSuffix =
    cloud && settings.clickhouseCloudPostgresTls === "verify-full"
      ? "?sslmode=verify-full&sslrootcert=/etc/agentcommons/postgres-tls/server.crt"
      : cloud && settings.clickhouseCloudPostgresTls === "require"
        ? "?sslmode=require"
        : "";
  const databaseUrl = (user: string, password: string) =>
    `postgres://${user}:${encodeURIComponent(password)}@db:5432/agentcommons`;
  const fixed = {
    COMPOSE_PROJECT_NAME: "agentcommons",
    PUBLIC_URL: publicUrl,
    TRACE_STORE: settings.traceStore,
    CLICKHOUSE_URL: cloud?.origin ?? "http://clickhouse:8123",
    CLICKHOUSE_POSTGRES_PORT: "5432",
    CLICKHOUSE_DATABASE: "ac_trace",
    CLICKHOUSE_MIGRATION_USER: "default",
    CLICKHOUSE_WRITER_USER: "ac_trace_writer",
    CLICKHOUSE_ACCESS_USER: "ac_trace_access",
  };
  const generated = [
    "CLICKHOUSE_POSTGRES_HOST",
    "POSTGRES_PASSWORD",
    "DATABASE_MIGRATION_URL",
    "DATABASE_URL",
    "DATABASE_TRACE_CONTROL_URL",
    "CLICKHOUSE_MIGRATION_PASSWORD",
    "CLICKHOUSE_WRITER_PASSWORD",
    "CLICKHOUSE_ACCESS_PASSWORD",
    "CLICKHOUSE_READER_SECRET",
    "BETTER_AUTH_SECRET",
  ] as const;
  const values = pulumi
    .output({
      master: secrets.masterPassword,
      app: secrets.appPassword,
      traceControl: secrets.traceControlPassword,
      authSecret: secrets.authSecret.apply((value) =>
        z.string().min(32).parse(value),
      ),
      clickhouseAdmin: secrets.clickhouseAdminPassword,
      clickhouseWriter: policed(secrets.clickhouseWriterPassword),
      clickhouseAccess: policed(secrets.clickhouseAccessPassword),
      clickhouseReader: secrets.clickhouseReaderSecret,
      clickhouseCloud: cloudPassword ?? pulumi.output(""),
      additional: secrets.additional,
      publicIp: address.publicIp,
    })
    .apply((secret) =>
      z.record(z.string(), environmentValue).parse({
        ...settings.environment,
        ...secret.additional,
        ...fixed,
        CLICKHOUSE_POSTGRES_HOST: cloud ? secret.publicIp : "db",
        POSTGRES_PASSWORD: secret.master,
        DATABASE_MIGRATION_URL: databaseUrl("agentcommons", secret.master),
        DATABASE_URL: databaseUrl("ac_app", secret.app),
        DATABASE_TRACE_CONTROL_URL:
          databaseUrl("ac_trace_control", secret.traceControl) + controlSuffix,
        CLICKHOUSE_MIGRATION_PASSWORD: cloud
          ? secret.clickhouseCloud
          : secret.clickhouseAdmin,
        CLICKHOUSE_WRITER_PASSWORD: secret.clickhouseWriter,
        CLICKHOUSE_ACCESS_PASSWORD: secret.clickhouseAccess,
        CLICKHOUSE_READER_SECRET: secret.clickhouseReader,
        BETTER_AUTH_SECRET: secret.authSecret,
      } satisfies Record<string, string>),
    );
  const keys = [
    ...new Set([
      ...Object.keys(settings.environment),
      ...secrets.additionalKeys,
      ...Object.keys(fixed),
      ...generated,
    ]),
  ].sort();
  const parameters = keys.map(
    (key) =>
      new aws.ssm.Parameter(`${name}-env-${key}`, {
        name: `${parameterPath}/${key}`,
        type: "SecureString",
        value: pulumi.secret(
          values.apply((record) => z.string().parse(record[key])),
        ),
        tags,
      }),
  );

  const security = new aws.ec2.SecurityGroup(name, {
    vpcId: vpc.id,
    description: "AgentCommons host: HTTP and HTTPS only; management via SSM",
    ingress: [
      ...[80, 443].map((port) => ({
        protocol: "tcp",
        fromPort: port,
        toPort: port,
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
      })),
      // ClickHouse Cloud reads the PostgreSQL control tables and dictionaries over TLS.
      ...(cloudEgress.length
        ? [
            {
              protocol: "tcp",
              fromPort: 5432,
              toPort: 5432,
              cidrBlocks: cloudEgress.map((ip) => `${ip}/32`),
              description: `PostgreSQL control reads from ClickHouse Cloud ${z.string().parse(cloud?.provider)}/${z.string().parse(cloud?.region)}`,
            },
          ]
        : []),
    ],
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
      },
    ],
    tags,
  });
  const role = new aws.iam.Role(name, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
    tags,
  });
  const management = new aws.iam.RolePolicyAttachment(`${name}-ssm`, {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });
  // The CloudWatch agent (installed by the release step) publishes memory and root disk
  // usage for the alarms below.
  const metrics = new aws.iam.RolePolicyAttachment(`${name}-metrics`, {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
  });
  const parameterKey = aws.kms.getKeyOutput({ keyId: "alias/aws/ssm" });
  const access = new aws.iam.RolePolicy(`${name}-instance`, {
    role: role.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject"],
          Resource: pulumi.interpolate`${releases.arn}/*`,
        },
        {
          Effect: "Allow",
          Action: ["s3:ListBucket"],
          Resource: releases.arn,
        },
        {
          Effect: "Allow",
          Action: [
            "ssm:GetParametersByPath",
            "ssm:GetParameters",
            "ssm:GetParameter",
          ],
          Resource: [
            pulumi.interpolate`arn:aws:ssm:${region}:${account}:parameter${parameterPath}`,
            pulumi.interpolate`arn:aws:ssm:${region}:${account}:parameter${parameterPath}/*`,
          ],
        },
        {
          Effect: "Allow",
          Action: ["kms:Decrypt"],
          Resource: parameterKey.arn,
          Condition: {
            StringEquals: {
              "kms:ViaService": pulumi.interpolate`ssm.${region}.amazonaws.com`,
            },
          },
        },
      ],
    }),
  });
  const profile = new aws.iam.InstanceProfile(name, { role: role.name });
  const userData = pulumi
    .all([releases.bucket, region])
    .apply(([bucket, regionName]) =>
      renderUserData({ bucket, region: regionName, parameterPath }),
    );
  const instance = new aws.ec2.Instance(
    name,
    {
      ami: image.value,
      instanceType: settings.instanceType,
      subnetId,
      associatePublicIpAddress: true,
      vpcSecurityGroupIds: [security.id],
      iamInstanceProfile: profile.name,
      metadataOptions: {
        httpEndpoint: "enabled",
        httpTokens: "required",
        httpPutResponseHopLimit: 1,
      },
      rootBlockDevice: {
        volumeType: "gp3",
        volumeSize: settings.volumeSize,
        encrypted: true,
        deleteOnTermination: true,
        tags: { ...tags, Name: name },
      },
      userData,
      tags: { ...tags, Name: name, Backup: name },
    },
    {
      // The image and first-boot script are informational after creation: data lives
      // on this root volume, so neither a new Ubuntu image nor a wrapper edit may
      // replace or restart the host. Recovery is a snapshot restore.
      protect: true,
      ignoreChanges: ["ami", "userData"],
      dependsOn: [management, metrics, access, ...parameters],
    },
  );
  new aws.ec2.EipAssociation(name, {
    instanceId: instance.id,
    allocationId: address.id,
  });

  const backupRole = new aws.iam.Role(`${name}-backup`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "dlm.amazonaws.com",
    }),
    tags,
  });
  const backupPolicy = new aws.iam.RolePolicyAttachment(`${name}-backup`, {
    role: backupRole.name,
    policyArn:
      "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole",
  });
  new aws.dlm.LifecyclePolicy(
    `${name}-backup`,
    {
      executionRoleArn: backupRole.arn,
      description: "Daily snapshots of the AgentCommons host",
      state: "ENABLED",
      policyDetails: {
        resourceTypes: ["INSTANCE"],
        targetTags: { Backup: name },
        schedules: [
          {
            name: "daily",
            copyTags: true,
            createRule: { interval: 24, intervalUnit: "HOURS", times: "03:00" },
            retainRule: { count: settings.snapshotRetention },
          },
        ],
      },
      tags,
    },
    { dependsOn: [backupPolicy] },
  );
  const alerts = new aws.sns.Topic(`${name}-alerts`, { tags });
  if (settings.alarmEmail !== undefined)
    new aws.sns.TopicSubscription(`${name}-alerts`, {
      topic: alerts.arn,
      protocol: "email",
      endpoint: settings.alarmEmail,
    });
  // Status-check alarms also self-heal: a failed system check recovers the instance
  // onto new hardware (same volume, same address); a failed instance check reboots it.
  const automate = pulumi.interpolate`arn:aws:automate:${region}:ec2`;
  const host = { InstanceId: instance.id };
  const alarms: {
    suffix: string;
    namespace: string;
    metricName: string;
    statistic: string;
    threshold: number;
    comparisonOperator: string;
    period: number;
    evaluationPeriods: number;
    treatMissingData: string;
    description: string;
    actions?: pulumi.Input<string>[];
  }[] = [
    {
      suffix: "system-check",
      namespace: "AWS/EC2",
      metricName: "StatusCheckFailed_System",
      statistic: "Maximum",
      threshold: 0,
      comparisonOperator: "GreaterThanThreshold",
      period: 60,
      evaluationPeriods: 3,
      treatMissingData: "notBreaching",
      description:
        "EC2 system status check failed for 3 minutes; recovering the host",
      actions: [pulumi.interpolate`${automate}:recover`],
    },
    {
      suffix: "instance-check",
      namespace: "AWS/EC2",
      metricName: "StatusCheckFailed_Instance",
      statistic: "Maximum",
      threshold: 0,
      comparisonOperator: "GreaterThanThreshold",
      period: 60,
      evaluationPeriods: 5,
      treatMissingData: "notBreaching",
      description:
        "EC2 instance status check failed for 5 minutes; rebooting the host",
      actions: [pulumi.interpolate`${automate}:reboot`],
    },
    {
      suffix: "cpu",
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      statistic: "Average",
      threshold: 80,
      comparisonOperator: "GreaterThanThreshold",
      period: 300,
      evaluationPeriods: 3,
      treatMissingData: "notBreaching",
      description: "CPU above 80% for 15 minutes",
    },
    {
      suffix: "cpu-credits",
      namespace: "AWS/EC2",
      metricName: "CPUCreditBalance",
      statistic: "Minimum",
      threshold: 60,
      comparisonOperator: "LessThanThreshold",
      period: 300,
      evaluationPeriods: 2,
      treatMissingData: "notBreaching",
      description:
        "CPU credit balance low; sustained load is being billed as surplus",
    },
    {
      suffix: "disk",
      namespace: "CWAgent",
      metricName: "disk_used_percent",
      statistic: "Maximum",
      threshold: 80,
      comparisonOperator: "GreaterThanThreshold",
      period: 300,
      evaluationPeriods: 2,
      treatMissingData: "missing",
      description: "Root volume above 80% used (less than 20% free)",
    },
    {
      suffix: "memory",
      namespace: "CWAgent",
      metricName: "mem_used_percent",
      statistic: "Average",
      threshold: 90,
      comparisonOperator: "GreaterThanThreshold",
      period: 300,
      evaluationPeriods: 2,
      treatMissingData: "missing",
      description: "Memory above 90% for 10 minutes",
    },
  ];
  for (const { suffix, description, actions, ...args } of alarms)
    new aws.cloudwatch.MetricAlarm(`${name}-${suffix}`, {
      ...args,
      alarmDescription: `${name}: ${description}`,
      dimensions: host,
      alarmActions: [alerts.arn, ...(actions ?? [])],
      okActions: [alerts.arn],
      tags,
    });
  return {
    url: publicUrl,
    alarmTopicArn: alerts.arn,
    publicIp: address.publicIp,
    instanceId: instance.id,
    releaseBucket: releases.bucket,
    parameterPath,
    region,
  };
}
