import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import * as z from "zod";

export const configSchema = z.looseObject({
  server: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      ["http:", "https:"].includes(url.protocol)
    );
  }, "Use an HTTP or HTTPS server URL without embedded credentials."),
  key: z.string().min(1),
  installationId: z.uuid(),
  node: z.string().min(1),
  organizationId: z.string().nullable().default(null),
  credentialHash: z.string().nullable().default(null),
  realtime: z.boolean().default(true),
  syncIntervalSeconds: z.number().int().min(1).max(3600).default(10),
  syncBytesThreshold: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024)
    .default(65536),
  disabledPaths: z.array(z.string()).default([]),
});
export type HookConfig = z.infer<typeof configSchema>;
export function dataDirectory(): string {
  return process.env.AGENTCOMMONS_DIR
    ? resolve(process.env.AGENTCOMMONS_DIR)
    : join(homedir(), ".agentcommons");
}
export function loadConfig(directory: string): HookConfig {
  const input: unknown = JSON.parse(
    readFileSync(join(directory, "config.json"), "utf8"),
  );
  const stored = configSchema.parse(input);
  return configSchema.parse({
    ...stored,
    ...(process.env.AGENTCOMMONS_SERVER
      ? { server: process.env.AGENTCOMMONS_SERVER }
      : {}),
    ...(process.env.AGENTCOMMONS_API_KEY
      ? { key: process.env.AGENTCOMMONS_API_KEY }
      : {}),
  });
}
export function disabled(config: HookConfig, cwd: string): boolean {
  if (process.env.AGENTCOMMONS_DISABLE === "1") return true;
  const canonical = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  const path = canonical(cwd);
  return config.disabledPaths.some((entry) => {
    const prefix = canonical(entry);
    return (
      path === prefix ||
      path.startsWith(prefix.endsWith(sep) ? prefix : prefix + sep)
    );
  });
}
