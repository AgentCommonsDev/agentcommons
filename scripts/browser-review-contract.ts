import { z } from "zod";

export const browserReviewCases = [
  "initial_access",
  "search_transcript",
  "sql",
  "keys",
  "organization_switch",
  "administration",
  "responsive_layout",
  "browser_errors",
] as const;
export const browserReviewSchema = z.strictObject({
  checks: z
    .array(
      z.strictObject({
        id: z.enum(browserReviewCases),
        passed: z.boolean(),
        evidence: z.string().min(16),
      }),
    )
    .length(browserReviewCases.length),
  findings: z.array(
    z.strictObject({
      severity: z.enum(["blocking", "nonblocking"]),
      route: z.string().min(1),
      description: z.string().min(16),
      steps: z.array(z.string().min(1)).min(1),
    }),
  ),
});
const blockSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().optional(),
});
const eventSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  message: z.looseObject({ content: z.array(blockSchema) }).optional(),
  structured_output: z.unknown().optional(),
});

/** Captured Claude stream-json events; count completed calls, not claims. */
export function nativeAgentEvidence(source: string, prefix: string) {
  const calls = new Map<string, string>();
  const completed = new Set<string>();
  let result: z.infer<typeof eventSchema> | undefined;
  for (const line of source
    .split("\n")
    .filter((line) => line.trim().length > 0)) {
    const event = eventSchema.parse(JSON.parse(line));
    for (const block of event.message?.content ?? []) {
      if (
        block.type === "tool_use" &&
        block.id &&
        block.name?.startsWith(prefix)
      )
        calls.set(block.id, block.name.slice(prefix.length));
      if (
        block.type === "tool_result" &&
        block.tool_use_id &&
        block.is_error !== true
      )
        completed.add(block.tool_use_id);
    }
    if (event.type === "result") result = event;
  }
  if (!result || result.subtype !== "success" || result.is_error !== false)
    throw new Error("The native review agent did not finish successfully.");
  const tools = [...calls]
    .filter(([id]) => completed.has(id))
    .map(([, name]) => name);
  return { tools, output: result.structured_output };
}

export const agentBrowserEvidence = (source: string) =>
  nativeAgentEvidence(source, "mcp__browser__");

export function validateBrowserReview(source: string) {
  const evidence = agentBrowserEvidence(source);
  const report = browserReviewSchema.parse(evidence.output);
  if (
    new Set(report.checks.map((check) => check.id)).size !==
    browserReviewCases.length
  )
    throw new Error("The browser review omitted or repeated a required flow.");
  for (const tool of [
    "browser_navigate",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_network_requests",
  ])
    if (!evidence.tools.includes(tool))
      throw new Error(`The browser review lacks a completed ${tool} call.`);
  if (evidence.tools.length < 12)
    throw new Error(
      "The browser review lacks enough completed browser interactions.",
    );
  return { ...report, completed_browser_calls: evidence.tools.length };
}
