import { clickHouseHost } from "./clickhouse.js";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import { readSecrets, readSettings } from "./config.js";

const settings = readSettings();
const secrets = readSecrets();
const production = settings.stack === "prod";
const name = `agentcommons-${settings.stack}`;
const region = aws.getRegionOutput().region;
const tags = { Application: "agentcommons", Environment: settings.stack };
const vpc = new awsx.ec2.Vpc(name, {
  numberOfAvailabilityZones: 2,
  cidrBlock: "10.42.0.0/16",
  natGateways: { strategy: production ? "OnePerAz" : "Single" },
  tags,
});
const albSecurity = new aws.ec2.SecurityGroup(`${name}-alb`, {
  vpcId: vpc.vpcId,
  ingress: [80, 443].map((port) => ({
    protocol: "tcp",
    fromPort: port,
    toPort: port,
    cidrBlocks: ["0.0.0.0/0"],
  })),
  egress: [
    {
      protocol: "tcp",
      fromPort: 3000,
      toPort: 3000,
      cidrBlocks: ["10.42.0.0/16"],
    },
  ],
  tags,
});
const taskSecurity = new aws.ec2.SecurityGroup(`${name}-tasks`, {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 3000,
      toPort: 3000,
      securityGroups: [albSecurity.id],
    },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags,
});
const traceSecurity = new aws.ec2.SecurityGroup(`${name}-traces`, {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 8123,
      toPort: 8123,
      securityGroups: [taskSecurity.id],
    },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags,
});
const dbSecurity = new aws.ec2.SecurityGroup(`${name}-database`, {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      securityGroups: [taskSecurity.id, traceSecurity.id],
    },
  ],
  egress: [],
  tags,
});
const subnetGroup = new aws.rds.SubnetGroup(name, {
  subnetIds: vpc.privateSubnetIds,
  tags,
});
const db = new aws.rds.Instance(
  name,
  {
    engine: "postgres",
    engineVersion: "16",
    instanceClass:
      settings.databaseInstanceClass ??
      (production ? "db.t4g.small" : "db.t4g.micro"),
    allocatedStorage: 20,
    maxAllocatedStorage: 100,
    storageType: "gp3",
    storageEncrypted: true,
    dbName: "agentcommons",
    username: "agentcommons_migration",
    password: secrets.masterPassword,
    dbSubnetGroupName: subnetGroup.name,
    vpcSecurityGroupIds: [dbSecurity.id],
    publiclyAccessible: false,
    multiAz: production,
    backupRetentionPeriod: production ? 35 : 7,
    deletionProtection: production,
    skipFinalSnapshot: !production,
    ...(production ? { finalSnapshotIdentifier: `${name}-final` } : {}),
    autoMinorVersionUpgrade: true,
    copyTagsToSnapshot: true,
    enabledCloudwatchLogsExports: ["postgresql", "upgrade"],
    tags,
  },
  { protect: production },
);

const clickhouse = clickHouseHost({
  name,
  securityId: traceSecurity.id,
  subnetId: vpc.privateSubnetIds.apply((ids) => z.string().parse(ids[0])),
  region,
  password: secrets.clickhouseAdminPassword,
  production,
  tags,
});
function databaseUrl(user: string, password: pulumi.Output<string>) {
  return pulumi
    .all([db.address, password])
    .apply(
      ([address, value]) =>
        `postgresql://${user}:${encodeURIComponent(z.string().min(16).parse(value))}@${address}:5432/agentcommons?sslmode=require`,
    );
}
const runtimeValues = pulumi
  .output({
    DATABASE_URL: databaseUrl("ac_app", secrets.appPassword),
    BETTER_AUTH_SECRET: secrets.authSecret.apply((value) =>
      z.string().min(32).parse(value),
    ),
    additional: secrets.additional,
    CLICKHOUSE_WRITER_PASSWORD: secrets.clickhouseWriterPassword,
    CLICKHOUSE_ACCESS_PASSWORD: secrets.clickhouseAccessPassword,
    CLICKHOUSE_READER_SECRET: secrets.clickhouseReaderSecret,
    CLICKHOUSE_URL: clickhouse.url,
  })
  .apply(({ additional, ...values }) => ({
    ...additional,
    ...values,
    CLICKHOUSE_DATABASE: "ac_trace",
    CLICKHOUSE_WRITER_USER: "ac_trace_writer",
    CLICKHOUSE_ACCESS_USER: "ac_trace_access",
  }));
