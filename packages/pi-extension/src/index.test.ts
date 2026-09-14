import { agentInstructions } from "@agentcommons/core/format/install";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  spawn: vi.fn(),
  write: vi.fn(),
  unref: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: child.spawn }));
import extension, {
  MCP_TOOL_PREFIX,
  enforceToolCall,
  hostVersion,
} from "./index.js";
import { writeAtomic, jsonFiles } from "../../hook/src/files.js";
import { policyCachePath, violationDir } from "../../hook/src/policy.js";
import type { ToolCallEvent } from "@mariozechner/pi-coding-agent";

const HOST = "@mariozechner/pi-coding-agent";
function fakeHost(root: string, version: string): string {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: HOST, version }),
  );
  writeFileSync(join(root, "dist", "cli.js"), "");
  return join(root, "dist", "cli.js");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
// @req R-HRN-05
it("reads the host package version from the CLI entry or an SDK host's dependency tree only", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-pi-host-"));
  expect(hostVersion(fakeHost(join(directory, "cli"), "9.9.9"))).toBe("9.9.9");
  const sdk = join(directory, "sdk");
  mkdirSync(join(sdk, "app"), { recursive: true });
  writeFileSync(join(sdk, "app", "run.mjs"), "");
  fakeHost(join(sdk, "node_modules", ...HOST.split("/")), "8.8.8");
  expect(hostVersion(join(sdk, "app", "run.mjs"))).toBe("8.8.8");
  const other = join(directory, "other");
  mkdirSync(join(other, "dist"), { recursive: true });
  writeFileSync(join(other, "dist", "cli.js"), "");
  writeFileSync(
    join(other, "package.json"),
    JSON.stringify({ name: "something-else", version: "1.0.0" }),
  );
  expect(hostVersion(join(other, "dist", "cli.js"))).toBeNull();
  expect(hostVersion(join(directory, "missing.js"))).toBeNull();
  expect(hostVersion(undefined)).toBeNull();
});
// @req R-HRN-05
// @req R-INST-06
it("adds the global guidance to the system prompt, observes six native events, transports leaf changes, resume reasons and host metadata, and returns no host mutation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-pi-extension-"));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({ node: process.execPath }),
  );
  vi.stubEnv("AGENTCOMMONS_DIR", directory);
  // The extension reads the running host once; point the main script at a fake CLI.
  process.argv[1] = fakeHost(join(directory, "host"), "0.73.1");
  const stdin = Object.assign(new EventEmitter(), { end: child.write });
  child.spawn.mockImplementation(() =>
    Object.assign(new EventEmitter(), { stdin, unref: child.unref }),
  );
  const callbacks = new Map<
    string,
    (event: { reason?: string }, context: ExtensionContext) => unknown
  >();
  const api = {
    on: (
      name: string,
      callback: (
        event: { reason?: string },
        context: ExtensionContext,
      ) => unknown,
    ) => callbacks.set(name, callback),
  } as unknown as ExtensionAPI;
  await extension(api);
  expect([...callbacks.keys()]).toEqual([
    "before_agent_start",
    "tool_call",
    "session_start",
    "input",
    "tool_result",
    "agent_end",
    "session_tree",
    "session_shutdown",
  ]);
  // The tool_call handler is enforcement, not capture: with no cached policy it allows and
  // spawns nothing. Removed here so the lifecycle loop below counts only the six observers.
  callbacks.delete("tool_call");
  // The guidance block joins pi's system prompt; nothing else about the prompt changes.
  const prompt = callbacks.get("before_agent_start");
  expect(
    prompt?.(
      { systemPrompt: "host prompt" } as unknown as { reason?: string },
      {} as ExtensionContext,
    ),
  ).toEqual({ systemPrompt: `host prompt\n\n${agentInstructions}` });
  callbacks.delete("before_agent_start");
  let leaf = "previous-leaf";
  const context = {
    cwd: directory,
    hasUI: true,
    sessionManager: {
      getSessionId: () => "native-session",
      getSessionFile: () => join(directory, "native.jsonl"),
      getLeafId: () => leaf,
    },
  } as unknown as ExtensionContext;
  for (const [name, callback] of callbacks) {
    if (name === "session_tree") leaf = "new-leaf";
    expect(
      callback(
        { ...(name === "session_start" ? { reason: "resume" } : {}) },
        context,
      ),
    ).toBeUndefined();
  }
  expect(child.spawn).toHaveBeenCalledTimes(6);
  expect(child.unref).toHaveBeenCalledTimes(6);
  const payloads: unknown[] = child.write.mock.calls.map(
    (call: unknown[]) =>
      JSON.parse(typeof call[0] === "string" ? call[0] : "null") as unknown,
  );
  expect(payloads[0]).toMatchObject({
    hook_event_name: "session_start",
    reason: "resume",
    activeLeafId: "previous-leaf",
    transcript_metadata: {
      harnessVersion: "0.73.1",
      entrypoint: "interactive",
    },
  });
  expect(payloads[4]).toMatchObject({
    hook_event_name: "session_tree",
    activeLeafId: "new-leaf",
  });
  const duplicate = { reason: "resume" };
  callbacks.get("session_start")?.(duplicate, context);
  callbacks.get("session_start")?.(duplicate, context);
  const duplicateCalls: unknown[] = child.write.mock.calls
    .slice(-2)
    .map(
      (call: unknown[]) =>
        JSON.parse(typeof call[0] === "string" ? call[0] : "null") as unknown,
    );
  expect(duplicateCalls[0]).toEqual(duplicateCalls[1]);
  expect(child.spawn).toHaveBeenLastCalledWith(
    process.execPath,
    [join(directory, "hook.js"), "pi"],
    { detached: true, stdio: ["pipe", "ignore", "ignore"] },
  );
  // Print, RPC and SDK hosts expose no UI; the mode is reported without guessing further.
  callbacks.get("agent_end")?.({}, { ...context, hasUI: false });
  const headless: unknown[] = child.write.mock.calls.at(-1) ?? [];
  expect(
    JSON.parse(typeof headless[0] === "string" ? headless[0] : "null"),
  ).toMatchObject({
    hook_event_name: "agent_end",
    transcript_metadata: { harnessVersion: "0.73.1", entrypoint: "headless" },
  });
});

