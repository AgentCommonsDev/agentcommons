import type { TraceReadClient } from "@agentcommons/traces";
import { messageContent } from "@agentcommons/core/format";
import { traceJson } from "./read-model.js";

/** Keep payload transfers bounded; one oversized row still makes forward progress. */
export function* messagePayloadBatches(
  metadata: readonly Record<string, unknown>[],
  byteBudget: number,
): Generator<Record<string, unknown>[], void> {
  let batch: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const row of new Map(
    metadata.map((value) => [value.message_id, value]),
  ).values()) {
    const size = Number(row.payload_bytes);
    if (batch.length && bytes + size > byteBudget) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
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
