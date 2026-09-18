import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema, type HookConfig } from "../src/config.js";
import { runMcpBridge } from "../src/mcp-bridge.js";

const KEY = "ac_bridge_test_key";

function makeConfig(server: string): HookConfig {
  return configSchema.parse({
    server,
    key: KEY,
    installationId: "019939c0-0000-7000-8000-000000000009",
    node: process.execPath,
  });
}

interface Captured {
  method: string;
  url: string;
  authorization: string | undefined;
  accept: string | undefined;
  body: string;
}
interface Fake {
  url: string;
  requests: Captured[];
  close: () => Promise<void>;
}
type Handler = (
  request: IncomingMessage,
  body: string,
  response: ServerResponse,
) => void;

async function startServer(handle: Handler): Promise<Fake> {
  const requests: Captured[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        accept: request.headers.accept,
        body,
      });
      handle(request, body, response);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/** Runs the bridge over the given client messages, capturing what it writes to stdout. */
async function run(config: HookConfig, messages: string[]): Promise<string[]> {
  const written: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      written.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
  const input = new Readable({ read() {} });
  input.push(messages.map((message) => `${message}\n`).join(""));
  input.push(null);
  try {
    await runMcpBridge(config, { input });
  } finally {
    spy.mockRestore();
  }
  // Only the bridge's own JSON-RPC lines, guarding against any incidental stdout writes.
  return written
    .map((line) => line.replace(/\n$/, ""))
    .filter((line) => line.startsWith("{"));
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  const [first] = items;
  if (first === undefined) throw new Error("no item captured");
  return first;
}

describe("MCP stdio↔HTTP bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // @req R-INST-02
  it("forwards a request to /mcp with the bearer key and relays the JSON response", async () => {
    const fake = await startServer((_request, body, response) => {
      const id = (JSON.parse(body) as { id: number }).id;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }),
      );
    });
    const output = await run(makeConfig(fake.url), [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    ]);
    await fake.close();
    const request = only(fake.requests);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/mcp");
    expect(request.authorization).toBe(`Bearer ${KEY}`);
    expect(request.accept).toContain("text/event-stream");
    expect(JSON.parse(request.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(JSON.parse(only(output))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  // @req R-INST-02
  it("relays each message of an SSE (text/event-stream) response as its own stdout line", async () => {
    const first = { jsonrpc: "2.0", id: 2, result: { step: 1 } };
    const second = { jsonrpc: "2.0", method: "notifications/progress" };
    const fake = await startServer((_request, _body, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: message\ndata: ${JSON.stringify(first)}\n\n`);
      response.write(`data: ${JSON.stringify(second)}\n\n`);
      response.end();
    });
    const output = await run(makeConfig(fake.url), [
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call" }),
    ]);
    await fake.close();
    expect(output.map((line) => JSON.parse(line) as unknown)).toEqual([
      first,
      second,
    ]);
  });

  // @req R-INST-02
  it("writes nothing for a 202 with no body (a notification the client owes no reply)", async () => {
    const fake = await startServer((_request, _body, response) => {
      response.writeHead(202).end();
    });
    const output = await run(makeConfig(fake.url), [
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ]);
    await fake.close();
    expect(fake.requests).toHaveLength(1);
    expect(output).toEqual([]);
  });

  // @req R-INST-02
  it("answers a request with a JSON-RPC error when the server connection fails", async () => {
    const fake = await startServer((_request, _body, response) => {
      response.destroy(); // The client sees the connection drop mid-request.
    });
    const output = await run(makeConfig(fake.url), [
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
    ]);
    await fake.close();
    const message = JSON.parse(only(output)) as {
      id: number;
      error: { code: number; message: string };
    };
    expect(message.id).toBe(7);
    expect(message.error.code).toBe(-32000);
    expect(message.error.message).toContain("AgentCommons MCP bridge");
  });
});
