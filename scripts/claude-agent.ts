import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { runNative } from "./live-harnesses.js";

/**
 * One headless Claude Code run confined to the given MCP servers: no settings, no
 * built-in tools, no session persistence, structured output validated against `schema`.
 * The stream-json events are written to a private log in `directory` and returned so
 * the caller can count completed calls (`nativeAgentEvidence`) rather than trust claims.
 * The installed AgentCommons hook is disabled for the agent's own session.
 */
export async function runClaudeAgent(input: {
  directory: string;
  mcpServers: Record<string, unknown>;
  allowedTools: string;
  schema: z.ZodType;
  prompt: string;
  timeoutMs?: number;
}) {
  const config = join(input.directory, "agent-mcp.json");
  await writeFile(config, JSON.stringify({ mcpServers: input.mcpServers }), {
    mode: 0o600,
  });
  const log = join(input.directory, "agent-events.jsonl");
  await runNative(
    "claude",
    [
      "--print",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      config,
      "--tools",
      "",
      "--allowedTools",
      input.allowedTools,
      "--permission-mode",
      "dontAsk",
      "--effort",
      "high",
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      JSON.stringify(z.toJSONSchema(input.schema, { target: "draft-7" })),
    ],
    {
      cwd: input.directory,
      env: { ...process.env, AGENTCOMMONS_DISABLE: "1" },
      log,
      input: input.prompt,
      ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
    },
  );
  return readFile(log, "utf8");
}
