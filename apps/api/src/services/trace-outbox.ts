import { z } from "zod";
import {
  decimalIntegerSchema,
  ingestEnvelopeSchema,
  jsonObjectSchema,
  normalizerContextSchema,
  redactionContextSchema,
  type SourceRecord,
} from "@agentcommons/core";
import type { Prisma } from "@agentcommons/db";

/** Where an accepted outbox row waits for the projection worker; `JobService` implements it. */
export interface TraceQueue {
  enqueue(
    tx: Prisma.TransactionClient,
    data: { organizationId: string; sessionId: string; outboxId: string },
  ): Promise<void>;
}
const recordSchema = z.strictObject({
  id: z.uuid(),
  pos: decimalIntegerSchema,
  key: z.string().nullable(),
  sourceVersion: z.number().int().nonnegative(),
  payload: jsonObjectSchema,
  receivedAt: z.iso.datetime(),
  redactionContext: redactionContextSchema,
});
/**
 * One policy's hits on one accepted record, or on the batch's metadata (envelope, context,
 * keys) when `recordId` is null. The projection turns them into per-message rows once it
 * knows which message each record became (§5.3).
 */
export const outboxRedactionSchema = z.strictObject({
  recordId: z.uuid().nullable(),
  policyId: z.uuid(),
  count: z.number().int().positive(),
  // Identifying metadata for a representative match, never the secret. Defaulted so rows
  // queued before these fields existed still parse; null on metadata remainder hits, which
  // are computed by subtraction and carry no single value (§5.3, ADR 0076).
  preview: z.string().nullable().default(null),
  fingerprint: z.string().nullable().default(null),
  length: z.number().int().nonnegative().nullable().default(null),
});
export const traceOutboxPayloadSchema = z.strictObject({
  envelope: ingestEnvelopeSchema,
  records: z.array(recordSchema),
  normalizerContext: normalizerContextSchema,
  lifecycleApplied: z.boolean(),
  contextApplied: z.boolean(),
  // Default for rows queued before the field existed.
  redactions: z.array(outboxRedactionSchema).default([]),
});
export function outboxRecord(record: SourceRecord) {
  return recordSchema.parse({
    ...record,
    pos: String(record.pos),
    receivedAt: record.receivedAt.toISOString(),
    redactionContext: record.redactionContext ?? {},
  });
}
export function sourceFromOutbox(
  record: z.infer<typeof recordSchema>,
): SourceRecord {
  return {
    ...record,
    pos: BigInt(record.pos),
    receivedAt: new Date(record.receivedAt),
  };
}
