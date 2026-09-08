import { z } from "zod";
import {
  createListInputSchema,
  harnessSchema,
  identityIdSchema,
  nullableTextSchema,
  sessionIdSchema,
  utcDateTimeSchema,
} from "./common.js";

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
  source_session_id: sessionIdSchema,
  target_session_id: sessionIdSchema,
  source_title: nullableTextSchema,
  target_title: nullableTextSchema,
  reader_user_id: identityIdSchema,
  reader_email: z.string(),
  reader_harness: harnessSchema,
  read_at: utcDateTimeSchema,
  audit_id: sessionIdSchema,
  truncated_fields: z.array(z.string()),
});
export type ReusePagePosition = z.infer<typeof reusePagePositionSchema>;
export type ReuseSort = (typeof reuseSortKeys)[number];
