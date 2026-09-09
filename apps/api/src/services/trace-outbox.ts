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
export const traceOutboxPayloadSchema = z.strictObject({
  envelope: ingestEnvelopeSchema,
  records: z.array(recordSchema),
  normalizerContext: normalizerContextSchema,
  lifecycleApplied: z.boolean(),
  contextApplied: z.boolean(),
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
