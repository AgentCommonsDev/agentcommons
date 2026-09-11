import { readFile } from "node:fs/promises";
import { updaterStateSchema } from "@agentcommons/core";
import type { PrismaClient } from "@agentcommons/db";
import type { TraceRepository } from "@agentcommons/traces";
import { z } from "zod";

type UpdaterState = z.infer<typeof updaterStateSchema>;
const integerText = z.coerce.number().int().nonnegative();
/**
 * The host updater's `KEY=VALUE` state file (`scripts/self-host/lib.sh` `record_state`),
 * as `/admin/status` reports it. Null when the file is absent (the directory is not
 * mounted, or no timer has run yet) or unreadable; an empty value reads as null and a
 * value the schema rejects (a hand-edited file) is dropped rather than failing the read,
 * so a damaged file still shows the fields it does carry.
 */
export async function readUpdaterState(
  path: string,
): Promise<UpdaterState | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0)
      values.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  const field = (key: string, schema: z.ZodType<string>) => {
    const value = values.get(key);
    if (!value) return null;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const dateSchema = updaterStateSchema.shape.last_check.unwrap();
  const textSchema = updaterStateSchema.shape.last_result.unwrap();
  const failures = integerText.safeParse(values.get("failures") ?? "0");
  return updaterStateSchema.parse({
    last_check: field("last_check", dateSchema),
    last_ok: field("last_ok", dateSchema),
    last_result: field("last_result", textSchema),
    last_image: field("last_image", textSchema),
    previous_image: field("previous_image", textSchema),
    updated_at: field("updated_at", dateSchema),
    failed_image: field("failed_image", textSchema),
    failed_at: field("failed_at", dateSchema),
    failures: failures.success ? failures.data : 0,
  });
}
export class HealthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly traces: Pick<TraceRepository, "ready">,
  ) {}
  health() {
    return { status: "ok" } as const;
  }
  async ready(): Promise<{ status: "ok" | "unavailable" }> {
    try {
      const [, ready] = await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.traces.ready(),
      ]);
      return { status: ready ? "ok" : "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }
}
