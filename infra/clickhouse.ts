import { readFileSync } from "node:fs";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const image = "clickhouse/clickhouse-server:26.8.2.7";
const privacy = readFileSync(
  new URL("../packages/traces/config/privacy.xml", import.meta.url),
).toString("base64");

/** A private storage host. The separately managed encrypted data volume survives host replacement. */
export function clickHouseHost(input: {
  name: string;
  securityId: pulumi.Input<string>;
  subnetId: pulumi.Input<string>;
  region: pulumi.Input<string>;
  password: pulumi.Output<string>;
  production: boolean;
  tags: Record<string, string>;
}) {
  const name = `${input.name}-traces`;
  const subnet = aws.ec2.getSubnetOutput({ id: input.subnetId });
  const volume = new aws.ebs.Volume(
    name,
    {
      availabilityZone: subnet.availabilityZone,
      type: "gp3",
      size: 100,
      encrypted: true,
      tags: { ...input.tags, TraceBackup: input.name },
    },
    { protect: input.production },
  );
  const secret = new aws.secretsmanager.Secret(`${name}-bootstrap`, {
    recoveryWindowInDays: input.production ? 30 : 7,
    tags: input.tags,
  });
  const version = new aws.secretsmanager.SecretVersion(`${name}-bootstrap`, {
    secretId: secret.id,
    secretString: input.password.apply((password) =>
      JSON.stringify({ CLICKHOUSE_PASSWORD: password }),
    ),
  });
  const role = new aws.iam.Role(name, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
    tags: input.tags,
  });
  const secretAccess = new aws.iam.RolePolicy(`${name}-bootstrap`, {
    role: role.id,
    policy: secret.arn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue"],
            Resource: [arn],
          },
        ],
      }),
    ),
  });
  new aws.iam.RolePolicyAttachment(`${name}-ssm`, {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });
  const profile = new aws.iam.InstanceProfile(name, { role: role.name });
  const ami = aws.ssm.getParameterOutput({
    name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
  });
  const userData = pulumi
    .all([secret.arn, input.region, volume.id, version.versionId])
    .apply(([arn, region, volumeId, versionId]) =>
      [
        "#!/bin/bash",
        "set -eu",
        "umask 077",
        "dnf install -y docker python3 xfsprogs",
        "systemctl enable --now docker",
        "install -d -m 0700 /etc/agentcommons /var/lib/clickhouse",
        `aws secretsmanager get-secret-value --region ${quote(region)} --secret-id ${quote(arn)} --version-id ${quote(versionId)} --query SecretString --output text > /etc/agentcommons/secret.json`,
        "python3 - <<'PY'",
        "import json",
        "from pathlib import Path",
        "secret=json.loads(Path('/etc/agentcommons/secret.json').read_text())",
        "password=secret['CLICKHOUSE_PASSWORD']",
        "if '\\n' in password or '\\r' in password: raise ValueError('Invalid ClickHouse credential format')",
        "Path('/etc/agentcommons/clickhouse.env').write_text('CLICKHOUSE_USER=default\\nCLICKHOUSE_PASSWORD='+password+'\\nCLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1\\n')",
        "PY",
        "rm /etc/agentcommons/secret.json",
        `printf '%s' ${quote(privacy)} | base64 --decode > /etc/agentcommons/privacy.xml`,
        "chmod 0644 /etc/agentcommons/privacy.xml",
        `volume_serial=${quote(volumeId.replaceAll("-", ""))}`,
        "device=",
        "for attempt in $(seq 1 120); do",
        "  device=$(lsblk -dn -o PATH,SERIAL | awk -v serial=\"$volume_serial\" '$2==serial {print $1;exit}')",
        '  [ -n "$device" ] && break',
        "  sleep 5",
        "done",
        '[ -n "$device" ] || exit 1',
        'if ! blkid "$device" >/dev/null; then mkfs.xfs "$device"; fi',
        'uuid=$(blkid -s UUID -o value "$device")',
        "printf 'UUID=%s /var/lib/clickhouse xfs defaults,nofail 0 2\\n' \"$uuid\" >> /etc/fstab",
        "mount /var/lib/clickhouse",
        "chown 101:101 /var/lib/clickhouse",
        `docker pull ${image}`,
        "cat > /etc/systemd/system/agentcommons-traces.service <<'UNIT'",
        "[Unit]",
        "Description=AgentCommons ClickHouse",
        "Requires=docker.service",
        "After=docker.service network-online.target",
        "RequiresMountsFor=/var/lib/clickhouse",
        "[Service]",
        "Restart=always",
        "RestartSec=5",
        "TimeoutStartSec=0",
        "ExecStartPre=-/usr/bin/docker rm agentcommons-traces",
        `ExecStart=/usr/bin/docker run --name agentcommons-traces --env-file /etc/agentcommons/clickhouse.env --ulimit nofile=262144:262144 -p 8123:8123 -v /var/lib/clickhouse:/var/lib/clickhouse -v /etc/agentcommons/privacy.xml:/etc/clickhouse-server/config.d/privacy.xml:ro ${image}`,
        "ExecStop=/usr/bin/docker stop --time 60 agentcommons-traces",
        "[Install]",
        "WantedBy=multi-user.target",
        "UNIT",
        "systemctl daemon-reload",
        "systemctl enable --now agentcommons-traces",
      ].join("\n"),
    );
  const instance = new aws.ec2.Instance(
    name,
    {
      ami: ami.value,
      instanceType: "t3.large",
      subnetId: input.subnetId,
      associatePublicIpAddress: false,
      vpcSecurityGroupIds: [input.securityId],
      iamInstanceProfile: profile.name,
      metadataOptions: { httpTokens: "required", httpPutResponseHopLimit: 1 },
      rootBlockDevice: { encrypted: true, volumeType: "gp3", volumeSize: 20 },
      userData,
      userDataReplaceOnChange: true,
      tags: input.tags,
    },
    { dependsOn: [secretAccess, version] },
  );
  const attachment = new aws.ec2.VolumeAttachment(
    name,
    {
      deviceName: "/dev/sdf",
      instanceId: instance.id,
      volumeId: volume.id,
      stopInstanceBeforeDetaching: true,
    },
    { deleteBeforeReplace: true },
  );
  const backupRole = new aws.iam.Role(`${name}-backup`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "dlm.amazonaws.com",
    }),
    tags: input.tags,
  });
  const backupPolicy = new aws.iam.RolePolicy(`${name}-backup`, {
    role: backupRole.id,
    policy: volume.arn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "ec2:DescribeVolumes",
              "ec2:DescribeInstances",
              "ec2:DescribeSnapshots",
              "ec2:DescribeSnapshotAttribute",
              "ec2:DescribeSnapshotTierStatus",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: ["ec2:CreateSnapshot"],
            Resource: [arn, "arn:aws:ec2:*:*:snapshot/*"],
          },
          {
            Effect: "Allow",
            Action: ["ec2:DeleteSnapshot"],
            Resource: "arn:aws:ec2:*:*:snapshot/*",
            Condition: {
              StringEquals: { "ec2:ResourceTag/TraceBackup": input.name },
            },
          },
          {
            Effect: "Allow",
            Action: ["ec2:CreateTags"],
            Resource: "arn:aws:ec2:*:*:snapshot/*",
            Condition: {
              StringEquals: { "ec2:CreateAction": "CreateSnapshot" },
            },
          },
        ],
      }),
    ),
  });
  new aws.dlm.LifecyclePolicy(
    `${name}-backup`,
    {
      executionRoleArn: backupRole.arn,
      description: "Daily snapshots of the AgentCommons trace volume",
      state: "ENABLED",
      policyDetails: {
        resourceTypes: ["VOLUME"],
        targetTags: { TraceBackup: input.name },
        schedules: [
          {
            name: "daily",
            copyTags: true,
            createRule: {
              interval: 24,
              intervalUnit: "HOURS",
              times: "03:00",
            },
            retainRule: { count: input.production ? 35 : 7 },
          },
        ],
      },
      tags: input.tags,
    },
    { dependsOn: [backupPolicy] },
  );
  return {
    url: pulumi.interpolate`http://${instance.privateIp}:8123`,
    instanceId: instance.id,
    volumeId: volume.id,
    bootstrapVersionId: version.versionId,
    secret,
    attachment,
  };
}
