import { z } from "zod";
import {
  identityIdSchema,
  nonnegativeIntegerSchema,
  createListInputSchema,
  sessionIdSchema,
  utcDateTimeSchema,
  paginatedOutput,
} from "./common.js";
import {
  reuseEdgeSchema,
  reuseSortKeys,
  reusePagePositionSchema,
} from "./reuse.js";

export const reuseWeekSchema = z.strictObject({
  week: z.iso.date(),
  sessions: nonnegativeIntegerSchema,
  reuse_sessions: nonnegativeIntegerSchema,
  cross_user_reuse_sessions: nonnegativeIntegerSchema,
  reuse_rate: z.number().min(0).max(1).nullable(),
  cross_user_reuse_rate: z.number().min(0).max(1).nullable(),
});
export const memberImpactSchema = z.strictObject({
  user_id: identityIdSchema,
  sessions_reused_by_others: nonnegativeIntegerSchema,
  distinct_readers: nonnegativeIntegerSchema,
  reuses_made: nonnegativeIntegerSchema,
});
export const homeSummarySchema = z.strictObject({
  week: z.iso.date(),
  weekly: z.array(reuseWeekSchema).length(8),
  impact: memberImpactSchema,
});
export const homeSectionSchema = z.enum([
  "reused",
  "inbound",
  "outbound",
  "gap_repos",
  "zero_results",
]);
export const homeSectionSort = {
  reused: reuseSortKeys,
  inbound: reuseSortKeys,
  outbound: reuseSortKeys,
  gap_repos: ["sessions", "repo_name"],
  zero_results: ["searched_at", "query"],
} as const;
export const homeInputSchema = createListInputSchema([
  ...homeSectionSort.reused,
  ...homeSectionSort.gap_repos,
  ...homeSectionSort.zero_results,
]).extend({
  reader_user_id: identityIdSchema.optional(),
  query: z.string().trim().min(1).max(256).optional(),
});
export const homeRepoGapSchema = z.strictObject({
  repo_name: z.string(),
  sessions: nonnegativeIntegerSchema,
  truncated_fields: z.array(z.string()),
});
export const homeZeroResultSchema = z.strictObject({
  search_id: sessionIdSchema,
  searched_at: utcDateTimeSchema,
  query: z.string(),
  truncated_fields: z.array(z.string()),
});
export const homeListPositionSchema = z.strictObject({
  value: z.union([z.string().max(2048), z.number()]),
  id: z.string().min(1).max(64),
});
export const homeCursorSchema = z.strictObject({
  at: utcDateTimeSchema,
  after: z.union([homeListPositionSchema, reusePagePositionSchema]).nullable(),
});
export const homeItemSchema = z.union([
  reuseEdgeSchema,
  homeRepoGapSchema,
  homeZeroResultSchema,
]);
export const homeOutputSchema = paginatedOutput(homeItemSchema);
export type HomeItem = z.infer<typeof homeItemSchema>;
export type HomeSection = z.infer<typeof homeSectionSchema>;
