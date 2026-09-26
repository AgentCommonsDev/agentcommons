import { join, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import * as z from "zod";
import { readJson } from "./files.js";

/** Any JSON object; the shape harness settings files and stored configuration are read as. */
export const objectSchema = z.record(z.string(), z.unknown());
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
  /** Flags the installer was run with; self-update re-runs `install` with the same ones. */
  installOptions: z
    .strictObject({
      configHome: z.string().min(1).optional(),
      noShellRc: z.boolean().optional(),
    })
    .optional(),
});
export type HookConfig = z.infer<typeof configSchema>;
export function loadConfig(directory: string): HookConfig {
  return configSchema.parse({
    ...readJson(join(directory, "config.json"), objectSchema),
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
