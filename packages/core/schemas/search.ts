import { z } from "zod";
import {
  catalogDescription,
  emailSchema,
  fileOperationSchema,
  harnessSchema,
  messageKindSchema,
  messageRoleSchema,
  nullableTextSchema,
  nonnegativeIntegerSchema,
  opaqueCursorSchema,
  parentRelationSchema,
  scalarOrArray,
  sessionIdSchema,
  truncatedFieldsSchema,
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
/** The condition fields of one scope as prose, so descriptions follow the map. */
const fieldsOf = (scope: "message" | "session", omit: string[] = []) =>
  Object.entries(searchConditionFields)
    .filter(([key, value]) => value === scope && !omit.includes(key))
    .map(([key]) => key)
    .join(", ");
const messageFields = fieldsOf("message", ["tool_input"]);
const sessionFields = fieldsOf("session");
const conditionFieldSchema = z
  .enum(
    Object.keys(
      searchConditionFields,
    ) as (keyof typeof searchConditionFields)[],
  )
  .describe(
    `Field to test. Message fields: ${messageFields}, tool_input (JSON, needs path). Session fields: ${sessionFields}`,
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
    .optional()
    .describe(
      'JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input',
    ),
};
export const searchConditionSchema = z
  .discriminatedUnion("op", [
    z
      .strictObject({
        ...conditionTarget,
        op: z.literal("eq"),
        value: z.union([conditionText, z.number(), z.boolean(), z.null()]),
      })
      .describe(
        "Exact, case-sensitive match; null matches a missing value. tool_input compares a JSON primitive with its type",
      ),
    z
      .strictObject({
        ...conditionTarget,
        op: z.literal("contains"),
        value: conditionText.refine((value) => value.length > 0),
      })
      .describe(
        "Case-insensitive literal substring match; no wildcards or regex",
      ),
    z
      .strictObject({
        ...conditionTarget,
        op: z.literal("starts_with"),
        value: conditionText.refine((value) => value.length > 0),
      })
      .describe("Case-insensitive literal prefix match"),
    z
      .strictObject({ ...conditionTarget, op: z.literal("exists") })
      .describe("The field, or the tool_input path, has a non-null value"),
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
/** One value or a list per key: any listed value matches, and every key must hold. */
const filterShape = {
  repo_name: filter(z.string().min(1))
    .optional()
    .describe(
      "Sessions in these repositories: host/org/repo, or an unambiguous short name",
    ),
  branch: filter(z.string().min(1))
    .optional()
    .describe("Sessions on these git branches (exact)"),
  user_email: filter(emailSchema)
    .optional()
    .describe("Sessions run by these members (exact email)"),
  tool_name: filter(z.string().min(1))
    .optional()
    .describe(
      "Messages calling or answering these tools, such as Read or Bash",
    ),
  file_prefix: filter(z.string().min(1))
    .optional()
    .describe(
      "Sessions that touched a file whose path starts with this text, such as src/auth/",
    ),
  file_operation: filter(fileOperationSchema)
    .optional()
    .describe(
      "Sessions where a file was read, edited, written or deleted; with file_prefix, the same file must match both",
    ),
  role: filter(messageRoleSchema)
    .optional()
    .describe("Messages with these roles"),
  session_id: filter(sessionIdSchema)
    .optional()
    .describe("Search inside these sessions only"),
  since: filter(utcDateTimeSchema)
    .optional()
    .describe("Messages at or after this UTC time (inclusive)"),
  until: filter(utcDateTimeSchema)
    .optional()
    .describe("Messages before this UTC time (exclusive)"),
};
const whereDescription = `Up to 10 extra conditions that must all hold, on a message field (${messageFields}, or a JSON path inside tool_input) or a session field (${sessionFields})`;
export const searchFilterKeys: string[] = [
  ...Object.keys(filterShape),
  "where",
];
const filtersDescription =
  "Narrow by session or message fields. Each key takes one value or a list (any of); every key given must hold";
function filtersSchema<Where extends z.ZodOptional<z.ZodType>>(where: Where) {
  return z
    .strictObject(
      { ...filterShape, where },
      {
        error: (issue) =>
          issue.code === "unrecognized_keys"
            ? `Unknown filter. Valid filters: ${searchFilterKeys.join(", ")}.`
            : undefined,
      },
    )
    .describe(filtersDescription);
}
export const searchFiltersSchema = filtersSchema(
  z
    .array(searchConditionSchema)
    .min(1)
    .max(10)
    .optional()
    .describe(whereDescription),
);
/**
 * The condition shape advertised in the MCP catalog: one object instead of four
 * discriminated variants, so `tools/list` stays inside its budget (§8.2). Calls are still
 * parsed with `searchConditionSchema`.
 */
export const searchConditionToolSchema = z.strictObject({
  field: conditionFieldSchema.describe("Field to test"),
  op: z
    .enum(searchConditionSchema.options.map((option) => option.shape.op.value))
    .describe(
      "eq: exact, case-sensitive, null matches missing; contains and starts_with: literal, case-insensitive; exists: non-null, takes no value",
    ),
  path: z
    .array(z.string())
    .optional()
    .describe(
      "JSON keys or array positions inside tool_input; only with field tool_input",
    ),
  // A bounded string keeps the union rendered as anyOf branches (one type each), which
  // Gemini's function-declaration schema accepts; a bare primitive union flattens to a type array.
  value: z
    .union([z.string().max(4096), z.number(), z.boolean(), z.null()])
    .optional()
    .describe("Text for text fields; any JSON primitive for a tool_input path"),
});
export const searchToolFiltersSchema = filtersSchema(
  z
    .array(searchConditionToolSchema)
    .min(1)
    .max(10)
    .optional()
    .describe(whereDescription),
);
export function createSearchInputSchema(
  defaults: { context: number; limit: number } = { context: 1, limit: 5 },
) {
  const context = z.number().int().min(0).max(3);
  const limit = z.number().int().min(1).max(50);
  context.parse(defaults.context);
  limit.parse(defaults.limit);
  return z
    .strictObject({
      query: z
        .string()
        .describe(
          "Words to find; every word must appear (English stems match). May be empty when a filter is given",
        ),
      filters: searchFiltersSchema.default({}).describe(filtersDescription),
      context: context
        .default(defaults.context)
        .describe("Neighbouring non-thinking messages either side of each hit"),
      limit: limit
        .default(defaults.limit)
        .describe("Hit messages per page; at most 3 hits per session"),
      cursor: opaqueCursorSchema.describe(
        "Cursor from the previous page; null for the first page",
      ),
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
/** Catalog rendering of `searchInputSchema` with the compact condition shape; calls parse the strict one. */
export const searchToolInputSchema = z.strictObject({
  ...searchInputSchema.shape,
  filters: searchToolFiltersSchema.default({}).describe(filtersDescription),
});
export const searchMessageSchema = z.strictObject({
  seq: nonnegativeIntegerSchema.describe(catalogDescription("messages", "seq")),
  role: messageRoleSchema.describe(catalogDescription("messages", "role")),
  kind: messageKindSchema.describe(catalogDescription("messages", "kind")),
  tool_name: nullableTextSchema
    .optional()
    .describe(catalogDescription("messages", "tool_name")),
  tool_use_id: nullableTextSchema
    .optional()
    .describe(catalogDescription("messages", "tool_use_id")),
  content: z
    .string()
    .describe("Excerpt of the message text, centred on the match"),
  hit: z
    .boolean()
    .describe("True for a matched message, false for surrounding context"),
  truncated: z
    .boolean()
    .describe("True when content is an excerpt of a longer message"),
  truncated_fields: truncatedFieldsSchema,
});
export const searchBlockSchema = z.strictObject({
  session_id: sessionIdSchema.describe(
    "Session the messages belong to; pass to get for the full transcript",
  ),
  root_session_id: sessionIdSchema.describe(
    "Root of the session tree. Equals session_id unless the hit sits inside a subagent, fork or spawned run; open the root and read the run inline.",
  ),
  parent_relation: parentRelationSchema
    .nullable()
    .describe(
      "How this session relates to its parent; null for a root session.",
    ),
  agent_type: nullableTextSchema.describe(
    "Harness agent type of a subagent run, when the harness reports one.",
  ),
  parent_tool_use_id: nullableTextSchema.describe(
    "The parent's tool call that spawned this run, when recorded and the parent is visible; null for a root session.",
  ),
  title: nullableTextSchema.describe(catalogDescription("sessions", "title")),
  harness: harnessSchema.describe(catalogDescription("sessions", "harness")),
  model: nullableTextSchema.describe(catalogDescription("sessions", "model")),
  repo_name: nullableTextSchema.describe(
    catalogDescription("sessions", "repo_name"),
  ),
  branch: nullableTextSchema.describe(catalogDescription("sessions", "branch")),
  user_email: emailSchema.describe(
    catalogDescription("sessions", "user_email"),
  ),
  started_at: utcDateTimeSchema.describe(
    catalogDescription("sessions", "started_at"),
  ),
  messages: z
    .array(searchMessageSchema)
    .describe("Matched messages and their context, in seq order"),
  truncated_fields: truncatedFieldsSchema,
});
/** Counts over every hit the query and filters match; paging and the per-session cap never change them. */
export const searchTotalSchema = z.strictObject({
  sessions: nonnegativeIntegerSchema.describe(
    "Distinct sessions with at least one matching message, across every page",
  ),
  hits: nonnegativeIntegerSchema.describe(
    "Matching messages before the per-session cap and paging",
  ),
});
export const searchOutputSchema = z.strictObject({
  blocks: z
    .array(searchBlockSchema)
    .describe("Message windows grouped by session, best match first"),
  cursor: opaqueCursorSchema.describe(
    "Cursor for the next page; null when there is none",
  ),
  truncated_response: z
    .boolean()
    .describe(
      "True when the page was cut to fit the response size limit; continue with cursor",
    ),
  total: searchTotalSchema.describe(
    "Totals over every hit the query and filters match under the caller's visibility, not only this page",
  ),
});
export type SearchTotal = z.infer<typeof searchTotalSchema>;
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type SearchBlock = z.infer<typeof searchBlockSchema>;
