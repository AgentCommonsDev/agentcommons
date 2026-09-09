import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";

/** Single-quotes a value for a shell script, escaping embedded quotes. */
export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** ClickHouse names the migration creates; the API gets `runtime`, the migration also `migration`. */
export const traceNames = {
  runtime: {
    CLICKHOUSE_DATABASE: "ac_trace",
    CLICKHOUSE_WRITER_USER: "ac_trace_writer",
    CLICKHOUSE_ACCESS_USER: "ac_trace_access",
  },
  migration: { CLICKHOUSE_MIGRATION_USER: "default" },
} as const;

/** An SNS alert topic with an optional confirmed-by-email subscriber. */
export function alertTopic(
  name: string,
  tags: Record<string, string>,
  email: string | undefined,
) {
  const topic = new aws.sns.Topic(`${name}-alerts`, { tags });
  if (email !== undefined)
    new aws.sns.TopicSubscription(`${name}-alerts`, {
      topic: topic.arn,
      protocol: "email",
      endpoint: email,
    });
  return topic;
}

export type AlarmDefinition = Omit<
  aws.cloudwatch.MetricAlarmArgs,
  "alarmActions" | "okActions" | "alarmDescription" | "tags"
> & {
  suffix: string;
  description?: string;
  /** Extra alarm actions besides the topic, such as EC2 recover or reboot. */
  actions?: pulumi.Input<string>[];
};
/** One CloudWatch alarm per definition, all notifying (and clearing through) the topic. */
export function metricAlarms(
  name: string,
  tags: Record<string, string>,
  topic: aws.sns.Topic,
  alarms: AlarmDefinition[],
) {
  for (const { suffix, description, actions, ...args } of alarms)
    new aws.cloudwatch.MetricAlarm(`${name}-${suffix}`, {
      ...args,
      ...(description === undefined
        ? {}
        : { alarmDescription: `${name}: ${description}` }),
      alarmActions: [topic.arn, ...(actions ?? [])],
      okActions: [topic.arn],
      tags,
    });
}

/**
 * A DLM role and one daily 03:00 snapshot schedule over the tagged resources.
 * `grant` attaches the role's snapshot permissions and returns that resource.
 */
export function dailySnapshots(
  name: string,
  tags: Record<string, string>,
  input: {
    description: string;
    resourceTypes: string[];
    targetTags: Record<string, string>;
    retain: number;
    grant: (role: aws.iam.Role) => pulumi.Resource;
  },
) {
  const role = new aws.iam.Role(`${name}-backup`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "dlm.amazonaws.com",
    }),
    tags,
  });
  const granted = input.grant(role);
  return new aws.dlm.LifecyclePolicy(
    `${name}-backup`,
    {
      executionRoleArn: role.arn,
      description: input.description,
      state: "ENABLED",
      policyDetails: {
        resourceTypes: input.resourceTypes,
        targetTags: input.targetTags,
        schedules: [
          {
            name: "daily",
            copyTags: true,
            createRule: { interval: 24, intervalUnit: "HOURS", times: "03:00" },
            retainRule: { count: input.retain },
          },
        ],
      },
      tags,
    },
    { dependsOn: [granted] },
  );
}

/** An EC2 instance role with managed policies (by attachment suffix) and its profile. */
export function ec2InstanceRole(
  name: string,
  tags: Record<string, string>,
  managedPolicies: Record<string, pulumi.Input<string>>,
) {
  const role = new aws.iam.Role(name, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
    tags,
  });
  const attachments = Object.entries(managedPolicies).map(
    ([suffix, policyArn]) =>
      new aws.iam.RolePolicyAttachment(`${name}-${suffix}`, {
        role: role.name,
        policyArn,
      }),
  );
  const profile = new aws.iam.InstanceProfile(name, { role: role.name });
  return { role, profile, attachments };
}

/** Trust policy letting one GitHub Actions subject assume a role through OIDC. */
export function githubTrust(providerArn: string, subject: string) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: providerArn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": subject,
          },
        },
      },
    ],
  });
}
