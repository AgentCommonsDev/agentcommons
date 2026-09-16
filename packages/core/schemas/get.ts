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
  type MessageKind,
  nonnegativeIntegerSchema,
  nullableTextSchema,
  parentRelationSchema,
  responseBytes,
  responseFormatSchema,
  sessionIdSchema,
  sessionStatusSchema,
  truncatedFieldsSchema,
  utcDateTimeSchema,
  visibilitySchema,
} from "./common.js";

const session = (column: string) => catalogDescription("sessions", column);
const message = (column: string) => catalogDescription("messages", column);

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
/** The message range of one read; the refinement keeps the bounds and cursor consistent. */
const rangeSchema = z
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
/**
 * The byte budget of one `get` page (§7.3): the 32 KB agent default, or up to the 256 KB
 * REST page cap for a reader that pages a whole transcript, such as the dashboard. Each
 * message slice within a page is bounded to one eighth of the budget.
 */
export const pageBytesSchema = z
  .number()
  .int()
  .min(responseBytes.read)
  .max(responseBytes.page)
  .default(responseBytes.read)
  .describe(
    `Response budget of one page in bytes, ${String(responseBytes.read)} to ${String(responseBytes.page)}; each message slice is bounded to one eighth of it`,
  );
/**
 * Share of the page one message's `content` may take: a quarter (8 KB at the 32 KB agent
 * page, 64 KB at the 256 KB dashboard page), so a tool result reads whole far more often
 * than at the old eighth while a page still holds several messages. Harness housekeeping
 * records (META: tool listings, skill listings, reminders) get a preview of one
 * thirty-second (1 KB) when a caller asks for them at all.
 */
const sliceShare: Record<"default" | "META", number> = {
  default: 1 / 4,
  META: 1 / 32,
};
/** The longest `content` slice one page carries for a message of `kind` under `pageBytes`. */
export const contentSliceBytes = (pageBytes: number, kind?: MessageKind) =>
  pageBytes * (kind === "META" ? sliceShare.META : sliceShare.default);
/**
 * The message kinds a read returns when the caller names none. Agent and JSON readers get
 * the conversation (META housekeeping records are left out; they were 94% of the bytes an
 * agent paged through in production); a CSV export is a file, so it carries every kind.
 */
export const defaultMessageKinds: Record<
  z.infer<typeof responseFormatSchema>,
  readonly MessageKind[]
> = {
  json: messageKindSchema.options.filter((kind) => kind !== "META"),
  csv: messageKindSchema.options,
};
export const messageKindsSchema = z
  .array(messageKindSchema)
  .min(1)
  .optional()
  .describe(
    "Message kinds to return, in seq order. Left out: META, the harness's housekeeping records (tool listings, skill listings, reminders); list it to read them. Default TEXT, THINKING, TOOL_USE, TOOL_RESULT",
  );
/**
 * Whether a page computes the session header. The header is the expensive part of a read
 * (§7.3); a reader that already holds it, such as the dashboard on its later pages, passes
 * false and gets `header: null` with the messages. Visibility is checked either way.
 */
export const includeHeaderSchema = z
  .boolean()
  .default(true)
  .describe(
    "Compute and return the session header; false answers header: null for a reader that already holds it, so a later page costs only its messages",
  );
/** What a read selects: the seq range and the message kinds. */
const selectionSchema = rangeSchema.safeExtend({ kinds: messageKindsSchema });
/** The REST query of `GET /sessions/:id`: the selection, the page budget, the header switch, and `csv` for the whole range as one file. */
export const getQuerySchema = selectionSchema.safeExtend({
  format: responseFormatSchema,
  page_bytes: pageBytesSchema,
  header: includeHeaderSchema,
});
/** The `get` tool input agents see: the selection and the session (§8.2). */
export const getToolInputSchema = selectionSchema.safeExtend({
  session_id: sessionIdSchema.describe(
    "Session to read, from a search result or the sessions view",
  ),
});
/** Every `get` call, with the REST page budget and response format; the MCP tool advertises neither and keeps the 32 KB default. */
export const getInputSchema = getToolInputSchema.safeExtend({
  format: responseFormatSchema,
  page_bytes: pageBytesSchema,
  header: includeHeaderSchema,
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
  observed_branches: z.array(z.string()).describe(session("observed_branches")),
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
  observed_branch_count: nonnegativeIntegerSchema.describe(
    session("observed_branch_count"),
  ),
  reuse_count: nonnegativeIntegerSchema.describe(session("reuse_count")),
  agentcommons_search_calls: nonnegativeIntegerSchema.describe(
    session("agentcommons_search_calls"),
  ),
  reuses_made: nonnegativeIntegerSchema.describe(session("reuses_made")),
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
  truncated_fields: truncatedFieldsSchema,
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
  seq: nonnegativeIntegerSchema.describe(
    `${message("seq")}; counts every kind, so a read that leaves META out shows gaps`,
  ),
  role: messageRoleSchema.describe(message("role")),
  kind: messageKindSchema.describe(message("kind")),
  content: byteBoundedString(contentSliceBytes(responseBytes.page)).describe(
    message("content"),
  ),
  content_cursor: contentCursorSchema
    .nullable()
    .describe(
      "Set when this message's content is bounded here; to read the rest, call get with from and to set to this seq and cursor set to this value",
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
  truncated_fields: truncatedFieldsSchema,
});
/**
 * One message as a row of the CSV export: every `get` message field but the paging
 * cursor, in the same order, with the whole content once its page slices are rejoined.
 */
export const messageRowSchema = messageSchema
  .omit({ content_cursor: true })
  .extend({ content: z.string().describe(message("content")) });
export const getOutputSchema = z.strictObject({
  header: sessionHeaderSchema
    .nullable()
    .describe(
      "Who ran the session, where and when, with message, tool, token, file and reuse counts and related sessions; null when the REST caller asked for messages only (header=false)",
    ),
  messages: z
    .array(messageSchema)
    .describe("Messages in seq order within the requested range"),
  next: contentCursorSchema
    .nullable()
    .describe(
      "Cursor for the following page: the next message, or the rest of the last message when the range ends inside it; null when the range is complete",
    ),
});
export type ContentCursor = z.infer<typeof contentCursorSchema>;
export type GetOutput = z.infer<typeof getOutputSchema>;
export type SessionHeader = z.infer<typeof sessionHeaderSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageRow = z.infer<typeof messageRowSchema>;

export const sessionEventSchema = z.strictObject({
  session_id: sessionIdSchema,
  status: sessionStatusSchema,
  message_count: nonnegativeIntegerSchema,
  last_received_at: utcDateTimeSchema,
});
