import { z } from "zod";
import { policyKindSchema } from "../redaction/policy.js";
import {
  createListInputSchema,
  filterTextMaxLength,
  nonnegativeIntegerSchema,
  paginatedOutput,
  sessionIdSchema,
  utcDateTimeSchema,
} from "./common.js";

/** Where a redaction was applied: by the capture that stored the text, or by a later rescan. */
export const redactionSourceSchema = z.enum(["capture", "rescan"]);
export const redactionRunStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
/**
 * One redaction landing: a policy's hits on one message of one session, from one receipt.
 * `seq` is the message's position on the session page (`/app/sessions/:id#<seq>`); null
 * names the session's metadata (git fields, context, header text). Never any text.
 */
export const redactionHitSchema = z.strictObject({
  id: sessionIdSchema,
  session_id: sessionIdSchema,
  ingest_batch_id: sessionIdSchema,
  run_id: sessionIdSchema.nullable(),
  source: redactionSourceSchema,
  policy_id: sessionIdSchema,
  /** Null once the policy is deleted; its counters and hits go with it in the same transaction. */
  policy_name: z.string().nullable(),
  seq: nonnegativeIntegerSchema.nullable(),
  count: nonnegativeIntegerSchema,
  /**
   * A masked slice of the matched value that reveals at most its first and last few
   * characters, and nothing at all for a short value. Never the secret. Null on rows from
   * before this was recorded and on a capture-time metadata hit (§5.3, ADR 0076).
   */
  masked_preview: z.string().nullable(),
  /**
   * Salted, non-reversible fingerprint of the matched value; the same secret shows the same
   * fingerprint across sessions, so an admin can see one key recur. Null when unrecorded.
   */
  fingerprint: z.string().nullable(),
  /** Length of the matched value in characters, or null when unrecorded. */
  match_length: nonnegativeIntegerSchema.nullable(),
  redacted_at: utcDateTimeSchema,
});
export const redactionHitSortKeys = ["redacted_at", "count", "seq"] as const;
export const redactionHitsInputSchema = createListInputSchema(
  redactionHitSortKeys,
).extend({
  filters: z
    .strictObject({
      run_id: sessionIdSchema.optional(),
      session_id: sessionIdSchema.optional(),
      policy_id: sessionIdSchema.optional(),
      source: redactionSourceSchema.optional(),
      /** Case-insensitive match on the applying policy's name. */
      q: z.string().trim().min(1).max(filterTextMaxLength).optional(),
    })
    .default({}),
});
export const redactionHitsOutputSchema = paginatedOutput(redactionHitSchema);

/** One rescan run with its progress and the sessions it changed. */
export const redactionRunSchema = z.strictObject({
  id: sessionIdSchema,
  state: redactionRunStateSchema,
  created_at: utcDateTimeSchema,
  updated_at: utcDateTimeSchema,
  total_sessions: nonnegativeIntegerSchema,
  processed_sessions: nonnegativeIntegerSchema,
  /** Targets the run applied at least one redaction to. */
  changed_sessions: nonnegativeIntegerSchema,
  redaction_count: nonnegativeIntegerSchema,
  error: z.string().nullable(),
});
export const redactionRunSortKeys = [
  "created_at",
  "state",
  "redaction_count",
  "total_sessions",
] as const;
export const redactionRunsInputSchema =
  createListInputSchema(redactionRunSortKeys);
export const redactionRunsOutputSchema = paginatedOutput(redactionRunSchema);

/** One target of a run: when it was checkpointed and how many redactions the run applied to it. */
export const redactionRunSessionSchema = z.strictObject({
  run_id: sessionIdSchema,
  session_id: sessionIdSchema,
  processed_at: utcDateTimeSchema.nullable(),
  redaction_count: nonnegativeIntegerSchema,
});
export const redactionRunSessionSortKeys = [
  "processed_at",
  "redaction_count",
] as const;
export const redactionRunSessionsInputSchema = createListInputSchema(
  redactionRunSessionSortKeys,
).extend({
  filters: z
    .strictObject({
      /** Default: only the targets the run changed. `false` lists every target. */
      changed: z.boolean().default(true),
    })
    .default({ changed: true }),
});
export const redactionRunSessionsOutputSchema = paginatedOutput(
  redactionRunSessionSchema,
);

/** Redactions applied in a window, split by what applied them. */
const redactionWindowSchema = z.strictObject({
  capture: nonnegativeIntegerSchema,
  rescan: nonnegativeIntegerSchema,
  total: nonnegativeIntegerSchema,
});
/** The organization's redaction ledger in one read: totals, recent windows, per policy and runs. */
export const redactionSummaryOutputSchema = z.strictObject({
  /** Every redaction ever counted for a policy that still exists. */
  total: nonnegativeIntegerSchema,
  /** Distinct sessions with at least one counted redaction. */
  sessions: nonnegativeIntegerSchema,
  last_7_days: redactionWindowSchema,
  last_30_days: redactionWindowSchema,
  by_policy: z.array(
    z.strictObject({
      policy_id: sessionIdSchema,
      name: z.string(),
      kind: policyKindSchema,
      enabled: z.boolean(),
      count: nonnegativeIntegerSchema,
      sessions: nonnegativeIntegerSchema,
      /**
       * Distinct fingerprints recorded for this policy: how many different secrets it caught.
       * A lower bound, since a message with two different secrets of one policy keeps one
       * representative fingerprint (§5.3, ADR 0076).
       */
      distinct_secrets: nonnegativeIntegerSchema,
    }),
  ),
  runs: z.strictObject({
    total: nonnegativeIntegerSchema,
    /** Queued or running. */
    active: nonnegativeIntegerSchema,
    failed: nonnegativeIntegerSchema,
  }),
});