/** A stateless JSON-response MCP endpoint like the AgentCommons server's `/mcp`. */
function mcpServer(
  handle: (
    method: string,
    params: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ) => { status?: number; body: unknown },
): Promise<{ server: Server; url: string; requests: unknown[] }> {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const message = JSON.parse(body) as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      requests.push({ url: request.url, ...message });
      const outcome = handle(message.method, message.params, request.headers);
      response.writeHead(outcome.status ?? 200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify(
          outcome.status && outcome.status >= 400
            ? outcome.body
            : { jsonrpc: "2.0", id: message.id, result: outcome.body },
        ),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${String(port)}`, requests });
    });
  });
}
function bridgeApi() {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const on = vi.fn();
  const api = {
    on,
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
      tools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  return { api, tools, on };
}
const searchSchema = {
  type: "object",
  properties: { query: { type: "string", minLength: 1 } },
  required: ["query"],
  additionalProperties: false,
};
const context = {} as ExtensionContext;

// @req R-MCP-08
it("registers the key's MCP catalog as agentcommons_<tool> natives and forwards calls with the installed key", async () => {
  const listed = await mcpServer((method, params, headers) => {
    if (headers.authorization !== "Bearer ac_test")
      return { status: 401, body: { code: "INVALID_API_KEY", message: "no" } };
    if (method === "tools/list")
      return {
        body: {
          tools: [
            {
              name: "search",
              description:
                "Only use this when the user asks about previous sessions. Search previous coding-agent messages with words and structured filters. Results contain message windows grouped by session; use session_id and seq with get or sql.",
              inputSchema: searchSchema,
              annotations: { readOnlyHint: true },
            },
            {
              name: "get",
              description: "Read a session by session_id.",
              inputSchema: { type: "object", properties: {} },
            },
            { name: "broken" },
          ],
        },
      };
    if (method === "tools/call" && params.name === "search")
      return {
        body: {
          content: [
            {
              type: "text",
              text: "session_id: 01a08350-3c56-7503-909c-d5c2f0c29b2f",
            },
            { type: "image", data: "ignored" },
          ],
          structuredContent: { blocks: [] },
        },
      };
    return {
      body: {
        isError: true,
        content: [
          {
            type: "text",
            text: '{"code":"NOT_FOUND","message":"No such session."}',
          },
        ],
      },
    };
  });
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-pi-bridge-"));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({
      node: process.execPath,
      server: listed.url,
      key: "ac_test",
    }),
  );
  vi.stubEnv("AGENTCOMMONS_DIR", directory);
  const { api, tools } = bridgeApi();
  try {
    await extension(api);
    expect([...tools.keys()]).toEqual([
      `${MCP_TOOL_PREFIX}search`,
      `${MCP_TOOL_PREFIX}get`,
    ]);
    const search = tools.get(`${MCP_TOOL_PREFIX}search`);
    expect(search?.parameters).toEqual(searchSchema);
    expect(search?.description).toContain(
      "Search previous coding-agent messages",
    );
    expect(search?.promptSnippet).toMatch(
      new RegExp(`^${MCP_TOOL_PREFIX}search: Only use this when the user asks`),
    );
    expect(search?.promptSnippet?.length).toBeLessThanOrEqual(200);
    const result = await search?.execute(
      "call-1",
      { query: "acprobe" },
      undefined,
      undefined,
      context,
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "session_id: 01a08350-3c56-7503-909c-d5c2f0c29b2f",
        },
      ],
      details: { blocks: [] },
    });
    expect(listed.requests).toEqual([
      expect.objectContaining({
        url: "/mcp",
        method: "tools/list",
        params: {},
      }),
      expect.objectContaining({
        url: "/mcp",
        method: "tools/call",
        params: { name: "search", arguments: { query: "acprobe" } },
      }),
    ]);
    // MCP tool errors (isError with text) become pi tool failures, never fake output.
    await expect(
      tools
        .get(`${MCP_TOOL_PREFIX}get`)
        ?.execute("call-2", { session_id: "x" }, undefined, undefined, context),
    ).rejects.toThrow("NOT_FOUND");
  } finally {
    listed.server.close();
  }
});

// @req R-MCP-08
it("registers nothing and keeps capture when the server is unreachable or rejects the key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-pi-bridge-"));
  const closed = await mcpServer(() => ({
    status: 401,
    body: { code: "INVALID_API_KEY", message: "The API key is invalid." },
  }));
  closed.server.close();
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({
      node: process.execPath,
      server: closed.url,
      key: "ac_old",
    }),
  );
  vi.stubEnv("AGENTCOMMONS_DIR", directory);
  const unreachable = bridgeApi();
  await extension(unreachable.api);
  expect(unreachable.tools.size).toBe(0);
  expect(unreachable.on).toHaveBeenCalledTimes(8);
  const rejected = await mcpServer(() => ({
    status: 401,
    body: { code: "INVALID_API_KEY", message: "The API key is invalid." },
  }));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({
      node: process.execPath,
      server: rejected.url,
      key: "ac_old",
    }),
  );
  try {
    const denied = bridgeApi();
    await extension(denied.api);
    expect(denied.tools.size).toBe(0);
  } finally {
    rejected.server.close();
  }
  const log = readFileSync(join(directory, "hook.log"), "utf8");
  expect(log).toContain("pi tool bridge registered no AgentCommons tools");
  expect(log).toContain("The API key is invalid.");
  // A host that invalidated its context during the catalog request must not crash.
  const stale = await mcpServer(() => ({
    body: {
      tools: [
        { name: "search", description: "Search.", inputSchema: searchSchema },
      ],
    },
  }));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({ node: process.execPath, server: stale.url, key: "ac_ok" }),
  );
  try {
    const staleApi = {
      on: vi.fn(),
      registerTool: () => {
        throw new Error(
          "This extension ctx is stale after session replacement.",
        );
      },
    } as unknown as ExtensionAPI;
    await expect(extension(staleApi)).resolves.toBeUndefined();
  } finally {
    stale.server.close();
  }
  expect(readFileSync(join(directory, "hook.log"), "utf8")).toContain(
    "pi tool bridge stopped registering AgentCommons tools: This extension ctx is stale",
  );
  // No server or key configured: the lifecycle callbacks still register, no request is made.
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({ node: process.execPath }),
  );
  const capture = bridgeApi();
  await extension(capture.api);
  expect(capture.tools.size).toBe(0);
  expect(capture.on).toHaveBeenCalledTimes(8);
});

/** A fake pi ExtensionContext for enforcement tests: records notifications, gives a session id. */
function fakeContext(notify: (message: string, type?: string) => void) {
  return {
    ui: { notify },
    hasUI: true,
    cwd: "/tmp/repo",
    sessionManager: { getSessionId: () => "pi-session" },
  } as unknown as ExtensionContext;
}
const bashCall = (command: string): ToolCallEvent =>
  ({
    type: "tool_call",
    toolCallId: "call_1",
    toolName: "bash",
    input: { command },
  }) as unknown as ToolCallEvent;

// @req R-POL-04 @req R-POL-06
it("enforces the tool policy in pi's tool_call handler: block, notify-and-allow, allow, and offline", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-pi-policy-"));
  vi.stubEnv("AGENTCOMMONS_DIR", directory);
  const policy = {
    v: 1,
    fetchedAt: Date.now(),
    revision: 1,
    policy: {
      enabled: true,
      rules: [
        {
          id: "deny-me",
          description: "Denied by test policy.",
          harnesses: [],
          tool: "*",
          command_patterns: [{ kind: "substring", value: "DENYME" }],
          action: "deny",
          severity: "critical",
        },
        {
          id: "warn-me",
          description: "Warned by test policy.",
          harnesses: [],
          tool: "*",
          command_patterns: [{ kind: "substring", value: "WARNME" }],
          action: "warn",
          severity: "medium",
        },
      ],
    },
  };
  // No cache yet: everything is allowed.
  expect(
    enforceToolCall(bashCall("echo DENYME"), fakeContext(vi.fn())),
  ).toBeUndefined();

  writeAtomic(policyCachePath(directory), policy);
  // Deny blocks in-process with the reason.
  expect(
    enforceToolCall(bashCall("echo DENYME"), fakeContext(vi.fn())),
  ).toEqual({
    block: true,
    reason: "Denied by test policy.",
  });
  // Warn lets the tool run and notifies the user (pi has no model channel).
  const notify = vi.fn();
  expect(
    enforceToolCall(bashCall("echo WARNME"), fakeContext(notify)),
  ).toBeUndefined();
  expect(notify).toHaveBeenCalledWith("Warned by test policy.", "warning");
  // A clean command runs, no notification.
  const quiet = vi.fn();
  expect(
    enforceToolCall(bashCall("echo fine"), fakeContext(quiet)),
  ).toBeUndefined();
  expect(quiet).not.toHaveBeenCalled();
  // Only the block was spooled: a warn runs and the server projects it from the transcript,
  // so spooling it here would double-count it (deny-only telemetry).
  expect(jsonFiles(violationDir(directory))).toHaveLength(1);

  // The global disable switch turns enforcement off even with a matching deny rule.
  vi.stubEnv("AGENTCOMMONS_DISABLE", "1");
  expect(
    enforceToolCall(bashCall("echo DENYME"), fakeContext(vi.fn())),
  ).toBeUndefined();
});
