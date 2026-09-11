import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as schemas from "./index.js";
import {
  callerContextSchema,
  fileOperationSchema,
  utf8ByteLength,
} from "./common.js";
import {
  contentCursorSchema,
  getInputSchema,
  getOutputSchema,
  messageSchema,
  sessionHeaderSchema,
} from "./get.js";
import { ingestEnvelopeSchema } from "./ingest.js";
import {
  createSearchInputSchema,
  searchBlockSchema,
  searchConditionToolSchema,
  searchFilterKeys,
  searchFiltersSchema,
  searchInputSchema,
  searchMessageSchema,
  searchOutputSchema,
  searchToolInputSchema,
} from "./search.js";
import { traceViewCatalog } from "../schema-catalog.js";
import { sqlInputSchema, sqlOutputSchema } from "./sql.js";
import { keyCreateInputSchema, memberAddInputSchema } from "./admin.js";

const sessionId = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55";
const timestamp = "2026-08-01T00:00:00Z";
describe("shared search contract", () => {
  // @req R-SRCH-03 @req R-SRCH-04
  it("accepts scalars and nonempty arrays for the ten basic filters", () => {
    const values = {
      repo_name: "host/org/repo",
      branch: "main",
      user_email: "person@example.com",
      tool_name: "Read",
      file_prefix: "src/",
      file_operation: "edit",
      role: "USER",
      session_id: sessionId,
      since: timestamp,
      until: "2026-09-01T00:00:00Z",
    };
    expect(searchFiltersSchema.parse(values)).toEqual(values);
    const arrays = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, [value]]),
    );
    expect(searchFiltersSchema.parse(arrays)).toEqual(arrays);
    for (const key of Object.keys(values))
      expect(searchFiltersSchema.safeParse({ [key]: [] }).success).toBe(false);
    for (const role of ["user", "DEVELOPER", "TOOL_USE"]) {
      expect(searchFiltersSchema.safeParse({ role }).success).toBe(false);
      expect(
        searchFiltersSchema.safeParse({ role: ["USER", role] }).success,
      ).toBe(false);
    }
  });
  // @req R-SRCH-03 @req R-SRCH-14
  it("accepts only the recorded file operations", () => {
    expect(fileOperationSchema.options).toEqual([
      "read",
      "edit",
      "write",
      "delete",
    ]);
    expect(
      searchFiltersSchema.parse({ file_operation: ["read", "write"] }),
    ).toEqual({ file_operation: ["read", "write"] });
    for (const file_operation of ["Read", "create", "search", ""]) {
      expect(searchFiltersSchema.safeParse({ file_operation }).success).toBe(
        false,
      );
      expect(
        searchFiltersSchema.safeParse({
          file_operation: ["edit", file_operation],
        }).success,
      ).toBe(false);
    }
  });
  // @req R-SRCH-03
  it("rejects unknown filters with the valid key list", () => {
    const result = searchFiltersSchema.safeParse({ repository: "repo" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain(
        "repo_name, branch, user_email, ingest_api_key_id, tool_name, file_prefix, file_operation, role, session_id, since, until",
      );
  });
  // @req R-SRCH-14
  it("describes every search and get field once, in the schema", () => {
    const described = (schema: z.ZodObject<Record<string, z.ZodType>>) =>
      Object.entries(schema.shape).map(([key, field]) => ({
        key,
        description: z.string().optional().parse(field.description),
      }));
    for (const [name, schema] of Object.entries({
      searchInputSchema,
      searchFiltersSchema,
      searchBlockSchema,
      searchMessageSchema,
      searchOutputSchema,
      getInputSchema,
      sessionHeaderSchema,
      messageSchema,
      getOutputSchema,
    }))
      for (const { key, description } of described(schema))
        expect(description ?? "", `${name}.${key}`).toMatch(/\S/);
    // The catalog rendering keeps every filter meaning while collapsing the four condition
    // variants into one object; anything it advertises still parses under the strict schema.
    for (const [key, field] of Object.entries(searchToolInputSchema.shape))
      expect(field.description ?? "", `tool.${key}`).toMatch(/\S/);
    expect(
      Object.keys(searchToolInputSchema.shape.filters.def.innerType.shape),
    ).toEqual(searchFilterKeys);
    for (const condition of [
      { field: "tool_name", op: "contains", value: "Rea" },
      { field: "tool_input", op: "exists", path: ["file_path"] },
      { field: "tool_input", op: "eq", path: ["limit"], value: 3 },
    ]) {
      expect(searchConditionToolSchema.safeParse(condition).success).toBe(true);
      expect(
        searchFiltersSchema.safeParse({ where: [condition] }).success,
        JSON.stringify(condition),
      ).toBe(true);
    }
    // The catalog is the one source for column meanings, so `schema_columns` and the tool schemas agree.
    expect(sessionHeaderSchema.shape.file_count.description).toBe(
      traceViewCatalog.sessions.columns.file_count,
    );
    expect(searchBlockSchema.shape.repo_name.description).toBe(
      traceViewCatalog.sessions.columns.repo_name,
    );
    const json = z.toJSONSchema(searchInputSchema, { io: "input" });
    const filters = z
      .object({
        properties: z.object({
          filters: z.object({
            properties: z.record(
              z.string(),
              z.object({ description: z.string().min(1) }),
            ),
          }),
        }),
      })
      .parse(json);
    expect(Object.keys(filters.properties.filters.properties)).toEqual(
      searchFilterKeys,
    );
  });
  it("requires UTC bounds on scalar and array values", () => {
    for (const since of [
      "2026-08-01",
      "2026-08-01T01:00:00+01:00",
      "invalid",
    ]) {
      expect(searchFiltersSchema.safeParse({ since }).success).toBe(false);
      expect(
        searchFiltersSchema.safeParse({ since: [timestamp, since] }).success,
      ).toBe(false);
    }
  });
  it("validates defaults, bounds, empty queries, and transport-independent cursors", () => {
    expect(searchInputSchema.parse({ query: "test" })).toMatchObject({
      limit: 5,
      context: 1,
      filters: {},
      cursor: null,
    });
    expect(
      createSearchInputSchema({ context: 0, limit: 10 }).parse({
        query: "test",
      }),
    ).toMatchObject({ context: 0, limit: 10 });
    expect(() => createSearchInputSchema({ context: 4, limit: 5 })).toThrow();
    expect(searchInputSchema.safeParse({ query: " " }).success).toBe(false);
    expect(
      searchInputSchema.parse({
        query: "",
        filters: { role: "USER" },
        cursor: "opaque-query-bound-cursor",
      }).cursor,
    ).toBe("opaque-query-bound-cursor");
    for (const input of [
      { query: "x", limit: 51 },
      { query: "x", limit: 0 },
      { query: "x", context: 4 },
      { query: "x", context: -1 },
    ])
      expect(searchInputSchema.safeParse(input).success).toBe(false);
  });
});
describe("get and SQL boundaries", () => {
  it("rejects reversed ranges and continuations outside their range", () => {
    expect(
      getInputSchema.parse({
        session_id: sessionId,
        from: 1,
        to: 1,
        cursor: { seq: 1, offset: 4096 },
      }).cursor,
    ).toEqual({ seq: 1, offset: 4096 });
    expect(
      getInputSchema.safeParse({ session_id: sessionId, from: 2, to: 1 })
        .success,
    ).toBe(false);
    expect(
      getInputSchema.safeParse({
        session_id: sessionId,
        from: 2,
        cursor: { seq: 1, offset: 0 },
      }).success,
    ).toBe(false);
    expect(contentCursorSchema.safeParse({ seq: 1, offset: -1 }).success).toBe(
      false,
    );
    expect(
      getInputSchema.safeParse({ session_id: sessionId, cursor: "m1:4096" })
        .success,
    ).toBe(false);
  });
  it("limits SQL by UTF-8 bytes instead of JavaScript characters", () => {
    const sql = "界".repeat(7000);
    expect(utf8ByteLength(sql)).toBe(21000);
    expect(sqlInputSchema.safeParse({ sql }).success).toBe(false);
    expect(sqlInputSchema.safeParse({ sql: "SELECT 1" }).success).toBe(true);
  });
  it("checks row widths, row count, and truncated cell coordinates", () => {
    const result = {
      columns: [{ name: "value", type: "text" }],
      rows: [["value"]],
      row_count: 1,
      capped: false,
      truncated_cells: [[0, 0]],
      duration_ms: 0,
    };
    expect(sqlOutputSchema.parse(result)).toEqual(result);
    for (const patch of [
      { row_count: 2 },
      { rows: [[]] },
      { truncated_cells: [[1, 0]] },
      { truncated_cells: [[0, 1]] },
    ])
      expect(sqlOutputSchema.safeParse({ ...result, ...patch }).success).toBe(
        false,
      );
  });
});
// @req R-ING-01
it("validates v2 envelopes and preserves source lines with source versions", () => {
  const line = JSON.stringify({
    unknown_harness_field: { nested: "preserve me" },
  });
  const envelope = {
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CODEX",
    harnessSessionId: "native",
    behavior: "sync",
    nativeEvent: "Stop",
    batchId: sessionId,
    installationId: sessionId,
    sentAt: timestamp,
    sourcePos: 100,
    context: {
      cwd: "/repo",
      installation: {
        hostname: "workstation",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      activeLeafId: null,
      git: null,
      parentHint: null,
    },
    records: [
      { pos: 0, line },
      { pos: 100, sourceVersion: 2, line },
    ],
    cursor: "0→200",
    end: null,
  };
  const result = ingestEnvelopeSchema.parse(envelope);
  expect(result.records.map((record) => record.sourceVersion)).toEqual([0, 2]);
  expect(result.records[0]?.line).toBe(line);
  expect(
    ingestEnvelopeSchema.safeParse({
      ...envelope,
      records: [...envelope.records].reverse(),
    }).success,
  ).toBe(false);
  expect(
    ingestEnvelopeSchema.safeParse({ ...envelope, envelopeVersion: 1 }).success,
  ).toBe(false);
  for (const field of ["organizationId", "organization_id"])
    expect(
      ingestEnvelopeSchema.safeParse({ ...envelope, [field]: "other-org" })
        .success,
    ).toBe(false);
});
it("uses generated JSON schemas without adding embedding modes or internal ranks", () => {
  const generated = z.toJSONSchema(searchInputSchema, { io: "input" });
  expect(generated.type).toBe("object");
  expect(Object.keys(generated.properties ?? {})).toEqual([
    "query",
    "filters",
    "context",
    "limit",
    "cursor",
  ]);
  expect(generated.additionalProperties).toBe(false);
});
it("rejects unscoped callers, unknown key scopes, and unbounded membership batches", () => {
  const caller = {
    organizationId: "org-a",
    userId: "user-a",
    role: "owner",
    apiKeyId: null,
    authMethod: "cookie",
    permissions: {},
  };
  expect(callerContextSchema.parse(caller)).toEqual(caller);
  expect(
    callerContextSchema.safeParse({ ...caller, organizationId: "" }).success,
  ).toBe(false);
  expect(
    keyCreateInputSchema.safeParse({
      name: "key",
      permissions: { sessions: ["purge"] },
    }).success,
  ).toBe(false);
  expect(
    memberAddInputSchema.safeParse({
      emails: Array.from({ length: 101 }, () => "person@example.com"),
      role: "member",
    }).success,
  ).toBe(false);
});

it("generates every exported boundary schema for OpenAPI and MCP", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    if (schema instanceof z.ZodType) {
      expect(() => z.toJSONSchema(schema, { io: "input" }), name).not.toThrow();
      expect(
        () => z.toJSONSchema(schema, { io: "output" }),
        name,
      ).not.toThrow();
    }
  }
});