const runtimeSecret = new aws.secretsmanager.Secret(`${name}-application`, {
  recoveryWindowInDays: production ? 30 : 7,
  tags,
});
const runtimeVersion = new aws.secretsmanager.SecretVersion(
  `${name}-application`,
  {
    secretId: runtimeSecret.id,
    secretString: runtimeValues.apply(JSON.stringify),
  },
);
const migrationSecret = new aws.secretsmanager.Secret(`${name}-migration`, {
  recoveryWindowInDays: production ? 30 : 7,
  tags,
});
const migrationVersion = new aws.secretsmanager.SecretVersion(
  `${name}-migration`,
  {
    secretId: migrationSecret.id,
    secretString: pulumi
      .all([
        databaseUrl("agentcommons_migration", secrets.masterPassword),
        databaseUrl("ac_trace_control", secrets.traceControlPassword),
      ])
      .apply(([DATABASE_MIGRATION_URL, DATABASE_TRACE_CONTROL_URL]) =>
        JSON.stringify({ DATABASE_MIGRATION_URL, DATABASE_TRACE_CONTROL_URL }),
      ),
  },
);

const assumeTask = aws.iam.assumeRolePolicyForPrincipal({
  Service: "ecs-tasks.amazonaws.com",
});
const taskRole = new aws.iam.Role(`${name}-task`, {
  assumeRolePolicy: assumeTask,
  tags,
});
const migrationTaskRole = new aws.iam.Role(`${name}-migration-task`, {
  assumeRolePolicy: assumeTask,
  tags,
});
const mailPermissions: pulumi.Resource[] = [];
if (settings.environment.EMAIL_TRANSPORT === "ses") {
  mailPermissions.push(
    new aws.iam.RolePolicy(`${name}-mail`, {
      role: taskRole.id,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["ses:SendEmail"],
            Resource: z.string().parse(settings.sesIdentityArn),
            Condition: {
              StringEquals: {
                "ses:FromAddress": z
                  .email()
                  .parse(settings.environment.EMAIL_FROM),
              },
            },
          },
        ],
      }),
    }),
  );
}
function executionRole(suffix: string, secretArns: pulumi.Input<string>[]) {
  const role = new aws.iam.Role(`${name}-${suffix}-execution`, {
    assumeRolePolicy: assumeTask,
    tags,
  });
  const base = new aws.iam.RolePolicyAttachment(`${name}-${suffix}-execution`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
  });
  const policy = new aws.iam.RolePolicy(`${name}-${suffix}-secrets`, {
    role: role.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["secretsmanager:GetSecretValue"],
          Resource: secretArns,
        },
      ],
    }),
  });
  return { role, dependencies: [base, policy] };
}
const apiExecution = executionRole("api", [runtimeSecret.arn]);
const migrationExecution = executionRole("migration", [
  runtimeSecret.arn,
  migrationSecret.arn,
  clickhouse.secret.arn,
]);
const logs = new aws.cloudwatch.LogGroup(name, {
  retentionInDays: production ? 90 : 14,
  tags,
});
const cluster = new aws.ecs.Cluster(name, {
  settings: [{ name: "containerInsights", value: "enabled" }],
  tags,
});
const repository = new awsx.ecr.Repository(name, { forceDelete: !production });
const image = new awsx.ecr.Image(name, {
  repositoryUrl: repository.url,
  context: "..",
  dockerfile: "../Dockerfile",
  platform: "linux/amd64",
});
const environment = Object.entries({
  ...settings.environment,
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3000",
  PUBLIC_URL: `https://${settings.hostname}`,
  TRUST_PROXY: "10.42.0.0/16",
}).map(([key, value]) => ({ name: key, value }));
const containerSecrets = runtimeValues.apply((values) =>
  Object.keys(values).map((key) => ({
    name: key,
    valueFrom: pulumi.interpolate`${runtimeSecret.arn}:${key}::`,
  })),
);
const logConfiguration = {
  logDriver: "awslogs",
  options: {
    "awslogs-group": logs.name,
    "awslogs-region": region,
    "awslogs-stream-prefix": "api",
  },
};
const migration = new awsx.ecs.FargateTaskDefinition(
  `${name}-migration`,
  {
    cpu: "256",
    memory: "512",
    executionRole: { roleArn: migrationExecution.role.arn },
    taskRole: { roleArn: migrationTaskRole.arn },
    container: {
      name: "migrate",
      image: image.imageUri,
      command: ["pnpm", "db:migrate"],
      essential: true,
      environment: [
        ...environment,
        { name: "CLICKHOUSE_MIGRATION_USER", value: "default" },
      ],
      secrets: containerSecrets.apply((values) => [
        ...values,
        {
          name: "DATABASE_MIGRATION_URL",
          valueFrom: pulumi.interpolate`${migrationSecret.arn}:DATABASE_MIGRATION_URL::`,
        },
        {
          name: "DATABASE_TRACE_CONTROL_URL",
          valueFrom: pulumi.interpolate`${migrationSecret.arn}:DATABASE_TRACE_CONTROL_URL::`,
        },
        {
          name: "CLICKHOUSE_MIGRATION_PASSWORD",
          valueFrom: pulumi.interpolate`${clickhouse.secret.arn}:CLICKHOUSE_PASSWORD::`,
        },
      ]),
      logConfiguration: {
        ...logConfiguration,
        options: {
          ...logConfiguration.options,
          "awslogs-stream-prefix": "migration",
        },
      },
    },
  },
  {
    dependsOn: [
      runtimeVersion,
      migrationVersion,
      ...migrationExecution.dependencies,
    ],
  },
);
const migrationGate = new command.local.Command(
  `${name}-migrate`,
  {
    create: "pnpm exec tsx scripts/migrate.ts",
    update: "pnpm exec tsx scripts/migrate.ts",
    environment: {
      AWS_REGION: region,
      MIGRATION_CLUSTER: cluster.arn,
      MIGRATION_TASK_DEFINITION: migration.taskDefinition.arn,
      MIGRATION_SUBNETS: vpc.privateSubnetIds.apply(JSON.stringify),
      MIGRATION_SECURITY_GROUP: taskSecurity.id,
    },
    triggers: [
      image.imageUri,
      migration.taskDefinition.arn,
      runtimeVersion.versionId,
      migrationVersion.versionId,
      clickhouse.bootstrapVersionId,
    ],
  },
  { dependsOn: [db, migration, clickhouse.attachment] },
);

