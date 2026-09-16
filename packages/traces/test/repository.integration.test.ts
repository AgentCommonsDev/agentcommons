import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import type { ProjectedMessage } from "@agentcommons/core";
import { cleanup } from "../../../scripts/cleanup.js";
import { startTraceDatabase } from "./support.js";
import { TraceFixtures } from "./fixtures.js";
import {
  EMBEDDING_DIMENSIONS,
  fingerprint,
  type TraceScope,
  type TraceSession,
  type TraceTable,
} from "../src/index.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
const release: Array<() => Promise<unknown>> = [];
const organizationId = "org_native_repository";
const at = new Date("2026-08-01T00:00:00Z");
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  fixtures = new TraceFixtures(db);
  release.unshift(() => fixtures.close());
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});
/** Physical rows of one corpus table for a session, every revision and generation included. */
async function rawRows(table: TraceTable, sessionId: string) {
  const result = await fixtures.client.query({
    query: `SELECT count() AS count FROM ${table} WHERE organization_id={organization:String} AND session_id={session:UUID}`,
    query_params: { organization: organizationId, session: sessionId },
    format: "JSONEachRow",
  });
  return z
    .tuple([z.object({ count: z.coerce.number() })])
    .parse(await result.json())[0].count;
}
/** Reads every page of a keyset-paged repository read, as the publisher does. */
async function drain<Item>(
  page: (
    after: string | null,
  ) => Promise<{ items: Item[]; after: string | null }>,
): Promise<Item[]> {
  const items: Item[] = [];
  let after: string | null = null;
  do {
    const value = await page(after);
    items.push(...value.items);
    after = value.after;
  } while (after);
  return items;
}
function header(sessionId: string, messageCount: number): TraceSession {
  return {
    session_id: sessionId,
    organization_id: organizationId,
    harness: "CODEX",
    harness_session_id: sessionId,
    harness_version: null,
    entrypoint: null,
    user_id: "user_repository",
    ingest_api_key_id: "key_repository",
    installation_id: randomUUID(),
    cwd: "/repo",
    repo_root: null,
    cwd_relative: null,
    repo_url: null,
    repo_name: null,
    branch: null,
    observed_branches: [],
    start_commit: null,
    end_commit: null,
    observed_commits: null,
    observed_diff_stat: null,
    dirty_file_count: null,
    model: null,
    models_used: [],
    started_at: at,
    ended_at: null,
    last_activity_at: at,
    status: "ACTIVE",
    end_reason: null,
    title: "Large session",
    first_prompt: null,
    parent_session_id: null,
    parent_relation: null,
    parent_native_ref: null,
    agent_type: null,
    message_count: messageCount,
    tool_call_count: 0,
    input_tokens: 0n,
    output_tokens: 0n,
    tools_used: [],
  };
}
function message(id: string, seq: number): ProjectedMessage {
  return {
    id,
    raw_record_id: null,
    ingest_batch_id: null,
    block_index: 0,
    seq,
    role: "USER",
    kind: "TEXT",
    content: `message ${String(seq)}`,
    tool_name: null,
    tool_use_id: null,
    tool_input: null,
    model: null,
    timestamp: null,
    received_at: at,
    input_tokens: null,
    output_tokens: null,
    agent_id: null,
    native_id: null,
    parent_native_id: null,
    searchable: true,
    search_text: `message ${String(seq)}`,
  };
}
/**
 * Ids whose text order and native UUID order disagree. ClickHouse compares the last eight
 * bytes of a UUID before the first eight, so the trailing group carries the native rank and
 * the leading group the text rank. Swapping two ranks puts the text-largest id last on the
 * first native page, exactly where a text-compared cursor would end the manifest early.
 */