// @req R-SRCH-13
it("bounds structured conditions and rejects expressions, invalid paths and incompatible primitive types", () => {
  const valid = {
    field: "tool_input",
    path: ["options", "0", "limit"],
    op: "eq",
    value: 3,
  };
  expect(
    searchInputSchema.parse({ query: "", filters: { where: [valid] } }).filters
      .where,
  ).toEqual([valid]);
  for (const condition of [
    { ...valid, field: "organization_id" },
    { ...valid, field: "tool_name; SELECT 1" },
    { ...valid, op: "regex" },
    { ...valid, path: [] },
    { ...valid, path: Array.from({ length: 9 }, () => "x") },
    { ...valid, path: ["x".repeat(257)] },
    { ...valid, path: ["\0"] },
    { ...valid, value: { nested: true } },
    { ...valid, value: [] },
    { ...valid, value: "\0" },
    { field: "tool_input", op: "exists" },
    { field: "tool_name", op: "eq", value: 3 },
    { field: "tool_name", op: "eq", value: false },
    { field: "tool_name", path: ["query"], op: "exists" },
    { field: "tool_name", op: "contains", value: "" },
    { field: "tool_name", op: "contains", value: "x".repeat(4097) },
    { field: "tool_name", op: "exists", value: "ignored" },
  ])
    expect(
      searchFiltersSchema.safeParse({ where: [condition] }).success,
      JSON.stringify(condition),
    ).toBe(false);
  for (const where of [[], Array.from({ length: 11 }, () => valid)])
    expect(searchFiltersSchema.safeParse({ where }).success).toBe(false);
  for (const value of ["2", 2, true, false, null])
    expect(
      searchFiltersSchema.safeParse({ where: [{ ...valid, value }] }).success,
    ).toBe(true);
});