let certificateArn: pulumi.Input<string>;
const certificateDependencies: pulumi.Resource[] = [];
if (settings.certificateArn !== undefined) {
  certificateArn = settings.certificateArn;
} else {
  const certificate = new aws.acm.Certificate(name, {
    domainName: settings.hostname,
    validationMethod: "DNS",
    tags,
  });
  const zoneId = z.string().min(1).parse(settings.hostedZoneId);
  const validation = new aws.route53.Record(`${name}-certificate`, {
    zoneId,
    name: certificate.domainValidationOptions.apply((values) =>
      z.string().parse(values[0]?.resourceRecordName),
    ),
    type: certificate.domainValidationOptions.apply((values) =>
      z.string().parse(values[0]?.resourceRecordType),
    ),
    records: [
      certificate.domainValidationOptions.apply((values) =>
        z.string().parse(values[0]?.resourceRecordValue),
      ),
    ],
    ttl: 60,
  });
  const issued = new aws.acm.CertificateValidation(name, {
    certificateArn: certificate.arn,
    validationRecordFqdns: [validation.fqdn],
  });
  certificateArn = issued.certificateArn;
  certificateDependencies.push(issued);
}
const alb = new awsx.lb.ApplicationLoadBalancer(
  name,
  {
    subnetIds: vpc.publicSubnetIds,
    securityGroups: [albSecurity.id],
    idleTimeout: 120,
    defaultTargetGroup: {
      port: 3000,
      protocol: "HTTP",
      targetType: "ip",
      healthCheck: { path: "/ready", matcher: "200" },
    },
    listeners: [
      {
        port: 443,
        protocol: "HTTPS",
        certificateArn,
        sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      },
      {
        port: 80,
        protocol: "HTTP",
        defaultActions: [
          {
            type: "redirect",
            redirect: {
              port: "443",
              protocol: "HTTPS",
              statusCode: "HTTP_301",
            },
          },
        ],
      },
    ],
    tags,
  },
  { dependsOn: certificateDependencies },
);
const service = new awsx.ecs.FargateService(
  name,
  {
    cluster: cluster.arn,
    desiredCount: production ? 2 : 1,
    networkConfiguration: {
      subnets: vpc.privateSubnetIds,
      securityGroups: [taskSecurity.id],
      assignPublicIp: false,
    },
    healthCheckGracePeriodSeconds: 60,
    deploymentCircuitBreaker: { enable: true, rollback: true },
    continueBeforeSteadyState: false,
    taskDefinitionArgs: {
      cpu: "512",
      memory: "1024",
      executionRole: { roleArn: apiExecution.role.arn },
      taskRole: { roleArn: taskRole.arn },
      container: {
        name: "api",
        image: image.imageUri,
        essential: true,
        environment,
        secrets: containerSecrets,
        portMappings: [
          { containerPort: 3000, targetGroup: alb.defaultTargetGroup },
        ],
        logConfiguration,
      },
    },
    tags,
  },
  {
    dependsOn: [
      migrationGate,
      runtimeVersion,
      ...apiExecution.dependencies,
      ...mailPermissions,
    ],
  },
);
if (settings.hostedZoneId !== undefined) {
  new aws.route53.Record(name, {
    zoneId: settings.hostedZoneId,
    name: settings.hostname,
    type: "A",
    aliases: [
      {
        name: alb.loadBalancer.dnsName,
        zoneId: alb.loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  });
}
const alerts = new aws.sns.Topic(`${name}-alerts`, { tags });
if (settings.alarmEmail !== undefined) {
  new aws.sns.TopicSubscription(`${name}-alerts`, {
    topic: alerts.arn,
    protocol: "email",
    endpoint: settings.alarmEmail,
  });
}
const alarmDefinitions = [
  {
    suffix: "database-storage",
    namespace: "AWS/RDS",
    metricName: "FreeStorageSpace",
    statistic: "Minimum",
    threshold: 2 * 1024 ** 3,
    comparisonOperator: "LessThanThreshold",
    dimensions: { DBInstanceIdentifier: db.identifier },
  },
  {
    suffix: "database-cpu",
    namespace: "AWS/RDS",
    metricName: "CPUUtilization",
    statistic: "Average",
    threshold: 85,
    comparisonOperator: "GreaterThanThreshold",
    dimensions: { DBInstanceIdentifier: db.identifier },
  },
  {
    suffix: "api-cpu",
    namespace: "AWS/ECS",
    metricName: "CPUUtilization",
    statistic: "Average",
    threshold: 85,
    comparisonOperator: "GreaterThanThreshold",
    dimensions: {
      ClusterName: cluster.name,
      ServiceName: service.service.name,
    },
  },
  {
    suffix: "api-errors",
    namespace: "AWS/ApplicationELB",
    metricName: "HTTPCode_Target_5XX_Count",
    statistic: "Sum",
    threshold: 5,
    comparisonOperator: "GreaterThanThreshold",
    dimensions: { LoadBalancer: alb.loadBalancer.arnSuffix },
  },
];
for (const alarm of alarmDefinitions) {
  const { suffix, ...args } = alarm;
  new aws.cloudwatch.MetricAlarm(`${name}-${suffix}`, {
    ...args,
    evaluationPeriods: 2,
    period: 60,
    treatMissingData: "notBreaching",
    alarmActions: [alerts.arn],
    okActions: [alerts.arn],
    tags,
  });
}
const oidcSubject = `repo:${settings.githubRepository}:environment:${settings.stack}`;
const deploymentRole = new aws.iam.Role(`${name}-github`, {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: settings.githubOidcProviderArn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": oidcSubject,
          },
        },
      },
    ],
  }),
  tags,
});
new aws.iam.RolePolicy(`${name}-github`, {
  role: deploymentRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "ec2:*",
          "ecs:*",
          "ecr:*",
          "elasticloadbalancing:*",
          "rds:*",
          "secretsmanager:*",
          "logs:*",
          "cloudwatch:*",
          "sns:*",
          "acm:*",
          "route53:*",
          "tag:GetResources",
        ],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: [
          "iam:GetRole",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:GetRolePolicy",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:PassRole",
        ],
        Resource: `arn:aws:iam::*:role/${name}*`,
      },
      {
        Effect: "Allow",
        Action: ["iam:CreateServiceLinkedRole"],
        Resource: "*",
        Condition: {
          StringEquals: {
            "iam:AWSServiceName": [
              "ecs.amazonaws.com",
              "elasticloadbalancing.amazonaws.com",
              "rds.amazonaws.com",
            ],
          },
        },
      },
    ],
  }),
});
export const url = `https://${settings.hostname}`;
export const loadBalancerDnsName = alb.loadBalancer.dnsName;
export const repositoryUrl = repository.url;
export const clusterArn = cluster.arn;
export const serviceName = service.service.name;
export const githubDeploymentRoleArn = deploymentRole.arn;
export const alarmTopicArn = alerts.arn;

if (!production) {
  const previewRole = new aws.iam.Role(`${name}-github-preview`, {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: settings.githubOidcProviderArn },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub": `repo:${settings.githubRepository}:environment:preview`,
            },
          },
        },
      ],
    }),
    tags,
  });
  new aws.iam.RolePolicyAttachment(`${name}-github-preview`, {
    role: previewRole.name,
    policyArn: aws.iam.ManagedPolicy.ReadOnlyAccess,
  });
}

export const clickhouseInstanceId = clickhouse.instanceId;
export const clickhouseVolumeId = clickhouse.volumeId;
