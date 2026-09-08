import { z } from "zod";
import {
  emailSchema,
  harnessSchema,
  messageKindSchema,
  messageRoleSchema,
  nullableTextSchema,
  nonnegativeIntegerSchema,
  opaqueCursorSchema,
  scalarOrArray,
  sessionIdSchema,
  utcDateTimeSchema,
} from "./common.js";

/** Field scope is shared by schema consumers and the session-list planner. */
export const searchConditionFields = {
  tool_name: "message",
  tool_use_id: "message",
  content: "message",
  role: "message",
  kind: "message",
  model: "message",
  harness: "session",
  title: "session",
  repo_name: "session",
  branch: "session",
  user_email: "session",
  status: "session",
  tool_input: "message",
} as const;
const conditionFieldSchema = z.enum(
  Object.keys(searchConditionFields) as (keyof typeof searchConditionFields)[],
);
const conditionText = z
  .string()
  .max(4096)
  .refine((value) => !value.includes("\0"));
const conditionTarget = {
  field: conditionFieldSchema,
  path: z
    .array(
      z
        .string()
        .max(256)
        .refine((value) => !value.includes("\0")),
    )
    .min(1)
    .max(8)
    .optional(),
};
export const searchConditionSchema = z
  .discriminatedUnion("op", [
    z.strictObject({
      ...conditionTarget,
      op: z.literal("eq"),
      value: z.union([conditionText, z.number(), z.boolean(), z.null()]),
    }),
    z.strictObject({
      ...conditionTarget,
      op: z.literal("contains"),
      value: conditionText.refine((value) => value.length > 0),
    }),
    z.strictObject({
      ...conditionTarget,
      op: z.literal("starts_with"),
      value: conditionText.refine((value) => value.length > 0),
    }),
    z.strictObject({ ...conditionTarget, op: z.literal("exists") }),
  ])
  .superRefine((condition, context) => {
    if ((condition.field === "tool_input") !== (condition.path !== undefined))
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "Choose a JSON path only for tool_input.",
      });
    if (
      condition.field !== "tool_input" &&
      condition.op === "eq" &&
      condition.value !== null &&
      typeof condition.value !== "string"
    )
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Use text or null for a text field.",
      });
  });
export type SearchCondition = z.infer<typeof searchConditionSchema>;

function filter<T extends z.ZodType>(
  schema: T,
): ReturnType<typeof scalarOrArray<T>> {
  return scalarOrArray(
    schema,
    () =>
      `Choose at least one filter value. Valid filters: ${searchFilterKeys.join(", ")}.`,
  );
}
const filterShape = {
  repo_name: filter(z.string().min(1)).optional(),
  branch: filter(z.string().min(1)).optional(),
  user_email: filter(emailSchema).optional(),
  tool_name: filter(z.string().min(1)).optional(),
  file_prefix: filter(z.string().min(1)).optional(),
  role: filter(messageRoleSchema).optional(),
  session_id: filter(sessionIdSchema).optional(),
  since: filter(utcDateTimeSchema).optional(),
  until: filter(utcDateTimeSchema).optional(),
  where: z.array(searchConditionSchema).min(1).max(10).optional(),
};
export const searchFilterKeys: string[] = Object.keys(filterShape);
export const searchFiltersSchema = z.strictObject(filterShape, {
  error: (issue) =>
    issue.code === "unrecognized_keys"
      ? `Unknown filter. Valid filters: ${searchFilterKeys.join(", ")}.`
      : undefined,
});
export function createSearchInputSchema(
  defaults: { context: number; limit: number } = { context: 1, limit: 5 },
) {
  const context = z.number().int().min(0).max(3);
  const limit = z.number().int().min(1).max(50);
  context.parse(defaults.context);
  limit.parse(defaults.limit);
  return z
    .strictObject({
      query: z.string(),
      filters: searchFiltersSchema.default({}),
      context: context.default(defaults.context),
      limit: limit.default(defaults.limit),
      cursor: opaqueCursorSchema,
    })
    .refine(
      (input) =>
        input.query.trim().length > 0 ||
        Object.values(input.filters).some((value) => value !== undefined),
      {
        path: ["query"],
        error: "Enter a search query or choose a filter.",
      },
    );
}
export const searchInputSchema = createSearchInputSchema();
export const searchMessageSchema = z.strictObject({
  seq: nonnegativeIntegerSchema,
  role: messageRoleSchema,
  kind: messageKindSchema,
  tool_name: nullableTextSchema.optional(),
  tool_use_id: nullableTextSchema.optional(),
  content: z.string(),
  hit: z.boolean(),
  truncated: z.boolean(),
  truncated_fields: z.array(z.string()).default([]),
});
export const searchBlockSchema = z.strictObject({
  session_id: sessionIdSchema,
  title: nullableTextSchema,
  harness: harnessSchema,
  model: nullableTextSchema,
  repo_name: nullableTextSchema,
  branch: nullableTextSchema,
  user_email: emailSchema,
  started_at: utcDateTimeSchema,
  messages: z.array(searchMessageSchema),
  truncated_fields: z.array(z.string()).default([]),
});
export const searchOutputSchema = z.strictObject({
  blocks: z.array(searchBlockSchema),
  cursor: opaqueCursorSchema,
  truncated_response: z.boolean(),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type SearchBlock = z.infer<typeof searchBlockSchema>;