function messageIds(count: number, pageSize: number): string[] {
  const hex = (value: number, width: number) =>
    value.toString(16).padStart(width, "0");
  const swapped = pageSize - 1;
  return Array.from({ length: count }, (_, text) => {
    const native =
      text === count - 1 ? swapped : text === swapped ? count - 1 : text;
    return `${hex(text, 8)}-0000-4000-8000-${hex(native, 12)}`;
  });
}
// @req R-ING-17
it("returns the complete manifest of a session above one page and republishes it unchanged without new rows", async () => {
  const sessionId = randomUUID();
  const ids = messageIds(1100, 1000);
  const messages = ids.map((id, index) => message(id, index));
  const snapshot = header(sessionId, messages.length);
  const ops = ["read", "edit"];
  const first: TraceScope = {
    organizationId,
    sessionId,
    revision: 1n,
    generation: 0n,
  };
  await db.traces.writeProjection({
    ...first,
    session: snapshot,
    messages: messages.map((value) => ({
      id: value.id,
      message: value,
      fingerprint: fingerprint(value),
    })),
    files: [{ path: "src/index.ts", ops, fingerprint: fingerprint(ops) }],
  });
  const manifest = await drain((after) =>
    db.traces.projectionManifest(first, "messages", { after, limit: 1000 }),
  );
  // Premise of the regression: the pages follow native order, not text order.
  expect(manifest.map((item) => item.id)).not.toEqual([...ids].sort());
  expect(new Set(manifest.map((item) => item.id)).size).toBe(ids.length);
  expect(manifest.map((item) => item.id).sort()).toEqual([...ids].sort());
  const written = new Map(
    messages.map((value) => [value.id, fingerprint(value)]),
  );
  for (const item of manifest)
    expect(item.fingerprint).toBe(written.get(item.id));
  const fileManifest = await drain((after) =>
    db.traces.projectionManifest(first, "files", { after, limit: 1000 }),
  );
  expect(fileManifest).toEqual([
    { id: "src/index.ts", fingerprint: fingerprint(ops) },
  ]);
  // The publisher's delta: whatever the stored manifest does not already hold.
  const stored = new Map(manifest.map((item) => [item.id, item.fingerprint]));
  const changed = messages.filter(
    (value) => stored.get(value.id) !== fingerprint(value),
  );
  const storedFiles = new Map(
    fileManifest.map((item) => [item.id, item.fingerprint]),
  );
  const changedFiles = [{ path: "src/index.ts", ops }].filter(
    (file) => storedFiles.get(file.path) !== fingerprint(file.ops),
  );
  expect(changed).toEqual([]);
  expect(changedFiles).toEqual([]);
  const before = {
    messages: await rawRows("messages", sessionId),
    files: await rawRows("session_files", sessionId),
  };
  expect(before).toEqual({ messages: ids.length, files: 1 });
  const second: TraceScope = { ...first, revision: 2n };
  await db.traces.writeProjection({
    ...second,
    session: snapshot,
    messages: changed.map((value) => ({
      id: value.id,
      message: value,
      fingerprint: fingerprint(value),
    })),
    files: changedFiles.map((file) => ({
      ...file,
      fingerprint: fingerprint(file.ops),
    })),
  });
  expect({
    messages: await rawRows("messages", sessionId),
    files: await rawRows("session_files", sessionId),
  }).toEqual(before);
  // The new revision still resolves every message from the rows revision 1 wrote.
  const visible = await drain((after) =>
    db.traces.messagesPage(second, { after, limit: 1000 }),
  );
  expect(visible.map((value) => value.id).sort()).toEqual([...ids].sort());
});
// @req R-ING-17
it("reclaims rows the published revision superseded and leaves latest, unpublished, other-generation and vector rows alone", async () => {
  const sessionId = randomUUID();
  const scope = (revision: bigint, generation = 0n): TraceScope => ({
    organizationId,
    sessionId,
    revision,
    generation,
  });
  const text = (content: string) => ({
    role: "USER",
    kind: "TEXT",
    tool_input: "null",
    content,
    received_at: at,
  });
  const [a, b, c, d, g] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const rows: Array<[TraceTable, TraceScope, Record<string, unknown>]> = [
    ["messages", scope(1n), { message_id: a, ...text("a1") }],
    ["messages", scope(2n), { message_id: a, ...text("a2") }],
    ["messages", scope(1n), { message_id: b, ...text("b1") }],
    // Accepted but not yet published.
    ["messages", scope(3n), { message_id: c, ...text("c3") }],
    ["messages", scope(1n), { message_id: d, ...text("d1") }],
    ["messages", scope(2n), { message_id: d, ...text(""), deleted: 1 }],
    // A later redaction generation still being built.
    ["messages", scope(1n, 1n), { message_id: g, ...text("g1") }],
  ];
  const head = {
    harness: "CODEX",
    harness_session_id: sessionId,
    installation_id: randomUUID(),
    status: "ACTIVE",
    observed_commits: "null",
    observed_diff_stat: "null",
    started_at: at,
    last_activity_at: at,
  };
  rows.push(
    ["sessions", scope(1n), { ...head, title: "first" }],
    ["sessions", scope(2n), { ...head, title: "second" }],
    [
      "session_files",
      scope(1n),
      { file_id: "f1", path: "src/a.ts", ops: ["read"] },
    ],
    [
      "session_files",
      scope(2n),
      { file_id: "f1", path: "src/a.ts", ops: ["read", "edit"] },
    ],
  );
  // Vector rows publish per vector epoch, not per source revision.
  const chunk = {
    chunk_id: randomUUID(),
    message_id: a,
    model: "test",
    embedding: Array<number>(EMBEDDING_DIMENSIONS).fill(0),
  };
  rows.push(
    ["message_chunks", scope(1n), chunk],
    ["message_chunks", scope(2n), chunk],
  );
  for (const [table, target, fields] of rows)
    await fixtures.insertRaw(table, target, fields);
  const published = scope(2n);
  const resolve = async () => ({
    messages: (
      await db.traces.messagesPage(published, { after: null, limit: 100 })
    ).items
      .map((value) => [value.id, value.content])
      .sort(),
    session: await db.traces.readSession(organizationId, sessionId, 2n, 0n),
    files: await drain((after) =>
      db.traces.projectionManifest(published, "files", { after, limit: 100 }),
    ),
  });
  const counts = async () => ({
    messages: await rawRows("messages", sessionId),
    sessions: await rawRows("sessions", sessionId),
    session_files: await rawRows("session_files", sessionId),
    message_chunks: await rawRows("message_chunks", sessionId),
  });
  const before = await resolve();
  expect(before.messages).toEqual(
    [
      [a, "a2"],
      [b, "b1"],
    ].sort(),
  );
  expect(before.session?.title).toBe("second");
  expect(before.files).toEqual([
    { id: "src/a.ts", fingerprint: "a".repeat(64) },
  ]);
  expect(await counts()).toEqual({
    messages: 7,
    sessions: 2,
    session_files: 2,
    message_chunks: 2,
  });
  await db.traces.deleteSupersededRevisions(published);
  expect(await counts()).toEqual({
    messages: 5,
    sessions: 1,
    session_files: 1,
    message_chunks: 2,
  });
  expect(await resolve()).toEqual(before);
  const survivors = await fixtures.client.query({
    query:
      "SELECT toString(message_id) AS id, revision, generation FROM messages WHERE organization_id={organization:String} AND session_id={session:UUID}",
    query_params: { organization: organizationId, session: sessionId },
    format: "JSONEachRow",
  });
  expect(
    z
      .array(
        z.object({
          id: z.uuid(),
          revision: z.coerce.number(),
          generation: z.coerce.number(),
        }),
      )
      .parse(await survivors.json())
      .map(
        (row) => `${String(row.generation)}:${String(row.revision)}:${row.id}`,
      )
      .sort(),
  ).toEqual(
    [`0:2:${a}`, `0:1:${b}`, `0:3:${c}`, `0:2:${d}`, `1:1:${g}`].sort(),
  );
  // Running it again is a no-op.
  await db.traces.deleteSupersededRevisions(published);
  expect(await counts()).toEqual({
    messages: 5,
    sessions: 1,
    session_files: 1,
    message_chunks: 2,
  });
});
