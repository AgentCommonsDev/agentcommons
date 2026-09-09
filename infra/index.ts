import { readSecrets, readSettings } from "./config.js";
import { fargateStack } from "./fargate.js";
import { singleNodeStack } from "./single-node.js";

/**
 * One program, two deployment shapes selected by stack config `deployment`: `fargate`
 * (default; stacks dev/prod) or `single-node` (one Compose host). Pulumi invokes the
 * default export and publishes its return value as the stack outputs, so each shape
 * exports only the outputs it has.
 */
export default function program() {
  const settings = readSettings();
  const secrets = readSecrets();
  return settings.deployment === "single-node"
    ? singleNodeStack(settings, secrets)
    : fargateStack(settings, secrets);
}
