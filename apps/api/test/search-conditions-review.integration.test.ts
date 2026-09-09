import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cleanup } from "../../../scripts/cleanup.js";
import { SearchService } from "../src/services/search.js";
import { PolicyService } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { provisionOrganization } from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let search: SearchService;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  org = await provisionOrganization(db, "conditions-review");
  const dependencies = {
    ...db,
    readers: db.traceReaders,
    cursors: new CursorCodec("condition-review-cursor"),
  };
  search = new SearchService(dependencies);
  const native = traceServices(db);
  release.unshift(() => native.jobs.stop());
  await native.publish(org.context, {
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    installationId: randomUUID(),
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    sentAt: new Date().toISOString(),
    sourcePos: 0,
    cursor: "initial",
    end: null,
    context: {
      cwd: "/review",
      installation: {
        hostname: "review",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        key: randomUUID(),
        sourceVersion: 0,
        line: JSON.stringify({
          type: "assistant",
          uuid: randomUUID(),
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "review-call",
                name: "Search",
                input: { needle: "literal-search-marker" },
              },
            ],
          },
        }),
      },
    ],
  });
  await new PolicyService({ ...dependencies, cache: db.policies }).save(
    org.owner,
    null,
    {
      name: "search-audit-structure",
      kind: "REGEX",
      flags: "g",
      enabled: true,
      pattern:
        "(?:field|op|path|value|tool_input|eq|needle|literal-search-marker|unrecognized)",
    },
  );
}, 120_000);
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});

// @req R-SRCH-13 @req R-AUD-03
it("keeps declared condition syntax in the actual search audit while redacting parameter paths and values", async () => {
  const result = await search.execute(org.context, {
    query: "",
    context: 0,
    filters: {
      where: [
        {
          field: "tool_input",
          path: ["needle"],
          op: "eq",
          value: "literal-search-marker",
        },
      ],
    },
  });
  expect(result.result.blocks).toHaveLength(1);
  const row = await db.prisma.auditEvent.findUniqueOrThrow({
    where: { id: result.audit.id },
  });
  expect(row.detail).toMatchObject({
    input: {
      filters: {
        where: [
          {
            field: "tool_input",
            op: "eq",
            path: ["[REDACTED:search-audit-structure]"],
            value: "[REDACTED:search-audit-structure]",
          },
        ],
      },
    },
  });
  expect(JSON.stringify(row.detail)).not.toContain("literal-search-marker");
});

// @req R-AUD-03
it("does not exempt unknown condition fields, operators or JSON keys in failure-shaped audit inputs", async () => {
  const result = await db.audit.write(org.context, {
    action: "search",
    statusCode: 400,
    detail: {
      input: {
        query: "",
        filters: {
          where: [
            {
              field: "unrecognized",
              op: "unrecognized",
              path: ["needle"],
              value: "literal-search-marker",
              unrecognized: "needle",
            },
          ],
        },
      },
    },
  });
  const row = await db.prisma.auditEvent.findUniqueOrThrow({
    where: { id: result.id },
  });
  const detail = JSON.stringify(row.detail);
  for (const secret of ["unrecognized", "needle", "literal-search-marker"])
    expect(detail).not.toContain(secret);
  expect(detail).toContain("[REDACTED:search-audit-structure]");
});
