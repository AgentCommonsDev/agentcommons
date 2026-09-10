import type { TraceReadClient } from "@agentcommons/traces";
import { messageContent } from "@agentcommons/core/format";
import { traceJson } from "./read-model.js";

/** Raw payload bytes one batch may pull from ClickHouse, under the reader's 32 MB result cap. */
const RAW_BATCH_BYTES = 8 * 1024 * 1024;
/**
 * Keep payload transfers bounded; one oversized row still makes forward progress. `weigh`
 * says what a row costs against `byteBudget`: its whole payload by default, or the slice
 * a page will actually carry, so a page of bounded previews reads every row it needs at
 * once while the raw bytes fetched stay under `RAW_BATCH_BYTES`.
 */
export function* messagePayloadBatches(
  metadata: readonly Record<string, unknown>[],
  byteBudget: number,
  weigh: (row: Record<string, unknown>) => number = (row) =>
    Number(row.payload_bytes),
): Generator<Record<string, unknown>[], void> {
  let batch: Record<string, unknown>[] = [];
  let weight = 0;
  let raw = 0;
  for (const row of new Map(
    metadata.map((value) => [value.message_id, value]),
  ).values()) {
    const size = Number(row.payload_bytes);
    const cost = weigh(row);
    if (
      batch.length &&
      (weight + cost > byteBudget || raw + size > RAW_BATCH_BYTES)
    ) {
      yield batch;
      batch = [];
      weight = 0;
      raw = 0;
    }
    batch.push(row);
    weight += cost;
    raw += size;
  }
  if (batch.length) yield batch;
}

export async function readMessagePayloads(
  client: TraceReadClient,
  metadata: readonly Record<string, unknown>[],
) {
  if (!metadata.length) return [];
  const result = await client.query(
    "SELECT message_id,content,tool_input FROM api_ro.messages WHERE session_id IN {sessions:Array(UUID)} AND message_id IN {ids:Array(UUID)}",
    {
      sessions: [...new Set(metadata.map((row) => String(row.session_id)))],
      ids: metadata.map((row) => String(row.message_id)),
    },
  );
  if (result.rows.length !== metadata.length)
    throw new Error("The published message payload is unavailable.");
  return result.rows;
}

/** The text a reader sees for one message row: its content, plus the tool input of a TOOL_USE. */
export function messageText(row: Record<string, unknown>): string {
  return messageContent(
    String(row.content),
    String(row.kind),
    row.tool_input === undefined ? undefined : traceJson(row.tool_input),
  );
}
