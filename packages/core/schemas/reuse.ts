import { z } from "zod";
import {
  catalogDescription,
  createListInputSchema,
  harnessSchema,
  identityIdSchema,
  nullableTextSchema,
  sessionIdSchema,
  truncatedFieldsSchema,
  utcDateTimeSchema,
} from "./common.js";

const edge = (column: string) => catalogDescription("reuse_edges", column);

export const reuseSortKeys = [
  "read_at",
  "reader_email",
  "source_title",
  "target_title",
] as const;
export const reuseListInputSchema = createListInputSchema(reuseSortKeys).extend(
  { reader_user_id: identityIdSchema.optional() },
);
export const reusePagePositionSchema = z.strictObject({
  value: z.string().max(2048).nullable(),
  source_session_id: sessionIdSchema,
  target_session_id: sessionIdSchema,
});
export const reuseEdgeSchema = z.strictObject({
  source_session_id: sessionIdSchema.describe(edge("source_session_id")),
  target_session_id: sessionIdSchema.describe(edge("target_session_id")),
  source_title: nullableTextSchema.describe("Title of the reading session"),
  target_title: nullableTextSchema.describe(
    "Title of the session that was read",
  ),
  reader_user_id: identityIdSchema.describe(edge("reader_user_id")),
  reader_email: z.string().describe(edge("reader_email")),
  reader_harness: harnessSchema.describe(edge("reader_harness")),
  read_at: utcDateTimeSchema.describe(edge("read_at")),
  audit_id: sessionIdSchema.describe(edge("audit_id")),
  truncated_fields: truncatedFieldsSchema,
});
export type ReusePagePosition = z.infer<typeof reusePagePositionSchema>;
export type ReuseSort = (typeof reuseSortKeys)[number];
