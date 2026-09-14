// Real pi driver for the tool/command policy dynamic acceptance test
// (e2e/tool-policy-dynamic.e2e.test.ts). pi has no shell hooks: its extension's
// `tool_call` handler is the veto point, so the only faithful "run pi for real" is to
// drive the real pi SDK session runtime with the shipped `dist/pi-extension.mjs`
// registered, exactly as the live canary does (scripts/live-pi.mjs, scripts/pi-lifecycle.mjs).
//
// A credential-free OpenAI-compatible mock model (mirroring scripts/pi-mock-model.mjs)
// makes the real session attempt one bash tool call — `touch <sentinel>` — so the block is
// observable: with the policy enabled the file must NOT appear and the deny reason must
// reach the model as the tool message; with it disabled the file must appear.
//
// Usage: node tool-policy-pi-driver.mjs <enabled|disabled>
// Emits one JSON line to stdout: { enabled, sentinelPresent, reasonSurfaced }.
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { piLifecycle } from "../../scripts/pi-lifecycle.mjs";

const REASON = "Blocked by the tool-policy dynamic acceptance test.";
const SENTINEL_TOKEN = "TPXBLOCK";
const enabled = process.argv[2] !== "disabled";

const root = fileURLToPath(new URL("../../", import.meta.url));
const extension = join(root, "packages/hook/dist/pi-extension.mjs");
let packageDirectory;
try {
  packageDirectory = dirname(
    dirname(
      fileURLToPath(import.meta.resolve("@mariozechner/pi-coding-agent")),
    ),
  );
} catch {
  packageDirectory = join(root, "node_modules/@mariozechner/pi-coding-agent");
}

const work = mkdtempSync(join(tmpdir(), "agentcommons-tool-policy-pi-"));
const data = join(work, "data");
const sentinelDir = join(work, "sentinel");
mkdirSync(data, { recursive: true, mode: 0o700 });
mkdirSync(sentinelDir, { recursive: true });
const sentinel = join(sentinelDir, `${SENTINEL_TOKEN}_FILE`);
// The extension reads the cache from AGENTCOMMONS_DIR; nothing else is needed for the gate.
writeFileSync(
  join(data, "tool-policy.json"),
  JSON.stringify({
    v: 1,
    fetchedAt: 1,
    revision: 1,
    policy: {
      enabled,
      rules: [
        {
          id: "deny-sentinel",
          description: REASON,
          harnesses: [],
          tool: "*",
          command_patterns: [{ kind: "substring", value: SENTINEL_TOKEN }],
          action: "deny",
          severity: "high",
        },
      ],
    },
  }),
  { mode: 0o600 },
);
process.env.AGENTCOMMONS_DIR = data;

const observedToolMessages = [];
function plan(messages) {
  let user = -1;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user") {
      user = i;
      break;
    }
  const results = messages.slice(user + 1).filter((m) => m.role === "tool");
  for (const message of results)
    observedToolMessages.push(
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((part) => part?.text ?? "").join("")
          : "",
    );
  if (results.length === 0)
    return { tool: { name: "bash", args: { command: `touch ${sentinel}` } } };
  return { text: "done" };
}
const server = createServer((request, response) => {
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
    const parsed = JSON.parse(body);
    const outcome = plan(parsed.messages ?? []);
    const base = {
      id: `chatcmpl-${randomBytes(6).toString("hex")}`,
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
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/v1`;
const modelsJson = {
  providers: {
    mock: {
      baseUrl,
      apiKey: "sk-mock",
      api: "openai-completions",
      models: [
        {
          id: "mock-model",
          api: "openai-completions",
          baseUrl,
          contextWindow: 8192,
          maxTokens: 1024,
        },
      ],
    },
  },
};

const extensionModule = await import(extension);
let error = null;
try {
  await piLifecycle({
    packageDirectory,
    directory: work,
    extension: async (api) => {
      await extensionModule.default(api);
    },
    prompt: `Run: touch ${sentinel}`,
    provider: "mock",
    model: "mock-model",
    tools: ["bash", "read", "edit", "write"],
    modelsJson,
    mode: "prompt",
  });
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
server.close();
const result = {
  enabled,
  sentinelPresent: existsSync(sentinel),
  reasonSurfaced: observedToolMessages.some((text) => text.includes(REASON)),
  error,
};
try {
  rmSync(work, { recursive: true, force: true });
} catch {
  /* best effort */
}
process.stdout.write(`${JSON.stringify(result)}\n`);
