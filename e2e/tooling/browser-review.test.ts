import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  agentBrowserEvidence,
  browserReviewCases,
  validateBrowserReview,
} from "../../scripts/browser-review-contract.js";

// @req R-DASH-07
it("reads completed browser calls from a live agent stream and rejects incomplete review claims", async () => {
  const source = await readFile(
    new URL("../../fixtures/contracts/browser-agent.jsonl", import.meta.url),
    "utf8",
  );
  const evidence = agentBrowserEvidence(source);
  expect(evidence).toEqual({
    tools: ["browser_navigate", "browser_snapshot"],
    output: { heading: "Give your next agent a place to start." },
  });
  expect(() => validateBrowserReview(source)).toThrow();
  expect(() =>
    agentBrowserEvidence(
      source
        .split("\n")
        .filter((line) => !line.includes('"type":"result"'))
        .join("\n"),
    ),
  ).toThrow("did not finish");

  const report = {
    checks: browserReviewCases.map((id) => ({
      id,
      passed: true,
      evidence: "A concrete observed browser interaction.",
    })),
    findings: [],
  };
  const tools = [
    "browser_navigate",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_network_requests",
    ...Array.from({ length: 8 }, () => "browser_click"),
  ];
  const stream = (denied = false, output: unknown = report) =>
    [
      ...tools.flatMap((name, index) => [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: String(index),
                name: `mcp__browser__${name}`,
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: String(index),
                is_error: denied,
              },
            ],
          },
        },
      ]),
      {
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: output,
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
  expect(validateBrowserReview(stream()).completed_browser_calls).toBe(12);
  expect(() => validateBrowserReview(stream(true))).toThrow(
    "completed browser_navigate",
  );
  expect(() =>
    validateBrowserReview(
      stream(false, {
        ...report,
        checks: Array.from({ length: 8 }, () => report.checks[0]),
      }),
    ),
  ).toThrow("omitted or repeated");
});
