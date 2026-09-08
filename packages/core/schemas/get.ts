import { z } from "zod";
import {
  byteBoundedString,
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

export const contentCursorSchema = z.strictObject({
  seq: nonnegativeIntegerSchema,
  offset: nonnegativeIntegerSchema,
});
export const getQuerySchema = z
  .strictObject({
    from: nonnegativeIntegerSchema.optional(),
    to: nonnegativeIntegerSchema.optional(),
    cursor: contentCursorSchema.nullable().optional(),
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
  session_id: sessionIdSchema,
});
export const sessionRefSchema = z.strictObject({
  session_id: sessionIdSchema,
  title: nullableTextSchema,
  parent_relation: parentRelationSchema.nullable(),
  agent_type: nullableTextSchema,
});
export const sessionHeaderSchema = z.strictObject({
  session_id: sessionIdSchema,
  organization_id: identityIdSchema,
  title: nullableTextSchema,
  harness: harnessSchema,
  harness_version: nullableTextSchema,
  entrypoint: nullableTextSchema,
  model: nullableTextSchema,
  models_used: z.array(z.string()),
  user_email: emailSchema,
  installation_hostname: z.string(),
  installation_id: sessionIdSchema,
  repo_name: nullableTextSchema,
  repo_url: nullableTextSchema,
  branch: nullableTextSchema,
  cwd_relative: nullableTextSchema,
  start_commit: nullableTextSchema,
  end_commit: nullableTextSchema,
  started_at: utcDateTimeSchema,
  ended_at: utcDateTimeSchema.nullable(),
  status: sessionStatusSchema,
  visibility: visibilitySchema,
  end_reason: nullableTextSchema,
  message_count: nonnegativeIntegerSchema,
  tool_call_count: nonnegativeIntegerSchema,
  input_tokens: decimalIntegerSchema.nullable(),
  output_tokens: decimalIntegerSchema.nullable(),
  tools_used: z.array(z.string()),
  file_count: nonnegativeIntegerSchema,
  observed_commit_count: nonnegativeIntegerSchema,
  reuse_count: nonnegativeIntegerSchema,
  agent_type: nullableTextSchema,
  parent: sessionRefSchema.nullable(),
  children: z.array(sessionRefSchema),
  child_count: nonnegativeIntegerSchema,
  children_truncated: z.boolean(),
  truncated_fields: z.array(z.string()),
  root_session_id: sessionIdSchema,
});
export const messageSchema = z.strictObject({
  message_id: sessionIdSchema,
  session_id: sessionIdSchema,
  raw_record_id: sessionIdSchema.nullable(),
  ingest_batch_id: sessionIdSchema.nullable(),
  seq: nonnegativeIntegerSchema,
  role: messageRoleSchema,
  kind: messageKindSchema,
  content: byteBoundedString(4096),
  content_cursor: contentCursorSchema.nullable(),
  tool_name: nullableTextSchema,
  tool_use_id: nullableTextSchema,
  model: nullableTextSchema,
  timestamp: utcDateTimeSchema.nullable(),
  received_at: utcDateTimeSchema,
  input_tokens: decimalIntegerSchema.nullable(),
  output_tokens: decimalIntegerSchema.nullable(),
  agent_id: nullableTextSchema,
  truncated_fields: z.array(z.string()).default([]),
});
export const getOutputSchema = z.strictObject({
  header: sessionHeaderSchema,
  messages: z.array(messageSchema),
  next: contentCursorSchema.nullable(),
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
