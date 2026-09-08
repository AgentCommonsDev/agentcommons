import { cleanup } from "../../../scripts/cleanup.js";
import { z } from "zod";
import { identityDigest } from "@agentcommons/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { IngestService } from "../src/services/ingest.js";
import type { TraceProjectionService } from "../src/services/trace-projection.js";
import { traceServices } from "./trace-services.js";
import { requireCaller } from "../src/services/context.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { provisionOrganization } from "./support.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let service: IngestService;
let projection: TraceProjectionService;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  org = await provisionOrganization(db, "storage-index");
  const services = traceServices(db);
  release.unshift(() => services.close());
  projection = services.projection;
  service = services.ingest;
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});
async function publish(input: unknown) {
  const accepted = await service.execute(org.context, input);
  const caller = requireCaller(org.context);
  await projection.process(caller.organizationId, accepted.result.sessionId);
  const control = await db.prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: accepted.result.sessionId,
      },
    },
  });
  const row = await db.traces.readSession(
    caller.organizationId,
    control.id,
    control.publishedRevision,
    control.redactionGeneration,
  );
  if (!row) throw new Error("Expected a published native trace.");
  return row;
}
function envelope(
  options: {
    repo?: string;
    branch?: string;
    nativeId?: string;
    tool?: string;
    file?: string;
  } = {},
) {
  return {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: options.nativeId ?? randomUUID(),
    behavior: "start",
    nativeEvent: "SessionStart",
    start: { resume: false },
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: 1,
    context: {
      cwd: "/fixture",
      installation: {
        hostname: "fixture",
        osUser: "fixture",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/fixture",
        remoteUrl: `https://github.com/test/${options.repo ?? "fixture"}.git`,
        branch: options.branch ?? "main",
        head: "abc123",
      },
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        key: randomUUID(),
        line: JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Large metadata fixture" },
              ...(options.tool || options.file
                ? [
                    {
                      type: "tool_use",
                      id: "fixture-tool",
                      name: options.tool ?? "Read",
                      input: { file_path: options.file ?? "/fixture/file.ts" },
                    },
                  ]
                : []),
            ],
          },
        }),
      },
    ],
    cursor: "1",
    end: null,
  };
}
// @req R-ING-02 @req R-ING-15
it("stores full large repository and branch metadata and remains exactly filterable", async () => {
  const repo = `long-${"z".repeat(300_000)}`;
  const branch = `branch-${"q".repeat(300_000)}`;
  const row = await publish(envelope({ repo, branch }));
  expect(row.repo_name).toBe(`github.com/test/${repo}`);
  expect(row.branch).toBe(branch);
  const result = await db.traceReaders.read(
    requireCaller(org.context),
    (client) =>
      client.query(
        "SELECT session_id FROM sessions WHERE repo_name=concat('github.com/test/long-',repeat('z',300000)) AND branch=concat('branch-',repeat('q',300000))",
      ),
  );
  expect(result.rows).toEqual([{ session_id: row.session_id }]);
});
// @req R-ING-02 @req R-ING-08
it.each(["nativeId", "tool", "file"] as const)(
  "retains large %s metadata through native admission and projection",
  async (field) => {
    const value =
      field === "file"
        ? `/fixture/${"d".repeat(300_000)}/file.ts`
        : `${field}-${"n".repeat(300_000)}`;
    const row = await publish(envelope({ [field]: value }));
    if (field === "nativeId")
      expect(row.harness_session_id).toBe(`redacted-${identityDigest(value)}`);
    if (field === "tool") expect(row.tools_used).toContain(value);
    if (field === "file") {
      const result = await db.traceReaders.read(
        requireCaller(org.context),
        (client) =>
          client.query(
            "SELECT path FROM session_files WHERE session_id={id:UUID}",
            { id: row.session_id },
          ),
      );
      expect(result.rows).toEqual([{ path: value.slice("/fixture/".length) }]);
    }
  },
);
// @req R-ING-08 @req R-ORG-06
it("keeps literal digest-looking file names distinct while deduplicating identical complete paths", async () => {
  const names = [
    "plain.ts",
    `redacted-${identityDigest("plain.ts")}`,
    "plain.ts",
  ];
  const input = envelope();
  input.records = names.map((path, index) => ({
    pos: index,
    key: randomUUID(),
    line: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: `read-${String(index)}`,
            name: "Read",
            input: { file_path: `/fixture/${path}` },
          },
        ],
      },
    }),
  }));
  input.sourcePos = names.length;
  const row = await publish(input);
  const result = await db.traceReaders.read(
    requireCaller(org.context),
    (client) =>
      client.query(
        "SELECT path FROM session_files WHERE session_id={id:UUID} ORDER BY path",
        { id: row.session_id },
      ),
  );
  expect(result.rows.map((file) => z.string().parse(file.path))).toEqual(
    [...new Set(names)].sort(),
  );
});
