import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ingestEnvelopeSchema,
  type IngestEnvelope,
} from "@agentcommons/core/schemas/ingest";
import { hash } from "../src/files.js";
import {
  HARNESSES,
  type CliHarness,
  type NativeHook,
} from "../src/harnesses.js";
import { recordHook } from "../src/hook.js";
import { configure } from "../src/install.js";

const ORGANIZATION = "019939c0-0000-7000-8000-000000000001";
/** Stands in for the installed bundle; the uploader only digests it for the envelope's hook identity. */
export const SHIM = "/nonexistent-test-shim.js";
interface FixtureOptions {
  harness?: CliHarness;
  transcriptName?: string;
  initial?: string;
  /** Extra `configure` input. The default carries a verified organization, so drains skip `/api/v1/me`. */
  config?: Record<string, unknown>;
}
/**
 * An isolated config home whose harness MCP files carry the installer's `agentcommons`
 * entry (`ok`), one with an unexpanded env placeholder, or none at all, as `configure`
 * input (`installOptions.configHome`). Hint tests pass it so the shim's registration check
 * (§6.2 repair notice) never reads the real home of the machine running the tests.
 */
export function wiredConfigHome(
  directory: string,
  status: "ok" | "placeholder" | "missing" = "ok",
  server = "http://127.0.0.1:3000",
): { installOptions: { configHome: string } } {
  const configHome = join(directory, `home-${status}`);
  mkdirSync(configHome, { recursive: true });
  if (status !== "missing") {
    const key = status === "ok" ? "test" : "${AGENTCOMMONS_API_KEY}";
    const url = `${server}/mcp`;
    writeFileSync(
      join(configHome, ".claude.json"),
      JSON.stringify({
        mcpServers: { agentcommons: HARNESSES.claude.mcp(url, key) },
      }),
    );
    mkdirSync(join(configHome, ".gemini"), { recursive: true });
    writeFileSync(
      join(configHome, ".gemini", "settings.json"),
      JSON.stringify({
        mcpServers: { agentcommons: HARNESSES.gemini.mcp(url, key) },
      }),
    );
    mkdirSync(join(configHome, ".codex"), { recursive: true });
    // Codex's `agentcommons` is a stdio bridge (ADR 0089); the registration check only looks
    // for the server's presence in the TOML, so a representative stdio entry is enough here.
    writeFileSync(
      join(configHome, ".codex", "config.toml"),
      [
        "[mcp_servers.agentcommons]",
        'command = "node"',
        'args = ["hook.js", "mcp"]',
        "",
        "[mcp_servers.agentcommons.env]",
        `AGENTCOMMONS_API_KEY = ${JSON.stringify(key)}`,
        `AGENTCOMMONS_SERVER = ${JSON.stringify(server)}`,
        "",
      ].join("\n"),
    );
  }
  return { installOptions: { configHome } };
}
/** A data directory, a configured installation, one seeded transcript and an accepting server. */
export function fixture(options: FixtureOptions = {}) {
  const harness = options.harness ?? "claude";
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-hook-"));
  const input: Record<string, unknown> = {
    server: "http://127.0.0.1:3000",
    key: "test",
    ...options.config,
  };
  const config = configure(directory, {
    organizationId: ORGANIZATION,
    credentialHash: typeof input.key === "string" ? hash(input.key) : null,
    ...input,
  });
  const transcript = join(
    directory,
    options.transcriptName ?? "transcript.jsonl",
  );
  writeFileSync(transcript, options.initial ?? '{"uuid":"one"}\n');
  const event = {
    session_id: randomUUID(),
    transcript_path: transcript,
    cwd: directory,
    hook_event_name: "Stop",
  };
  /** Records one native event of this session (`overrides` win over the base event) and returns its state path. */
  const hook = (overrides: Partial<NativeHook> = {}): string => {
    const path = recordHook(directory, SHIM, config, harness, {
      ...event,
      ...overrides,
    });
    if (!path) throw new Error("Missing state.");
    return path;
  };
  const received: IngestEnvelope[] = [];
  const fetcher = stubFetch((body) => {
    received.push(body);
    return new Response(null, { status: 202 });
  }, config.organizationId ?? ORGANIZATION);
  return { directory, config, transcript, event, hook, received, fetcher };
}
/** Answers `/api/v1/me` with the organization and hands every ingest POST to `handle`. */
export function stubFetch(
  handle: (body: IngestEnvelope) => Response | Promise<Response>,
  organizationId: string = ORGANIZATION,
): typeof fetch {
  return async (_url, options) =>
    options?.method !== "POST"
      ? Response.json({ organization: { id: organizationId } })
      : handle(
          ingestEnvelopeSchema.parse(
            JSON.parse(
              typeof options.body === "string" ? options.body : "null",
            ) as unknown,
          ),
        );
}
