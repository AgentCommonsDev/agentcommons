import { ingestContextSchema } from "./ingest-context.js";
export { gitContextSchema, parentHintSchema } from "./ingest-context.js";
import * as z from "zod";
import {
  harnessSchema,
  jsonObjectSchema,
  nonnegativeIntegerSchema,
  nullableTextSchema,
  sessionIdSchema,
  utcDateTimeSchema,
  sha256Schema,
} from "./common.js";

export const sourceRecordSchema = z.strictObject({
  pos: nonnegativeIntegerSchema,
  key: z.string().min(1).nullable().optional(),
  sourceVersion: nonnegativeIntegerSchema.default(0),
  line: z.string(),
});
export const observedCommitSchema = z.strictObject({
  sha: z.string().min(1),
  subject: z.string(),
  author: z.string(),
  timestamp: utcDateTimeSchema.nullable(),
});
/** The bundle digests a shim reports; they match `hookManifestSchema` when current. */
export const hookIdentitySchema = z.strictObject({
  sha256: sha256Schema,
  extensionSha256: sha256Schema.nullable(),
});
/** `/hook/manifest.json`: the artifacts an instance serves and expects installations to run. */
export const hookManifestSchema = z.strictObject({
  version: z.string().min(1).max(64),
  sha256: sha256Schema,
  url: z.string().min(1),
  extensionSha256: sha256Schema,
  extensionUrl: z.string().min(1),
});
export type HookIdentity = z.infer<typeof hookIdentitySchema>;
export type HookManifest = z.infer<typeof hookManifestSchema>;
export const ingestEnvelopeSchema = z
  .strictObject({
    envelopeVersion: z.literal(2),
    harness: harnessSchema,
    harnessSessionId: z.string().min(1),
    behavior: z.enum(["start", "sync", "end"]),
    nativeEvent: z.string().min(1),
    start: z.strictObject({ resume: z.boolean() }).nullable().default(null),
    batchId: sessionIdSchema,
    installationId: sessionIdSchema,
    /** Digests of the shim files that produced this batch; the server records them per installation. */
    hook: hookIdentitySchema,
    sentAt: utcDateTimeSchema,
    sourcePos: nonnegativeIntegerSchema,
    context: ingestContextSchema,
    records: z.array(sourceRecordSchema),
    cursor: z.string(),
    end: z
      .strictObject({
        reason: nullableTextSchema,
        head: nullableTextSchema,
        observedCommits: z.array(observedCommitSchema),
        observedDiffStat: jsonObjectSchema.nullable(),
        dirtyFileCount: nonnegativeIntegerSchema.nullable(),
      })
      .nullable(),
  })
  .refine(
    (envelope) => envelope.start === null || envelope.behavior === "start",
    { path: ["start"], error: "Start metadata requires a start event." },
  )
  .refine(
    (envelope) =>
      envelope.records.every((record) => record.pos <= envelope.sourcePos),
    {
      path: ["sourcePos"],
      error:
        "The observed source position must cover every record in the batch.",
    },
  )
  .refine(
    (envelope) =>
      envelope.records.every(
        (record, index) =>
          index === 0 || record.pos >= (envelope.records[index - 1]?.pos ?? 0),
      ),
    {
      path: ["records"],
      error: "Send records in source order.",
    },
  );
export const ingestOutputSchema = z.strictObject({
  publication: z.enum(["queued", "published"]),
  sessionId: sessionIdSchema,
  accepted: nonnegativeIntegerSchema,
  duplicates: nonnegativeIntegerSchema,
  cursor: z.string(),
});
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;
export type IngestRecord = z.infer<typeof sourceRecordSchema>;
export type IngestOutput = z.infer<typeof ingestOutputSchema>;
