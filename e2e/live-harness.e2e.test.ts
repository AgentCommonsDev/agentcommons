import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

// Paid native providers are opt-in; the nightly/adapter workflow runs this exact test.
// @req R-HRN-08
it.runIf(process.env.LIVE_HARNESS_CANARY === "1")(
  "ingests all four live native sessions, displays them in the dashboard, and lets an agent find them through MCP",
  async () => {
    const output = resolve(
      process.env.CANARY_OUTPUT ?? "test-results/live-canary",
    );
    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/live-canary.ts"],
      {
        env: { ...process.env, CANARY_OUTPUT: output },
        timeout: 65 * 60_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const report = z
      .object({
        passed: z.literal(true),
        harnesses: z
          .array(
            z.object({
              harness: z.enum(["CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"]),
              session_id: z.uuid(),
              rest_search: z.literal(true),
              rest_get: z.literal(true),
              mcp_search: z.literal(true),
              mcp_get: z.literal(true),
              dashboard: z.literal(true),
            }),
          )
          .length(4),
        agent_mcp: z.object({
          passed: z.literal(true),
          completed_calls: z.number().min(8),
        }),
      })
      .parse(
        JSON.parse(await readFile(resolve(output, "report.json"), "utf8")),
      );
    expect(new Set(report.harnesses.map((item) => item.harness)).size).toBe(4);
    expect(new Set(report.harnesses.map((item) => item.session_id)).size).toBe(
      4,
    );
  },
  70 * 60_000,
);
