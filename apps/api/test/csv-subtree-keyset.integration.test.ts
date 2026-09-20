import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { SessionService } from "../src/services/session.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { sessionDescendants } from "../src/repositories/read-model.js";
import {
  releaser,
  syntheticContext,
  syntheticOrganization,
} from "./support.js";

/**
 * The CSV subtree export (R-DASH-38, ADR 0086) enumerates every caller-visible descendant
 * of the root through `sessionDescendants`, paged with a `(started_at,id)` keyset in blocks
 * of `DESCENDANT_PAGE = 500`. The fixtures every session shares one `started_at`, so these
 * tests force the keyset onto its `id` (UUID) tiebreaker, the case a `started_at`-only
 * keyset would loop on or drop rows at. They assert the enumeration crosses every page
 * boundary returning the whole subtree exactly once, in a stable order, with no gap or
 * duplicate, and that the real export streams the same set.
 */
const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let writer: Client;
let sessions: SessionService;
const org = "org-a";
const keyId = "key-a";
const installationId = randomUUID();
const started = new Date("2026-08-01T00:00:00Z");
const context = (
  options?: Parameters<typeof syntheticContext>[1],
): ServiceContext => syntheticContext(org, options);

/** One control row of a subtree; publication and PUBLIC visibility make it caller-visible. */
function controlRow(
  id: string,
  parent: string | null,
  visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
  startedAt: Date = started,
) {
  return {
    id,
    organizationId: org,
    harness: "CODEX" as const,
    nativeIdentity: id,
    harnessSessionId: id,
    userId: "owner",
    ingestApiKeyId: keyId,
    installationId,
    startedAt,
    lastActivityAt: startedAt,
    parentSessionId: parent,
    parentRelation: parent ? ("SUBAGENT" as const) : null,
    visibility,
    publishedRevision: 1n,
    acceptedRevision: 1n,
    projectionState: "published",
  };
}

/**
 * A subtree of `count` descendants under a fresh root, written straight to compact control
 * (the only relation `sessionDescendants` reads). Nesting is real — a descendant's parent is
 * an earlier descendant once past the first `branch` — so a deep node whose UUID sorts early
 * still lands on an early keyset page, proving the walk is complete regardless of tree depth.
 */
async function seedSubtree(
  count: number,
  options: {
    branch?: number;
    visibility?: (index: number) => "PUBLIC" | "PRIVATE";
    startedAt?: (index: number) => Date;
  } = {},
): Promise<{ root: string; descendants: string[] }> {
  const branch = options.branch ?? 50;
  const root = randomUUID();
  const descendants = Array.from({ length: count }, () => randomUUID());
  const rows = [controlRow(root, null)];
  descendants.forEach((id, index) => {
    const parentIndex = index - branch;
    const parent = parentIndex < 0 ? root : (descendants[parentIndex] ?? root);
    rows.push(
      controlRow(
        id,
        parent,
        options.visibility?.(index) ?? "PUBLIC",
        options.startedAt?.(index) ?? started,
      ),
    );
  });
  await db.prisma.traceSessionControl.createMany({ data: rows });
  return { root, descendants };
}

/** The order the keyset walks: exactly `ORDER BY started_at,id` over the given ids. */
async function keysetOrder(ids: string[]): Promise<string[]> {
  const result = await writer.query<{ id: string }>(
    `SELECT id::text AS id FROM public.trace_session_control
     WHERE organization_id=$1 AND id = ANY($2::uuid[]) ORDER BY started_at, id`,
    [org, ids],
  );
  return result.rows.map((row) => row.id);
}

/** The whole subtree under `root`, enumerated as the given caller through the reader fence. */
function enumerate(ctx: ServiceContext, root: string): Promise<string[]> {
  const caller = requireCaller(ctx);
  return db.traceReaders.read(caller, (client) =>
    sessionDescendants(client, caller, root),
  );
}

/** A session's control row plus one text message, the way the read fixtures publish them. */
async function seedSessionWithMessage(
  id: string,
  parent: string | null,
  content: string,
): Promise<void> {
  await fixtures.session({
    id,
    organizationId: org,
    userId: "owner",
    keyId,
    installationId,
    ...(parent ? { parent } : {}),
    fields: {
      title: "keyset export fixture",
      repo_name: "host/team/repo",
      branch: "main",
      model: "test-model",
      models_used: ["test-model"],
      tools_used: ["Read"],
      input_tokens: "1",
      output_tokens: "1",
    },
  });
  const raw = randomUUID();
  await fixtures.insert("raw_records", id, {
    raw_record_id: raw,
    ingest_batch_id: randomUUID(),
    pos: "0",
    record_type: "message",
    payload: JSON.stringify({ content }),
    redaction_context: "null",
    received_at: started,
  });
  await fixtures.insert("messages", id, {
    message_id: randomUUID(),
    raw_record_id: raw,
    ingest_batch_id: randomUUID(),
    seq: 0,
    block_index: 0,
    role: "USER",
    kind: "TEXT",
    content,
    tool_name: null,
    tool_input: "null",
    searchable: true,
    search_text: content,
    timestamp: "2026-08-01T00:00:00Z",
    received_at: started,
    input_tokens: "1",
    output_tokens: "1",
  });
}

/** Every message row the CSV export streams for `root`, as this caller. */
async function exportRows(
  ctx: ServiceContext,
  root: string,
): Promise<{ session_id: string; seq: number }[]> {
  const output = await sessions.export(ctx, {
    session_id: root,
    format: "csv",
  });
  const rows: { session_id: string; seq: number }[] = [];
  for await (const row of output.rows)
    rows.push({ session_id: row.session_id, seq: row.seq });
  return rows;
}

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  writer = new Client({ connectionString: db.urls.migration });
  await writer.connect();
  defer(() => writer.end());
  sessions = new SessionService({
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("csv-subtree-keyset-cursor-secret-with-entropy"),
  });
  await syntheticOrganization(db, {
    organizationId: org,
    keyId,
    installationId,
  });
});
afterAll(release);

