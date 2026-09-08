import { z } from "zod";
import {
  createListInputSchema,
  emailSchema,
  harnessSchema,
  identityIdSchema,
  jsonValueSchema,
  nonnegativeIntegerSchema,
  nullableTextSchema,
  opaqueCursorSchema,
  paginationSchema,
  parentRelationSchema,
  sessionIdSchema,
  sessionStatusSchema,
  utcDateTimeSchema,
} from "./common.js";
import { searchFiltersSchema } from "./search.js";
import { sessionHeaderSchema } from "./get.js";
import { reuseEdgeSchema, reuseListInputSchema } from "./reuse.js";
export * from "./reuse.js";

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
]).extend({ filters: searchFiltersSchema.default({}) });
export const rawInputSchema = paginationSchema;
export const sessionReuseInputSchema = reuseListInputSchema.extend({
  direction: z.enum(["by", "from"]).default("by"),
});
export const sessionReuseOutputSchema = z.strictObject({
  items: z.array(reuseEdgeSchema),
  cursor: opaqueCursorSchema,
});
export const sessionListItemSchema = sessionHeaderSchema.extend({
  duration_seconds: z.number().nullable(),
  last_activity_at: utcDateTimeSchema,
});
export const sessionsOutputSchema = z.strictObject({
  items: z.array(sessionListItemSchema),
  cursor: opaqueCursorSchema,
});
export const rawRecordSchema = z.strictObject({
  id: sessionIdSchema,
  session_id: sessionIdSchema,
  organization_id: identityIdSchema,
  pos: z.string().regex(/^\d+$/),
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
export const rawOutputSchema = z.strictObject({
  items: z.array(rawRecordSchema),
  cursor: opaqueCursorSchema,
});
export const treeNodeSchema = z.strictObject({
  session_id: sessionIdSchema,
  title: nullableTextSchema,
  harness: harnessSchema,
  agent_type: nullableTextSchema,
  parent_relation: parentRelationSchema.nullable(),
  parent_session_id: sessionIdSchema.nullable(),
  user_email: emailSchema,
  started_at: utcDateTimeSchema,
  status: sessionStatusSchema,
  message_count: nonnegativeIntegerSchema,
  gap: z.boolean(),
  truncated_fields: z.array(z.string()),
});
export const treeOutputSchema = z.strictObject({
  nodes: z.array(treeNodeSchema),
  cursor: opaqueCursorSchema,
});
export const treeInputSchema = paginationSchema;
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
  max_rows: z.coerce.number().int().min(1).max(50).default(5),
});
export const similarOutputSchema = z.strictObject({
  sessions: z.array(sessionHeaderSchema),
});

export const repoSchema = z.strictObject({
  repo_name: z.string(),
  repo_url: nullableTextSchema,
  session_count: nonnegativeIntegerSchema,
  user_count: nonnegativeIntegerSchema,
  first_seen_at: utcDateTimeSchema,
  last_activity_at: utcDateTimeSchema,
  truncated_fields: z.array(z.string()),
});
export const reposOutputSchema = z.strictObject({
  items: z.array(repoSchema),
  cursor: opaqueCursorSchema,
});
export const installationSchema = z.strictObject({
  installation_id: sessionIdSchema,
  tools_enabled: z.boolean(),
  organization_id: identityIdSchema,
  hostname: z.string(),
  os_user: z.string(),
  platform: z.string(),
  arch: z.string(),
  first_seen_at: utcDateTimeSchema,
  last_seen_at: utcDateTimeSchema,
  session_count: nonnegativeIntegerSchema,
  truncated_fields: z.array(z.string()),
});
export const installationsOutputSchema = z.strictObject({
  items: z.array(installationSchema),
  cursor: opaqueCursorSchema,
});

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
