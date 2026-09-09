import { z } from "zod";
import {
  byteBoundedString,
  catalogDescription,
  decimalIntegerSchema,
  emailSchema,
  harnessSchema,
  identityIdSchema,
  messageKindSchema,
  messageRoleSchema,
  nonnegativeIntegerSchema,
  nullableTextSchema,
  parentRelationSchema,
  sessionIdSchema,
  sessionStatusSchema,
  utcDateTimeSchema,
  visibilitySchema,
} from "./common.js";

const session = (column: string) => catalogDescription("sessions", column);
const message = (column: string) => catalogDescription("messages", column);
const truncatedFieldsText = "Fields shortened to fit the response";

export const contentCursorSchema = z
  .strictObject({
    seq: nonnegativeIntegerSchema.describe(
      "Message position (seq) to continue from",
    ),
    offset: nonnegativeIntegerSchema.describe(
      "Byte offset inside that message's content",
    ),
  })
  .describe("Position inside a session's messages for continuing a read");
export const getQuerySchema = z
  .strictObject({
    from: nonnegativeIntegerSchema
      .optional()
      .describe("First message seq to return (inclusive)"),
    to: nonnegativeIntegerSchema
      .optional()
      .describe("Last message seq to return (inclusive)"),
    cursor: contentCursorSchema
      .nullable()
      .optional()
      .describe("The next value of a previous page; omit to start at from"),
  })
  .superRefine((input, context) => {
    if (
      input.from !== undefined &&
      input.to !== undefined &&
      input.to < input.from
    )
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The ending sequence must be at least the starting sequence.",
      });
    if (
      input.cursor !== undefined &&
      input.cursor !== null &&
      ((input.from !== undefined && input.cursor.seq < input.from) ||
        (input.to !== undefined && input.cursor.seq > input.to))
    )
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "The cursor must be within the requested sequence range.",
      });
  });
