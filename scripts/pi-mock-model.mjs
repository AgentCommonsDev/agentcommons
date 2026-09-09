// Credential-free OpenAI-compatible chat completions server for the pi live canary.
// It replays a fixed tool-using script so the real pi harness, extension, shim and API
// are exercised deterministically. Usage: node scripts/pi-mock-model.mjs [port]
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const port = Number(process.argv[2] ?? "3299");
// A real model takes seconds before its first commit; keep the commit at least one
// reflog second after session start so start/end git observations stay distinct.
const commitDelayMs = Number(process.env.PI_MOCK_COMMIT_DELAY_MS ?? "1200");
const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("")
      : "";
function plan(messages) {
  let user = -1;
  for (let index = messages.length - 1; index >= 0; index--)
    if (messages[index].role === "user") {
      user = index;
      break;
    }
  const prompt = user >= 0 ? textOf(messages[user].content) : "";
  const results = messages
    .slice(user + 1)
    .filter((message) => message.role === "tool")
    .map((message) => textOf(message.content));
  const step = results.length;
  const marker = /acprobe\w+/.exec(prompt)?.[0] ?? "acprobe";
  const call = (name, args) => ({ tool: { name, args } });
  // The native MCP tool stage (scripts/live-harnesses.ts nativeToolPrompt) names the
  // bridge tools in the prompt; the script follows the prompt and the returned data.
  const mcp =
    /1\) Call (\S+) with query "(.+?)"\. 2\) Call (\S+) with .*?3\) Call (\S+) with sql: (.+?)\. 4\) Call (\S+), then call (\S+) with id/s.exec(
      prompt,
    );
  if (mcp) {
    const [, search, query, get, sql, statement, list, render] = mcp;
    const uuid = (text) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(
        text,
      )?.[0] ?? "";
    switch (step) {
      case 0:
        return call(search, { query });
      case 1:
        return call(get, {
          session_id: uuid(
            /session_id: (\S+)/.exec(results[0] ?? "")?.[1] ?? "",
          ),
        });
      case 2:
        return call(sql, { sql: statement });
      case 3:
        return call(list, {});
      case 4:
        return call(render, {
          id: uuid(
            /"default_id"\s*:\s*"([^"]+)"/.exec(results[3] ?? "")?.[1] ?? "",
          ),
        });
      default:
        return {
          text: `read session ${uuid(results[1] ?? "")}\nharness counts:\n${(results[2] ?? "").trim()}\ndashboard tiles: ${String((results[4] ?? "").match(/"id"\s*:\s*"/g)?.length ?? 0)}`,
        };
    }
  }
  if (prompt.includes("Do these steps in order")) {
    switch (step) {
      case 0:
        return {
          thinking: "Read probe.txt first, then inspect git state.",
          ...call("read", { path: "probe.txt" }),
        };
      case 1:
        return call("bash", { command: "git status --short" });
      case 2:
        return call("read", { path: "notes.txt" });
      case 3:
        return call("edit", {
          path: "notes.txt",
          oldText: "Canary notes.",
          newText: `Canary notes.\nAgentCommons canary note ${marker}`,
        });
      case 4:
        return {
          delayMs: commitDelayMs,
          ...call("bash", {
            command:
              'git add notes.txt && git commit -q -m "test: pi canary note" && git rev-parse HEAD',
          }),
        };
      default:
        return {
          text: `probe.txt: ${results[0]?.trim() ?? ""}\nnotes.txt: Canary notes.\nAgentCommons canary note ${marker}\ncommit: ${(results[4] ?? "").trim().split("\n").at(-1) ?? ""}`,
        };
    }
  }
  const exact = /Reply with exactly:\s*(.+)$/s.exec(prompt);
  return { text: exact ? exact[1].trim() : "OK." };
}
createServer((request, response) => {
  if (
    request.method !== "POST" ||
    !request.url?.endsWith("/chat/completions")
  ) {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const outcome = plan(parsed.messages ?? []);
    setTimeout(
      () => respond(response, parsed, body, outcome),
      outcome.delayMs ?? 0,
    );
  });
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `pi mock model listening on http://127.0.0.1:${String(port)}/v1\n`,
  );
});
function respond(response, parsed, body, outcome) {
  {
    const id = `chatcmpl-${randomBytes(6).toString("hex")}`;
    const base = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: parsed.model,
    };
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.write(chunk({ role: "assistant", content: "" }));
    if (outcome.thinking)
      response.write(chunk({ reasoning_content: outcome.thinking }));
    if (outcome.tool) {
      response.write(
        chunk({
          tool_calls: [
            {
              index: 0,
              id: `call_${randomBytes(8).toString("hex")}`,
              type: "function",
              function: {
                name: outcome.tool.name,
                arguments: JSON.stringify(outcome.tool.args),
              },
            },
          ],
        }),
      );
      response.write(chunk({}, "tool_calls"));
    } else {
      response.write(chunk({ content: outcome.text }));
      response.write(chunk({}, "stop"));
    }
    const completion = JSON.stringify(outcome).length;
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: body.length, completion_tokens: completion, total_tokens: body.length + completion } })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  }
}
