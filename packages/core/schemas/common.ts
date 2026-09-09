import * as z from "zod";
import { traceViewCatalog, type TraceViewName } from "../schema-catalog.js";

export const harnessSchema = /* @__PURE__ */ z.enum([
  "CLAUDE_CODE",
  "CODEX",
  "GEMINI_CLI",
  "PI",
]);
export const messageRoleSchema = /* @__PURE__ */ z.enum([
  "USER",
  "ASSISTANT",
  "TOOL_RESULT",
  "SYSTEM",
]);
export const messageKindSchema = /* @__PURE__ */ z.enum([
  "TEXT",
  "THINKING",
  "TOOL_USE",
  "TOOL_RESULT",
  "META",
]);
export const sessionStatusSchema = /* @__PURE__ */ z.enum([
  "ACTIVE",
  "ENDED",
  "INACTIVE",
]);
export const parentRelationSchema = /* @__PURE__ */ z.enum([
  "SUBAGENT",
  "FORK",
  "SPAWNED",
]);
export const visibilitySchema = /* @__PURE__ */ z.enum(["PUBLIC", "PRIVATE"]);
/** What a tool call did to a file, as normalizers record it in `session_files.ops`. */
export const fileOperationSchema = /* @__PURE__ */ z.enum([
  "read",
  "edit",
  "write",
  "delete",
]);
/** Display units shared by metric rows and dashboard stat tiles. */
export const metricUnitSchema = /* @__PURE__ */ z.enum([
  "count",
  "ratio",
  "seconds",
  "milliseconds",
  "tokens",
  "usd",
]);
export type MetricUnit = z.infer<typeof metricUnitSchema>;
export const organizationRoleSchema = /* @__PURE__ */ z.enum([
  "owner",
  "admin",
  "member",
]);
export const transportSchema = /* @__PURE__ */ z.enum(["rest", "mcp", "web"]);
export const jsonValueSchema = /* @__PURE__ */ z.json();
export const jsonObjectSchema = /* @__PURE__ */ z.record(
  z.string(),
  jsonValueSchema,
);
export const sessionIdSchema = /* @__PURE__ */ z.uuid();
/** Lowercase hex SHA-256 digest, as published in the hook manifest. */
export const sha256Schema = /* @__PURE__ */ z.string().regex(/^[a-f0-9]{64}$/);
export const identityIdSchema = /* @__PURE__ */ z.string().min(1);
export const utcDateTimeSchema = /* @__PURE__ */ z.iso.datetime({
  offset: false,
});
export const nonnegativeIntegerSchema = /* @__PURE__ */ z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const decimalIntegerSchema = /* @__PURE__ */ z.string().regex(/^\d+$/);
export const nullableTextSchema = /* @__PURE__ */ z.string().nullable();
export const emailSchema = /* @__PURE__ */ z.email();
export const reasonSchema = /* @__PURE__ */ z
  .string()
  .trim()
  .min(1, "Enter a reason.");
export const emptySchema = /* @__PURE__ */ z.strictObject({});
export const opaqueCursorSchema = /* @__PURE__ */ z
  .string()
  .min(1)
  .nullable()
  .default(null);
/** Names of the row fields `compactMetadata` shortened to fit the response. */
export const truncatedFieldsSchema = /* @__PURE__ */ z
  .array(z.string())
  .default([])
  .describe("Fields shortened to fit the response");

export function scalarOrArray<T extends z.ZodType>(
  schema: T,
  arrayError: () => string,
) {
  return z.union([schema, z.array(schema).min(1, { error: arrayError })]);
}
const utf8 = /* @__PURE__ */ new TextEncoder();
export function utf8ByteLength(value: string): number {
  return utf8.encode(value).byteLength;
}
/** UTF-8 width of one code point; a lone surrogate encodes as U+FFFD, three bytes, as `TextEncoder` does. */
export function utf8CodePointLength(codePoint: number): number {
  return codePoint < 0x80
    ? 1
    : codePoint < 0x800
      ? 2
      : codePoint < 0x10000
        ? 3
        : 4;
}
/** Bytes of the compact JSON serialization, the size every response budget is measured in. */
export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}
export function byteBoundedString(maximum: number) {
  return z.string().refine((value) => utf8ByteLength(value) <= maximum, {
    error: `Use at most ${String(maximum)} UTF-8 bytes.`,
  });
}
/** Total order on positions, for sorts that cannot subtract bigints. */
export function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** The first item for each distinct key, in input order. */
export function uniqueBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = key(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
/** Byte budgets the read services hold one response to (§7, §8). */
export const responseBytes = {
  /** One REST page or SQL result. */
  page: 256 * 1024,
  /** One search or get result, in both its structured and text forms. */
  read: 32 * 1024,
} as const;
export const keyPermissionsSchema = /* @__PURE__ */ z.strictObject({
  sessions: z.array(z.enum(["ingest", "read"])).optional(),
  admin: z.array(z.literal("*")).optional(),
});
/** Stored key permissions are JSON text; a key created without any is an empty object. */
export function parseKeyPermissions(raw: string | null | undefined) {
  return keyPermissionsSchema.parse(raw ? (JSON.parse(raw) as unknown) : {});
}
export const callerContextSchema = /* @__PURE__ */ z.strictObject({
  organizationId: identityIdSchema,
  userId: identityIdSchema,
  role: organizationRoleSchema,
  apiKeyId: identityIdSchema.nullable(),
  installationId: sessionIdSchema.nullable().optional(),
  toolsEnabled: z.boolean().optional(),
  authMethod: z.enum(["cookie", "key"]),
  permissions: keyPermissionsSchema,
});
export const paginationSchema = /* @__PURE__ */ z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: opaqueCursorSchema,
});
export function createListInputSchema<
  const T extends readonly [string, ...string[]],
>(sortKeys: T) {
  return paginationSchema.extend({
    sort: z.enum(sortKeys).optional(),
    order: z.enum(["asc", "desc"]).default("desc"),
    format: z.enum(["json", "csv"]).default("json"),
  });
}
export const errorSchema = /* @__PURE__ */ z.strictObject({
  code: z.string(),
  message: z.string(),
  position: nonnegativeIntegerSchema.nullable().optional(),
  detail: jsonValueSchema.optional(),
});
/** Route params of every resource addressed by a UUID: sessions, dashboards, installations. */
export const uuidParamsSchema = /* @__PURE__ */ z.strictObject({
  id: sessionIdSchema,
});
export const identityParamsSchema = /* @__PURE__ */ z.strictObject({
  id: identityIdSchema,
});
export function paginatedOutput<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), cursor: opaqueCursorSchema });
}
export type Harness = z.infer<typeof harnessSchema>;
export type JsonValue = z.infer<typeof jsonValueSchema>;
export type CallerContext = z.infer<typeof callerContextSchema>;
export type KeyPermissions = z.infer<typeof keyPermissionsSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageKind = z.infer<typeof messageKindSchema>;

export const normalizerContextSchema = /* @__PURE__ */ z.strictObject({
  activeLeafId: z.string().min(1).nullable().optional(),
  transcriptMetadata: jsonObjectSchema.optional(),
});
export type NormalizerContext = z.infer<typeof normalizerContextSchema>;

/** The catalog meaning of an `api_ro` column, so schema descriptions and `schema_columns` read one text. */
export function catalogDescription(
  view: TraceViewName,
  column: string,
): string {
  const text: string | undefined = traceViewCatalog[view].columns[column];
  if (text === undefined)
    throw new Error(
      `The view catalog has no description for ${view}.${column}.`,
    );
  return text;
}
