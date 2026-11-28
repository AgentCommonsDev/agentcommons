import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { liveHarnesses } from "../scripts/live-harnesses.js";

// Paid native providers are opt-in; the nightly/adapter workflow runs this exact test.
// @req R-HRN-08 @req R-MCP-07 @req R-MCP-10
it.runIf(process.env.LIVE_HARNESS_CANARY === "1")(
  "ingests every live native session, displays them in the dashboard, lets an agent find them through MCP, and sees each MCP-capable harness use the tools natively",
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
              harness: z.enum([
                "CLAUDE_CODE",
                "CODEX",
                "GEMINI_CLI",
                "PI",
                "OPENCODE",
              ]),
              session_id: z.uuid(),
              rest_search: z.literal(true),
              rest_get: z.literal(true),
              mcp_search: z.literal(true),
              mcp_get: z.literal(true),
              dashboard: z.literal(true),
            }),
          )
          .length(liveHarnesses.length),
        agent_mcp: z.object({
          passed: z.literal(true),
          completed_calls: z.number().min(8),
        }),
        // Each hooked native session completed search, get, sql and dashboard_render
        // through the installed registration (pi through the extension's tool bridge).
        native_tools: z
          .array(
            z.object({
              harness: z.enum([
                "CLAUDE_CODE",
                "CODEX",
                "GEMINI_CLI",
                "PI",
                "OPENCODE",
              ]),
              supported: z.literal(true),
              passed: z.literal(true),
              session_id: z.uuid(),
              tool_errors: z.array(z.unknown()).length(0),
              audit_errors: z.array(z.unknown()).length(0),
            }),
          )
          .length(liveHarnesses.length),
        // Organic recall (R-MCP-10): an ordinary task made each MCP-capable harness search
        // before writing, find the decision session, and restore its value.
        organic_recall: z
          .array(
            z.object({
              harness: z.enum([
                "CLAUDE_CODE",
                "CODEX",
                "GEMINI_CLI",
                "OPENCODE",
              ]),
              supported: z.literal(true),
              passed: z.literal(true),
              task_session_id: z.uuid(),
              searched_before_write: z.literal(true),
              search_found_decision: z.literal(true),
            }),
          )
          .length(liveHarnesses.filter((item) => item.recall).length),
      })
      .parse(
        JSON.parse(await readFile(resolve(output, "report.json"), "utf8")),
      );
    const harnesses = new Set(liveHarnesses.map((item) => item.harness)).size;
    expect(new Set(report.harnesses.map((item) => item.harness)).size).toBe(
      harnesses,
    );
    expect(new Set(report.harnesses.map((item) => item.session_id)).size).toBe(
      liveHarnesses.length,
    );
    expect(new Set(report.native_tools.map((item) => item.harness)).size).toBe(
      harnesses,
    );
  },
  70 * 60_000,
);
