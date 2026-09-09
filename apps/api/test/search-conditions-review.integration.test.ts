import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { SearchService } from "../src/services/search.js";
import { PolicyService } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { provisionOrganization, releaser } from "./support.js";
import { testEnvelope, toolUseRecord } from "./envelopes.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let search: SearchService;
const { defer, release } = releaser();
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  org = await provisionOrganization(db, "conditions-review");
  const dependencies = {
    ...db,
    readers: db.traceReaders,
    cursors: new CursorCodec("condition-review-cursor"),
  };
  search = new SearchService(dependencies);
  const native = traceServices(db);
  defer(() => native.close());
  await native.publish(
    org.context,
    testEnvelope({
      cursor: "initial",
      context: { cwd: "/review", installation: { hostname: "review" } },
      records: [
        toolUseRecord(0, {
          id: "review-call",
          name: "Search",
          input: { needle: "literal-search-marker" },
        }),
      ],
    }),
  );
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
afterAll(release);

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
