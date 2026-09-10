import { z } from "zod";
import {
  catalogDescription,
  createListInputSchema,
  decimalIntegerSchema,
  identityIdSchema,
  jsonValueSchema,
  nonnegativeIntegerSchema,
  nullableTextSchema,
  opaqueCursorSchema,
  paginatedOutput,
  sessionIdSchema,
  sha256Schema,
  truncatedFieldsSchema,
  utcDateTimeSchema,
} from "./common.js";
import { searchFiltersSchema } from "./search.js";
import { sessionHeaderSchema } from "./get.js";
import { reuseEdgeSchema, reuseListInputSchema } from "./reuse.js";
// The dashboard still reads the reuse contract through this subpath.
export * from "./reuse.js";

const repo = (column: string) => catalogDescription("repos", column);
const installation = (column: string) =>
  catalogDescription("installations", column);

export const sessionsInputSchema = createListInputSchema([
  "title",
  "harness",
  "harness_version",
  "model",
  "repo_name",
  "branch",
  "user_email",
  "installation_hostname",
  "started_at",
  "duration_seconds",
  "message_count",
  "tool_call_count",
  "observed_commit_count",
  "reuse_count",
  "status",
  "last_activity_at",
]).extend({
  filters: searchFiltersSchema.default({}),
  /** Only sessions without a caller-visible parent: subagent, fork and spawned runs stay inside their parent. */
  roots_only: z.boolean().default(false),
});
export const sessionReuseInputSchema = reuseListInputSchema.extend({
  direction: z.enum(["by", "from"]).default("by"),
});
export const sessionReuseOutputSchema = paginatedOutput(reuseEdgeSchema);
export const sessionListItemSchema = sessionHeaderSchema.extend({
  duration_seconds: z.number().nullable(),
  last_activity_at: utcDateTimeSchema,
});
/** Counts over the whole filtered, caller-visible set; the page window never changes them. */
export const sessionsTotalSchema = z.strictObject({
  sessions: nonnegativeIntegerSchema.describe(
    "Sessions the filters match under the caller's visibility, across every page",
  ),
  messages: nonnegativeIntegerSchema.describe(
    "Sum of message_count over those sessions",
  ),
});
export const sessionsOutputSchema = paginatedOutput(
  sessionListItemSchema,
).extend({
  total: sessionsTotalSchema.describe(
    "Totals over every matching session, computed with the same filters and roots_only as the page",
  ),
});
export const rawRecordSchema = z.strictObject({
  id: sessionIdSchema,
  session_id: sessionIdSchema,
  organization_id: identityIdSchema,
  pos: decimalIntegerSchema,
  key: nullableTextSchema,
  source_version: nonnegativeIntegerSchema,
  record_type: z.string(),
  payload: jsonValueSchema,
  payload_fragment: z
    .strictObject({
      offset: nonnegativeIntegerSchema,
      next_offset: nonnegativeIntegerSchema.nullable(),
    })
    .nullable(),
  ingest_batch_id: sessionIdSchema,
  received_at: utcDateTimeSchema,
});
export const rawOutputSchema = paginatedOutput(rawRecordSchema);
/** The header fields a tree node carries, in the same shape and meaning as `get`. */
export const treeNodeSchema = sessionHeaderSchema
  .pick({
    session_id: true,
    title: true,
    harness: true,
    agent_type: true,
    parent_relation: true,
    parent_session_id: true,
    parent_tool_use_id: true,
    user_email: true,
    started_at: true,
    status: true,
    message_count: true,
  })
  .extend({
    gap: z.boolean(),
    truncated_fields: truncatedFieldsSchema,
  });
export const treeOutputSchema = z.strictObject({
  nodes: z.array(treeNodeSchema),
  cursor: opaqueCursorSchema,
});
export const schemaOutputSchema = z.strictObject({
  columns: z.array(
    z.strictObject({
      view_name: z.string(),
      column_name: z.string(),
      data_type: z.string(),
      ordinal_position: z.number().int().positive(),
      description: nullableTextSchema,
    }),
  ),
  functions: z.array(
    z.strictObject({
      function_name: z.string(),
      arguments: z.string(),
      result_type: z.string(),
      description: nullableTextSchema,
    }),
  ),
});
export const healthOutputSchema = z.strictObject({
  status: z.enum(["ok", "unavailable"]),
});
export const similarInputSchema = z.strictObject({
  max_rows: z.number().int().min(1).max(50).default(5),
});
export const similarOutputSchema = z.strictObject({
  sessions: z.array(sessionHeaderSchema),
});

export const repoSchema = z.strictObject({
  repo_name: z.string().describe(repo("repo_name")),
  repo_url: nullableTextSchema.describe(repo("repo_url")),
  session_count: nonnegativeIntegerSchema.describe(repo("session_count")),
  user_count: nonnegativeIntegerSchema.describe(repo("user_count")),
  first_seen_at: utcDateTimeSchema.describe(repo("first_seen_at")),
  last_activity_at: utcDateTimeSchema.describe(repo("last_activity_at")),
  truncated_fields: truncatedFieldsSchema,
});
export const reposOutputSchema = paginatedOutput(repoSchema);
export const installationSchema = z.strictObject({
  installation_id: sessionIdSchema.describe(installation("installation_id")),
  tools_enabled: z.boolean().describe(installation("tools_enabled")),
  organization_id: identityIdSchema.describe(installation("organization_id")),
  hostname: z.string().describe(installation("hostname")),
  os_user: z.string().describe(installation("os_user")),
  platform: z.string().describe(installation("platform")),
  arch: z.string().describe(installation("arch")),
  hook_sha256: sha256Schema.nullable().describe(installation("hook_sha256")),
  first_seen_at: utcDateTimeSchema.describe(installation("first_seen_at")),
  last_seen_at: utcDateTimeSchema.describe(installation("last_seen_at")),
  session_count: nonnegativeIntegerSchema.describe(
    installation("session_count"),
  ),
  truncated_fields: truncatedFieldsSchema,
});
export const installationsOutputSchema = paginatedOutput(installationSchema);

export const repoSortKeys = [
  "repo_name",
  "session_count",
  "user_count",
  "first_seen_at",
  "last_activity_at",
] as const;
export const installationSortKeys = [
  "hostname",
  "os_user",
  "platform",
  "arch",
  "first_seen_at",
  "last_seen_at",
  "session_count",
  "tools_enabled",
] as const;
export const reposInputSchema = createListInputSchema(repoSortKeys).extend({
  filters: z
    .strictObject({ repo_name: z.string().trim().min(1).max(256).optional() })
    .default({}),
});
export const installationsInputSchema = createListInputSchema(
  installationSortKeys,
).extend({
  filters: z
    .strictObject({
      hostname: z.string().trim().min(1).max(256).optional(),
      tools_enabled: z.boolean().optional(),
    })
    .default({}),
});