export const getInputSchema = getQuerySchema.safeExtend({
  session_id: sessionIdSchema.describe(
    "Session to read, from a search result or the sessions view",
  ),
});
export const sessionRefSchema = z.strictObject({
  session_id: sessionIdSchema.describe("Related session; pass to get"),
  title: nullableTextSchema.describe(session("title")),
  parent_relation: parentRelationSchema
    .nullable()
    .describe(session("parent_relation")),
  /** Projected identity of the parent's tool call that spawned the child, when the harness records it. */
  parent_tool_use_id: nullableTextSchema.describe(
    session("parent_tool_use_id"),
  ),
  agent_type: nullableTextSchema.describe(session("agent_type")),
});
export const sessionHeaderSchema = z.strictObject({
  session_id: sessionIdSchema.describe(session("session_id")),
  organization_id: identityIdSchema.describe(session("organization_id")),
  title: nullableTextSchema.describe(session("title")),
  harness: harnessSchema.describe(session("harness")),
  harness_version: nullableTextSchema.describe(session("harness_version")),
  entrypoint: nullableTextSchema.describe(session("entrypoint")),
  model: nullableTextSchema.describe(session("model")),
  models_used: z.array(z.string()).describe(session("models_used")),
  user_email: emailSchema.describe(session("user_email")),
  installation_hostname: z.string().describe(session("installation_hostname")),
  installation_id: sessionIdSchema.describe(session("installation_id")),
  repo_name: nullableTextSchema.describe(session("repo_name")),
  repo_url: nullableTextSchema.describe(session("repo_url")),
  branch: nullableTextSchema.describe(session("branch")),
  cwd_relative: nullableTextSchema.describe(session("cwd_relative")),
  start_commit: nullableTextSchema.describe(session("start_commit")),
  end_commit: nullableTextSchema.describe(session("end_commit")),
  started_at: utcDateTimeSchema.describe(session("started_at")),
  ended_at: utcDateTimeSchema.nullable().describe(session("ended_at")),
  status: sessionStatusSchema.describe(session("status")),
  visibility: visibilitySchema.describe(session("visibility")),
  /** Set when an admin purged the content; only admins can still see the skeleton. */
  purged_at: utcDateTimeSchema.nullable().describe(session("purged_at")),
  end_reason: nullableTextSchema.describe(session("end_reason")),
  message_count: nonnegativeIntegerSchema.describe(session("message_count")),
  tool_call_count: nonnegativeIntegerSchema.describe(
    session("tool_call_count"),
  ),
  input_tokens: decimalIntegerSchema
    .nullable()
    .describe(session("input_tokens")),
  output_tokens: decimalIntegerSchema
    .nullable()
    .describe(session("output_tokens")),
  tools_used: z.array(z.string()).describe(session("tools_used")),
  file_count: nonnegativeIntegerSchema.describe(session("file_count")),
  observed_commit_count: nonnegativeIntegerSchema.describe(
    session("observed_commit_count"),
  ),
  reuse_count: nonnegativeIntegerSchema.describe(session("reuse_count")),
  agent_type: nullableTextSchema.describe(session("agent_type")),
  parent_session_id: sessionIdSchema
    .nullable()
    .describe(session("parent_session_id")),
  parent_relation: parentRelationSchema
    .nullable()
    .describe(session("parent_relation")),
  /** Matches the parent's `tool_use_id` message field; null when no harness evidence names the call. */
  parent_tool_use_id: nullableTextSchema.describe(
    session("parent_tool_use_id"),
  ),
  parent: sessionRefSchema
    .nullable()
    .describe("Parent session when visible; null for a root session"),
  children: z
    .array(sessionRefSchema)
    .describe(
      "Up to 10 direct child sessions: subagents, forks and spawned runs",
    ),
  child_count: nonnegativeIntegerSchema.describe(session("child_count")),
  children_truncated: z
    .boolean()
    .describe("True when more children exist than are listed"),
  truncated_fields: z.array(z.string()).describe(truncatedFieldsText),
  root_session_id: sessionIdSchema.describe(
    "Top of this session's parent chain; equals session_id for a root session",
  ),
});
export const messageSchema = z.strictObject({
  message_id: sessionIdSchema.describe(message("message_id")),
  session_id: sessionIdSchema.describe(message("session_id")),
  raw_record_id: sessionIdSchema.nullable().describe(message("raw_record_id")),
  ingest_batch_id: sessionIdSchema
    .nullable()
    .describe(message("ingest_batch_id")),
  seq: nonnegativeIntegerSchema.describe(message("seq")),
  role: messageRoleSchema.describe(message("role")),
  kind: messageKindSchema.describe(message("kind")),
  content: byteBoundedString(4096).describe(message("content")),
  content_cursor: contentCursorSchema
    .nullable()
    .describe(
      "Set when content continues beyond this page; pass it as cursor to read on",
    ),
  tool_name: nullableTextSchema.describe(message("tool_name")),
  tool_use_id: nullableTextSchema.describe(message("tool_use_id")),
  model: nullableTextSchema.describe(message("model")),
  timestamp: utcDateTimeSchema.nullable().describe(message("timestamp")),
  received_at: utcDateTimeSchema.describe(message("received_at")),
  input_tokens: decimalIntegerSchema
    .nullable()
    .describe(message("input_tokens")),
  output_tokens: decimalIntegerSchema
    .nullable()
    .describe(message("output_tokens")),
  agent_id: nullableTextSchema.describe(message("agent_id")),
  truncated_fields: z
    .array(z.string())
    .default([])
    .describe(truncatedFieldsText),
});
export const getOutputSchema = z.strictObject({
  header: sessionHeaderSchema.describe(
    "Who ran the session, where and when, with message, tool, token, file and reuse counts and related sessions",
  ),
  messages: z
    .array(messageSchema)
    .describe("Messages in seq order within the requested range"),
  next: contentCursorSchema
    .nullable()
    .describe("Cursor for the following page; null when the range is complete"),
});
export type ContentCursor = z.infer<typeof contentCursorSchema>;
export type GetInput = z.infer<typeof getInputSchema>;
export type GetOutput = z.infer<typeof getOutputSchema>;
export type SessionHeader = z.infer<typeof sessionHeaderSchema>;
export type Message = z.infer<typeof messageSchema>;

export const sessionEventSchema = z.strictObject({
  session_id: sessionIdSchema,
  status: sessionStatusSchema,
  message_count: nonnegativeIntegerSchema,
  last_received_at: utcDateTimeSchema,
});
