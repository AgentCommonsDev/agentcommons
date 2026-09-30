import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { createInterface } from "node:readline";
import type { HookConfig } from "./config.js";

/**
 * The stdio↔HTTP MCP bridge (`hook.js mcp`, ADR 0089). Codex 0.154 offers no literal-token or
 * `--header` option for a streamable-HTTP MCP server, only an environment-variable reference
 * that a GUI/IDE launch (a Codex started with no shell that sourced the exports) cannot
 * satisfy. Codex does support a per-server `env` table for a *stdio* server, so the installer
 * registers `agentcommons` for Codex as `node hook.js mcp` with the literal key in that table.
 * This mode is that bridge.
 *
 * It is a transparent pipe. It reads the client's JSON-RPC messages from stdin (newline
 * delimited, the MCP stdio framing — a message carries no embedded newline), forwards each to
 * the server's streamable-HTTP `/mcp` endpoint with `Authorization: Bearer <key>`, and writes
 * the server's responses (a single JSON body, or an SSE stream of one or more messages) back to
 * stdout. The client drives the MCP protocol; the bridge never interprets it beyond routing a
 * response to the request that owes one.
 *
 * Zero runtime dependencies: only Node built-ins, so it never enlarges hook.js past its budget.
 */

/** `node:http`/`node:https` `request`, narrowed to the three-argument form the bridge uses. */
type Requester = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

/** A message's id when it is a request (a response is owed); a notification or batch has none. */
function requestId(message: string): string | number | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const id = (parsed as { id?: unknown }).id;
      if (typeof id === "string" || typeof id === "number") return id;
    }
  } catch {
    /* Not a single JSON object (a batch, or malformed): no synthetic error is owed. */
  }
  return null;
}

/** Writes one JSON-RPC message to stdout as a single newline-delimited line (MCP stdio framing). */
function writeMessage(raw: string): void {
  let line: string;
  try {
    line = JSON.stringify(JSON.parse(raw) as unknown);
  } catch {
    // Not parseable as one object: still guarantee the framing by stripping any newline.
    line = raw.replace(/\r?\n/g, " ");
  }
  process.stdout.write(`${line}\n`);
}

/** The server's `Mcp-Session-Id`, echoed on later requests; null for a stateless server. */
interface Session {
  id: string | null;
}

function collectBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      text += chunk;
    });
    response.on("end", () => {
      resolve(text);
    });
    response.on("error", reject);
  });
}

/** Relays a `text/event-stream` body: each SSE event's `data` lines become one stdout message. */
function relayEventStream(response: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let data: string[] = [];
    const flush = (): void => {
      if (data.length) {
        writeMessage(data.join("\n"));
        data = [];
      }
    };
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      buffer += chunk;
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          flush(); // A blank line ends one SSE event.
          continue;
        }
        if (line.startsWith(":")) continue; // A comment line.
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") data.push(value);
      }
    });
    response.on("end", () => {
      flush();
      resolve();
    });
    response.on("error", reject);
  });
}

/** Forwards one client message to `/mcp` and relays whatever the server returns to stdout. */
function forward(
  endpoint: URL,
  key: string,
  session: Session,
  message: string,
  send: Requester,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`,
      "content-length": String(Buffer.byteLength(message)),
    };
    if (session.id) headers["mcp-session-id"] = session.id;
    const request = send(endpoint, { method: "POST", headers }, (response) => {
      const issued = response.headers["mcp-session-id"];
      if (typeof issued === "string" && issued) session.id = issued;
      const status = response.statusCode ?? 0;
      const contentType = response.headers["content-type"] ?? "";
      if (status === 202 || status === 204) {
        // Accepted with no body: a notification or response the client owes no reply for.
        response.resume();
        response.on("end", () => {
          resolve();
        });
        response.on("error", reject);
        return;
      }
      if (contentType.includes("text/event-stream")) {
        relayEventStream(response).then(resolve, reject);
        return;
      }
      collectBody(response).then((text) => {
        if (text.trim()) writeMessage(text.trim());
        resolve();
      }, reject);
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => {
      request.destroy(new Error("the request timed out"));
    });
    request.end(message);
  });
}

interface McpBridgeOptions {
  /** Injected in tests; the bridge picks `node:http`/`node:https` by protocol otherwise. */
  send?: Requester;
  input?: NodeJS.ReadableStream;
}

/**
 * Runs the bridge until stdin closes. Messages are forwarded in the order the client sent them,
 * and each response is written before the next message is forwarded, so responses stay ordered
 * even for a server that streams. A forward that fails answers a request with a JSON-RPC error
 * so the client is never left waiting; a failed notification is dropped.
 */
export async function runMcpBridge(
  config: HookConfig,
  options: McpBridgeOptions = {},
): Promise<void> {
  const endpoint = new URL("/mcp", config.server);
  const send: Requester =
    options.send ??
    ((url, requestOptions, callback) =>
      (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        requestOptions,
        callback,
      ));
  const session: Session = { id: null };
  let chain: Promise<void> = Promise.resolve();
  const relay = createInterface({
    input: options.input ?? process.stdin,
    crlfDelay: Infinity,
  });
  relay.on("line", (raw) => {
    const message = raw.trim();
    if (!message) return;
    chain = chain.then(async () => {
      try {
        await forward(endpoint, config.key, session, message, send);
      } catch (error) {
        const id = requestId(message);
        if (id !== null)
          writeMessage(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32000,
                message: `AgentCommons MCP bridge: ${error instanceof Error ? error.message : "request failed"}`,
              },
            }),
          );
      }
    });
  });
  await new Promise<void>((resolve) => relay.once("close", resolve));
  await chain;
}
