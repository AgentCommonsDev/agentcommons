import * as pulumi from "@pulumi/pulumi";
import { fixtureSecretConfig, record, resourceQueries } from "./mocks.js";

export { fixtureSecrets } from "./mocks.js";
export const googleSecret = "google-client-secret-fixture";
const resources: pulumi.runtime.MockResourceArgs[] = [];
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
    ...fixtureSecretConfig,
    ...extraConfig,
  });
  return { mocksReady };
}
export const { find, all } = resourceQueries(resources);
