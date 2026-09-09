import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ingestEnvelopeSchema,
  type IngestEnvelope,
} from "@agentcommons/core/schemas/ingest";
import { hash } from "../src/files.js";
import type { CliHarness, NativeHook } from "../src/harnesses.js";
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