// @req R-DASH-38
it("enumerates the whole subtree exactly once across every keyset page boundary", async () => {
  // 500: one page, no phantom continuation. 501: the first crossing (500 + 1).
  // 1000: two exact pages (500 + 500), the second must not spawn a third.
  // 1150: three pages ending on a partial one.
  for (const count of [500, 501, 1000, 1150]) {
    const { root, descendants } = await seedSubtree(count);
    const result = await enumerate(context(), root);
    // Complete and root-excluded.
    expect(result).not.toContain(root);
    expect(new Set(result)).toEqual(new Set(descendants));
    // Exactly once: no duplicate at a page boundary or at the (started_at,id) tie.
    expect(result).toHaveLength(count);
    expect(new Set(result).size).toBe(count);
    // Stable, gap-free keyset order carried unchanged across the page joins.
    expect(result).toEqual(await keysetOrder(descendants));
  }
}, 180_000);

// @req R-DASH-38
it("keeps the keyset order when started_at varies and repeats across pages", async () => {
  // started_at collides in blocks of 40 so the id tiebreaker decides order inside a block,
  // and the block boundary falls inside the 500-row page rather than on it.
  const count = 1120;
  const { root, descendants } = await seedSubtree(count, {
    startedAt: (index) =>
      new Date(started.getTime() + Math.floor(index / 40) * 1000),
  });
  const result = await enumerate(context(), root);
  expect(result).toHaveLength(count);
  expect(new Set(result)).toEqual(new Set(descendants));
  expect(result).toEqual(await keysetOrder(descendants));
}, 180_000);

// @req R-DASH-38 @req R-MOD-01
it("applies caller visibility while paging the subtree", async () => {
  // Private descendants interleave with public ones across more than one page, so the
  // visibility predicate has to hold through the keyset continuation, not just page one.
  const count = 620;
  const { root, descendants } = await seedSubtree(count, {
    visibility: (index) => (index % 3 === 0 ? "PRIVATE" : "PUBLIC"),
  });
  const publicIds = descendants.filter((_, index) => index % 3 !== 0);
  const asMember = await enumerate(context(), root);
  const asAdmin = await enumerate(context({ admin: true }), root);
  // A member sees every public descendant, in keyset order, and no private one — a hidden
  // parent still does not hide its public descendants.
  expect(asMember).toEqual(await keysetOrder(publicIds));
  // An admin sees the whole subtree, still exactly once and in the same order.
  expect(asAdmin).toEqual(await keysetOrder(descendants));
  expect(asAdmin).toHaveLength(count);
}, 180_000);

// @req R-DASH-38
it("streams the whole nested subtree through the real CSV export, each descendant once", async () => {
  // Root plus a small nested subtree so the export's descendant loop is exercised whole:
  // grandchildren and a fork, some under earlier descendants.
  const root = randomUUID();
  await seedSessionWithMessage(root, null, "root prompt one");
  await fixtures.insert("messages", root, {
    message_id: randomUUID(),
    raw_record_id: randomUUID(),
    ingest_batch_id: randomUUID(),
    seq: 1,
    block_index: 0,
    role: "ASSISTANT",
    kind: "TEXT",
    content: "root reply two",
    tool_name: null,
    tool_input: "null",
    searchable: true,
    search_text: "root reply two",
    timestamp: "2026-08-01T00:00:00Z",
    received_at: started,
    input_tokens: "1",
    output_tokens: "1",
  });
  const descendants = Array.from({ length: 6 }, () => randomUUID());
  const parents = [
    root,
    root,
    descendants[0],
    descendants[1],
    descendants[2],
    root,
  ];
  for (const [index, id] of descendants.entries())
    await seedSessionWithMessage(
      id,
      parents[index] ?? root,
      `descendant ${id}`,
    );
  const rows = await exportRows(context(), root);
  // The root's own messages come first in seq order.
  expect(rows.slice(0, 2)).toEqual([
    { session_id: root, seq: 0 },
    { session_id: root, seq: 1 },
  ]);
  const descendantRows = rows.slice(2);
  // Every descendant appears exactly once, attributed by its own session_id.
  expect(descendantRows.map((row) => row.session_id)).toEqual(
    await keysetOrder(descendants),
  );
  expect(new Set(descendantRows.map((row) => row.session_id)).size).toBe(6);
}, 180_000);

// @req R-DASH-38
it("streams a >500-descendant subtree through the real CSV export with no gap or duplicate", async () => {
  // The heavy end-to-end proof: a subtree past the DESCENDANT_PAGE boundary, every
  // descendant carrying one message, exported through session.ts and read back whole.
  const count = 505;
  const root = randomUUID();
  await seedSessionWithMessage(root, null, "export root");
  const descendants = Array.from({ length: count }, () => randomUUID());
  for (const [index, id] of descendants.entries())
    await seedSessionWithMessage(
      id,
      index < 50 ? root : (descendants[index - 50] ?? root),
      `descendant ${id}`,
    );
  const rows = await exportRows(context(), root);
  const descendantIds = rows
    .filter((row) => row.session_id !== root)
    .map((row) => row.session_id);
  // The subtree is covered regardless of pagination: the whole set, each exactly once,
  // in the keyset order the enumeration produced across its page boundary.
  expect(descendantIds).toHaveLength(count);
  expect(new Set(descendantIds)).toEqual(new Set(descendants));
  expect(descendantIds).toEqual(await keysetOrder(descendants));
}, 300_000);
