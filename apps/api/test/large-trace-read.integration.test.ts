import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { provisionOrganization, releaser } from "./support.js";
import { requireCaller } from "../src/services/context.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import { CursorCodec } from "../src/services/cursor.js";
import { formatGet } from "@agentcommons/core/format";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let fixtures: TraceFixtures;
let service: SessionService;
let id: string;
const { defer, release } = releaser();
/** One installation shared by every fixture session of the organization. */
const installationId = randomUUID();
const content = "界🙂".repeat(75_000);
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  org = await provisionOrganization(db, "large-trace-read");
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  ({ id } = await fixtures.sessionFor(org.context, { installationId }));
  for (let seq = 0; seq < 80; seq++)
    await fixtures.insert("messages", id, {
      message_id: randomUUID(),
      seq,
      role: "TOOL_RESULT",
      kind: "TOOL_RESULT",
      content,
      tool_input: "null",
      search_text: content.slice(0, 510) + content.slice(-510),
      searchable: true,
      received_at: new Date(),
    });
  service = new SessionService({
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("large-read-cursor-fixture-long-secret"),
  });
});
afterAll(release);
// @req R-GET-02
it("reads a bounded UTF-8 page from eighty large tool outputs without fetching the entire transcript", async () => {
  await expect(
    db.traceReaders.read(requireCaller(org.context), (client) =>
      client.query(
        "SELECT * FROM messages WHERE session_id={id:UUID} ORDER BY seq LIMIT 101",
        { id },
      ),
    ),
  ).rejects.toThrow(/limit|memory/i);
  const page = (await service.get(org.context, { session_id: id })).result;
  expect(page.messages[0]?.content).toBe(
    content.slice(0, page.messages[0]?.content.length),
  );
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(32768);
  expect(Buffer.byteLength(formatGet(page).text)).toBeLessThanOrEqual(32768);
  expect(page.next?.seq).toBe(0);
  expect(page.next?.offset).toBeGreaterThan(0);
});
// @req R-GET-01 @req R-GET-02
it("preserves exact UTF-8 continuations at large-message boundaries and rejects interior-byte offsets", async () => {
  const bytes = Buffer.from(content);
  for (const offset of [262_500, bytes.length - 14]) {
    const page = (
      await service.get(org.context, {
        session_id: id,
        cursor: { seq: 79, offset },
      })
    ).result;
    const item = page.messages[0];
    if (!item) throw new Error("Expected content continuation");
    expect(Buffer.from(item.content)).toEqual(
      bytes.subarray(offset, offset + Buffer.byteLength(item.content)),
    );
    expect(page.next).toEqual(
      offset === bytes.length - 14
        ? null
        : { seq: 79, offset: offset + Buffer.byteLength(item.content) },
    );
  }
  const crossing = (
    await service.get(org.context, {
      session_id: id,
      cursor: { seq: 0, offset: bytes.length - 14 },
    })
  ).result;
  expect(crossing.messages[0]?.content).toBe("界🙂界🙂");
  expect(crossing.next).toEqual({ seq: 1, offset: 0 });
  await expect(
    service.get(org.context, { session_id: id, cursor: { seq: 0, offset: 1 } }),
  ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CURSOR" });
});

// @req R-SRCH-08 @req R-SRCH-09
it("bounds large context payload retrieval without losing a match near the end of tool output", async () => {
  const text = " ".repeat(525_000) + "edgepayloadneedle";
  for (let index = 0; index < 12; index++) {
    const { id: sessionId } = await fixtures.sessionFor(org.context, {
      installationId,
    });
    for (let seq = 0; seq < 3; seq++)
      await fixtures.insert("messages", sessionId, {
        message_id: randomUUID(),
        seq,
        role: "TOOL_RESULT",
        kind: "TOOL_RESULT",
        content: text,
        search_text: text.slice(0, 2048) + text.slice(-2048),
        tool_input: "null",
        searchable: true,
        received_at: new Date(),
      });
  }
  const search = new SearchService({
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("large-search-cursor-fixture-long-secret"),
  });
  const result = (
    await search.execute(org.context, {
      query: "edgepayloadneedle",
      limit: 50,
      context: 3,
    })
  ).result;
  expect(result.blocks.length).toBeGreaterThan(0);
  expect(
    result.blocks
      .flatMap((block) => block.messages)
      .every((message) => message.content.includes("edgepayloadneedle")),
  ).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768);
});

// @req R-GET-02
it("computes metadata before aggregating a thousand large message payloads", async () => {
  const caller = requireCaller(org.context);
  const { id: large } = await fixtures.sessionFor(org.context, {
    installationId,
    fields: { message_count: 1000 },
  });
  await fixtures.client.command({
    query:
      "INSERT INTO ac_trace.messages SELECT * REPLACE({large:UUID} AS session_id,generateUUIDv4() AS message_id,toUInt32(number) AS seq,toInt64(1) AS revision) EXCEPT(number) FROM (SELECT * FROM ac_trace.messages WHERE session_id={id:UUID} LIMIT 1) AS original CROSS JOIN numbers(1000) AS counter",
    query_params: { id, large },
  });
  await expect(
    db.traceReaders.read(caller, (client) =>
      client.query(
        "SELECT message_id,seq,length(content)+length(tool_input) AS payload_bytes FROM messages WHERE session_id={id:UUID} ORDER BY seq LIMIT 101",
        { id: large },
      ),
    ),
  ).rejects.toThrow(/memory|limit/i);
  const result = (await service.get(org.context, { session_id: large })).result;
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]?.content).toBe(
    content.slice(0, result.messages[0]?.content.length),
  );
  expect(result.next?.seq).toBe(0);
  expect(result.next?.offset).toBeGreaterThan(0);
});
// @req R-DASH-38
it("exports a message that spans many bounded pages as one row with its exact stored text", async () => {
  // Every page re-reads this 525 KB payload, so the export starts 35 KB (about nine
  // pages) before the end of the message rather than walking all of it.
  const tail = 5_000;
  const exported = await service.export(org.context, {
    session_id: id,
    from: 0,
    to: 0,
    cursor: { seq: 0, offset: Buffer.byteLength("界🙂".repeat(75_000 - tail)) },
  });
  const rows = [];
  for await (const row of exported.rows) rows.push(row);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.seq).toBe(0);
  expect(rows[0]?.role).toBe("TOOL_RESULT");
  expect(rows[0]?.content).toBe("界🙂".repeat(tail));
  expect(Buffer.byteLength(rows[0]?.content ?? "")).toBeGreaterThan(8 * 4096);
});
