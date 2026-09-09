import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import { unwrap } from "./stack-contract.js";

export const fixtureSecrets = {
  databaseMigrationPassword: "migration-password-fixture",
  databaseAppPassword: "application-password-fixture",
  databaseTraceControlPassword: "trace-control-password-fixture",
  clickhouseAdminPassword: "clickhouse-admin-password-fixture",
  clickhouseWriterPassword: "clickhouse-writer-password-fixture",
  clickhouseAccessPassword: "clickhouse-access-password-fixture",
  clickhouseReaderSecret: "clickhouse-reader-principal-secret-fixture",
  betterAuthSecret: "test-only-authentication-secret-at-least-32",
};
export const googleSecret = "google-client-secret-fixture";
const resources: pulumi.runtime.MockResourceArgs[] = [];
const record = z.record(z.string(), z.unknown());
/** Mocks and config for the single-node shape; `extraConfig` selects variants such as the cloud trace store. */
export function singleNodeFixture(extraConfig: Record<string, string> = {}) {
  const mocksReady = pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: `${args.name}-id`,
          state: {
            ...record.parse(args.inputs),
            name: args.name,
            arn: `arn:aws:mock:us-west-2:123456789012:${args.name}`,
            bucket: `${args.name}-bucket`,
            publicIp: "203.0.113.10",
          },
        };
      },
      call(args) {
        const inputs = record.parse(args.inputs);
        switch (args.token) {
          case "aws:ec2/getVpc:getVpc":
            return { ...inputs, id: "vpc-default", cidrBlock: "172.31.0.0/16" };
          case "aws:ec2/getSubnets:getSubnets":
            return { ...inputs, ids: ["subnet-public-b", "subnet-public-a"] };
          case "aws:ssm/getParameter:getParameter":
            return { ...inputs, value: "ami-ubuntu-arm64-fixture" };
          case "aws:index/getRegion:getRegion":
            return { region: "us-west-2" };
          case "aws:index/getCallerIdentity:getCallerIdentity":
            return { accountId: "123456789012" };
          case "aws:kms/getKey:getKey":
            return {
              ...inputs,
              arn: "arn:aws:kms:us-west-2:123456789012:key/ssm-fixture",
            };
          default:
            return inputs;
        }
      },
    },
    "agentcommons",
    "zpghl",
    false,
  );
  pulumi.runtime.setAllConfig({
    ...extraConfig,
    "aws:region": "us-west-2",
    "agentcommons:deployment": "single-node",
    "agentcommons:hostname": "hooks.example.com",
    "agentcommons:alarmEmail": "ops@example.com",
    "agentcommons:environment": JSON.stringify({
      INSTANCE_MODE: "customer",
      AUTH_EMAIL_PASSWORD_ENABLED: "true",
      AUTH_SOCIAL_PROVIDER: "google",
      AUTH_ALLOWED_EMAIL_DOMAINS: "example.com,example.org",
      AUTH_SIGNUP_MODE: "invite",
      EMAIL_TRANSPORT: "none",
      EMBEDDINGS_ENABLED: "false",
    }),
    "agentcommons:applicationSecrets": JSON.stringify({
      AUTH_GOOGLE_CLIENT_ID: "google-client-id-fixture",
      AUTH_GOOGLE_CLIENT_SECRET: googleSecret,
    }),
    ...Object.fromEntries(
      Object.entries(fixtureSecrets).map(([key, value]) => [
        `agentcommons:${key}`,
        value,
      ]),
    ),
  });
  return { mocksReady };
}
export const find = (type: string, suffix = "") => {
  const resource = resources.find(
    (item) => item.type === type && item.name.endsWith(suffix),
  );
  if (resource === undefined)
    throw new Error(`Resource absent: ${type} ${suffix}`);
  return record.parse(unwrap(resource.inputs));
};
export const all = (type: string) =>
  resources
    .filter((item) => item.type === type)
    .map((item) => record.parse(unwrap(item.inputs)));
