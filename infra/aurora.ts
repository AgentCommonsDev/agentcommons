import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { type AlarmDefinition, metricAlarms } from "./shared.js";

/** The Aurora Serverless v2 variant of the single-node database setting. */
interface AuroraSettings {
  minCapacity: number;
  maxCapacity: number;
  engineVersion: string;
  forceSsl: boolean;
}

/**
 * One Aurora PostgreSQL Serverless v2 cluster with a single writer for the single-node
 * deployment (ADR 0063). It lives in the host's VPC and admits 5432 only from the host's
 * security group; the host, its migration task and the local ClickHouse reach it over
 * TLS at the cluster endpoint. The master credential is the stack's migration password,
 * rendered into the same SSM parameters as every other `.env` value, so the host needs
 * no Secrets Manager access and the bundled and managed shapes share one bootstrap.
 */
export function auroraDatabase(input: {
  name: string;
  tags: Record<string, string>;
  settings: AuroraSettings;
  vpcId: pulumi.Input<string>;
  subnetIds: pulumi.Input<pulumi.Input<string>[]>;
  /** The writer is placed in the host's availability zone to keep reads intra-AZ. */
  availabilityZone: pulumi.Input<string>;
  hostSecurityGroupId: pulumi.Input<string>;
  masterUsername: string;
  masterPassword: pulumi.Output<string>;
  alerts: aws.sns.Topic;
}) {
  const { name, tags, settings } = input;
  const major = settings.engineVersion.split(".")[0] ?? settings.engineVersion;
  const subnetGroup = new aws.rds.SubnetGroup(`${name}-database`, {
    subnetIds: input.subnetIds,
    description: "AgentCommons control database: the host's VPC subnets",
    tags,
  });
  const security = new aws.ec2.SecurityGroup(`${name}-database`, {
    vpcId: input.vpcId,
    description: "AgentCommons control database: PostgreSQL from the host only",
    ingress: [
      {
        protocol: "tcp",
        fromPort: 5432,
        toPort: 5432,
        securityGroups: [input.hostSecurityGroupId],
        description: "PostgreSQL from the AgentCommons host",
      },
    ],
    egress: [],
    tags,
  });
  // TLS posture is explicit data: the rendered URLs say sslmode=require and the cluster
  // refuses plaintext, unless forceSsl=false selects the documented fallback.
  const parameters = new aws.rds.ClusterParameterGroup(`${name}-database`, {
    family: `aurora-postgresql${major}`,
    description: "AgentCommons control database",
    parameters: [
      {
        name: "rds.force_ssl",
        value: settings.forceSsl ? "1" : "0",
        applyMethod: "immediate",
      },
    ],
    tags,
  });
  const cluster = new aws.rds.Cluster(
    `${name}-database`,
    {
      engine: "aurora-postgresql",
      engineMode: "provisioned",
      engineVersion: settings.engineVersion,
      databaseName: "agentcommons",
      masterUsername: input.masterUsername,
      masterPassword: input.masterPassword,
      dbSubnetGroupName: subnetGroup.name,
      dbClusterParameterGroupName: parameters.name,
      vpcSecurityGroupIds: [security.id],
      serverlessv2ScalingConfiguration: {
        minCapacity: settings.minCapacity,
        maxCapacity: settings.maxCapacity,
      },
      storageEncrypted: true,
      backupRetentionPeriod: 7,
      preferredBackupWindow: "09:00-10:00",
      preferredMaintenanceWindow: "sun:10:00-sun:11:00",
      copyTagsToSnapshot: true,
      deletionProtection: true,
      skipFinalSnapshot: false,
      finalSnapshotIdentifier: `${name}-database-final`,
      applyImmediately: false,
      enabledCloudwatchLogsExports: ["postgresql"],
      // A new cluster includes the host's zone so the writer can sit next to it; RDS adds
      // two more zones, which would otherwise show as a replacement on every update.
      availabilityZones: pulumi
        .output(input.availabilityZone)
        .apply((zone) => [zone]),
      tags,
    },
    { protect: true, ignoreChanges: ["availabilityZones"] },
  );
  const writer = new aws.rds.ClusterInstance(`${name}-database`, {
    clusterIdentifier: cluster.id,
    instanceClass: "db.serverless",
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: cluster.engineVersion,
    // Intra-AZ when the cluster's zones allow it; a cluster created before the host's zone
    // was part of the set lets RDS choose instead of failing the instance.
    availabilityZone: pulumi
      .all([cluster.availabilityZones, input.availabilityZone])
      .apply(([zones, zone]) => (zones.includes(zone) ? zone : undefined)),
    dbSubnetGroupName: subnetGroup.name,
    publiclyAccessible: false,
    autoMinorVersionUpgrade: true,
    applyImmediately: false,
    performanceInsightsEnabled: true,
    performanceInsightsRetentionPeriod: 7,
    tags,
  });
  const dimensions = { DBInstanceIdentifier: writer.identifier };
  const alarms: AlarmDefinition[] = [
    {
      suffix: "database-cpu",
      namespace: "AWS/RDS",
      metricName: "CPUUtilization",
      statistic: "Average",
      threshold: 80,
      comparisonOperator: "GreaterThanThreshold",
      period: 300,
      evaluationPeriods: 3,
      treatMissingData: "notBreaching",
      description: "Control database CPU above 80% for 15 minutes",
    },
    {
      suffix: "database-capacity",
      namespace: "AWS/RDS",
      metricName: "ACUUtilization",
      statistic: "Average",
      threshold: 90,
      comparisonOperator: "GreaterThanThreshold",
      period: 300,
      evaluationPeriods: 3,
      treatMissingData: "notBreaching",
      description: `Control database at more than 90% of its ${String(settings.maxCapacity)} ACU ceiling for 15 minutes; raise database.maxCapacity`,
    },
    {
      suffix: "database-memory",
      namespace: "AWS/RDS",
      metricName: "FreeableMemory",
      statistic: "Minimum",
      threshold: 256 * 1024 ** 2,
      comparisonOperator: "LessThanThreshold",
      period: 300,
      evaluationPeriods: 2,
      treatMissingData: "notBreaching",
      description:
        "Control database freeable memory below 256 MiB for 10 minutes",
    },
    {
      suffix: "database-connections",
      namespace: "AWS/RDS",
      metricName: "DatabaseConnections",
      statistic: "Maximum",
      threshold: 150,
      comparisonOperator: "GreaterThanThreshold",
      period: 300,
      evaluationPeriods: 2,
      treatMissingData: "notBreaching",
      description:
        "Control database above 150 connections for 10 minutes (API pool, pg-boss and ClickHouse dictionary pools together stay far below)",
    },
  ];
  metricAlarms(
    name,
    tags,
    input.alerts,
    alarms.map((alarm) => ({ ...alarm, dimensions })),
  );
  return {
    endpoint: cluster.endpoint,
    port: cluster.port.apply(String),
    clusterIdentifier: cluster.clusterIdentifier,
    writerIdentifier: writer.identifier,
  };
}
