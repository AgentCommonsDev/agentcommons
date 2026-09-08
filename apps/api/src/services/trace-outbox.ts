import { z } from "zod";
import {
  ingestEnvelopeSchema,
  jsonObjectSchema,
  normalizerContextSchema,
  redactionContextSchema,
  type SourceRecord,
} from "@agentcommons/core";
const recordSchema = z.strictObject({
  id: z.uuid(),
  pos: z.string().regex(/^\d+$/),
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
