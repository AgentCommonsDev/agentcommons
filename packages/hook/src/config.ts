import { join, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import * as z from "zod";
import { readJson } from "./files.js";

/** Any JSON object; the shape harness settings files and stored configuration are read as. */
export const objectSchema = z.record(z.string(), z.unknown());
/** Hosts whose plain-HTTP traffic never leaves the machine: a local development server. */
const loopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);
export const configSchema = z.looseObject({
  // Every request carries the key, and transcripts and the manifest travel over it, so the
  // server is reached over TLS; plain HTTP only to this machine (ADR 0103).
  server: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && loopback(url.hostname)))
    );
  }, "Use an HTTPS server URL without embedded credentials; plain HTTP is accepted only for localhost."),
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
  /**
   * Flags the installer was run with; self-update re-runs `install` with the same ones. Loose
   * because an older installer also recorded the retired `noShellRc` (ADR 0104): a field this
   * bundle no longer reads must not make the configuration unreadable, which would silently
   * stop capture and every later self-update.
   */
  installOptions: z
    .looseObject({ configHome: z.string().min(1).optional() })
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
