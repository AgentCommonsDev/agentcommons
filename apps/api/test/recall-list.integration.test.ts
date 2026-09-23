import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { CursorCodec } from "../src/services/cursor.js";
import { SessionService } from "../src/services/session.js";
import {
  releaser,
  syntheticContext,
  syntheticOrganization,
} from "./support.js";

/**
 * Recall ranking (§7.6): `GET /sessions?recall=true` orders a repository's roots by proven
 * value — `reuse_count` descending, then `started_at` descending — for the install hook's
 * cache, and attaches a compact `files` preview (up to 3 paths) so a recalled session reads
 * at a glance. The distilled fields (`reuse_count`, `by_teammate`, `message_count`,
 * `end_reason`) are the header's own, so the mode only fixes the order and the files sample.
 */
const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let sessions: SessionService;

const org = "recall-list-org";
const ownerId = "recall-list-owner";
const mateId = "recall-list-mate";
const ownerKey = "recall-list-key";
const mateKey = "recall-list-key-mate";
const installationId = randomUUID();
const REPO = "host/team/recall";
const OTHER_REPO = "host/team/other";
const READERS_REPO = "host/team/readers";
const ids = {
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
  d: randomUUID(),
  other: randomUUID(),
};

const owner = () => syntheticContext(org, { userId: ownerId });

async function seed(options: {
  id: string;
  userId: string;
  keyId: string;
  repo: string;
  startedAt: string;
  messageCount: number;
  endReason?: string | null;
  files?: { path: string; ops: string[] }[];
}): Promise<void> {
  const at = new Date(options.startedAt);
  await fixtures.session({
    id: options.id,
    organizationId: org,
    userId: options.userId,
    keyId: options.keyId,
    installationId,
    visibility: "PUBLIC",
    fields: {
      title: `Session ${options.id.slice(0, 4)}`,
      repo_name: options.repo,
      branch: "main",
      started_at: at,
      last_activity_at: at,
      message_count: options.messageCount,
      end_reason: options.endReason ?? null,
      models_used: [],
      tools_used: [],
    },
  });
  for (const file of options.files ?? [])
    await fixtures.insert("session_files", options.id, {
      file_id: file.path,
      path: file.path,
      ops: file.ops,
    });
}

/** One `get` reuse edge crediting `source`'s read of `target`; distinct sources lift reuse_count. */
const edge = (source: string, target: string) => ({
  organization_id: org,
  session_id: source,
  audit_id: randomUUID(),
  read_at: new Date("2026-08-20T00:00:00Z"),
  action: "get" as const,
  target_session_id: target,
  reader_user_id: ownerId,
  reader_email: null,
  reader_harness: "CLAUDE_CODE" as const,
});

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  sessions = new SessionService({
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("recall-list-cursor-secret-with-enough-entropy"),
  });
  await syntheticOrganization(db, {
    organizationId: org,
    keyId: ownerKey,
    installationId,
    userId: ownerId,
  });
  // A second member authors one session so `by_teammate` can be true for the caller.
  await db.prisma.user.upsert({
    where: { id: mateId },
    create: { id: mateId, name: "Mate", email: `${mateId}@example.test` },
    update: {},
  });
  await db.prisma.member.create({
    data: {
      id: `member-${mateId}`,
      organizationId: org,
      userId: mateId,
      role: "member",
      createdAt: new Date(),
    },
  });
  await db.prisma.apikey.create({
    data: {
      id: mateKey,
      referenceId: org,
      key: `fixture-hash-${mateKey}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: JSON.stringify({ sessions: ["ingest", "read"] }),
    },
  });
  await db.prisma.apiKeyOwner.create({
    data: { keyId: mateKey, organizationId: org, userId: mateId },
  });
  // Four roots in the target repo, one owner root in another repo (repo scoping), and three
  // reader roots in a third repo whose reuse edges lift reuse_count without joining the page.
  await seed({
    id: ids.a,
    userId: ownerId,
    keyId: ownerKey,
    repo: REPO,
    startedAt: "2026-08-01T00:00:00Z",
    messageCount: 5,
    files: [{ path: "a.ts", ops: ["read"] }],
  });
  await seed({
    id: ids.b,
    userId: ownerId,
    keyId: ownerKey,
    repo: REPO,
    startedAt: "2026-08-03T00:00:00Z",
    messageCount: 9,
  });
  await seed({
    id: ids.c,
    userId: ownerId,
    keyId: ownerKey,
    repo: REPO,
    startedAt: "2026-08-02T00:00:00Z",
    messageCount: 3,
    endReason: "clear",
    // A mix so the preview ranks changed files ahead of read-only ones, then by path.
    files: [
      { path: "src/read-only.ts", ops: ["read"] },
      { path: "src/zeta.ts", ops: ["write"] },
      { path: "src/alpha.ts", ops: ["edit"] },
      { path: "src/mid.ts", ops: ["read"] },
    ],
  });
  await seed({
    id: ids.d,
    userId: mateId,
    keyId: mateKey,
    repo: REPO,
    startedAt: "2026-08-05T00:00:00Z",
    messageCount: 7,
    files: [{ path: "d.ts", ops: ["write"] }],
  });
  await seed({
    id: ids.other,
    userId: ownerId,
    keyId: ownerKey,
    repo: OTHER_REPO,
    startedAt: "2026-08-10T00:00:00Z",
    messageCount: 2,
  });
  const reader1 = randomUUID();
  const reader2 = randomUUID();
  const reader3 = randomUUID();
  for (const [index, reader] of [reader1, reader2, reader3].entries())
    await seed({
      id: reader,
      userId: ownerId,
      keyId: ownerKey,
      repo: READERS_REPO,
      startedAt: `2026-07-0${String(index + 1)}T00:00:00Z`,
      messageCount: 1,
    });
  // C is read by two distinct sessions (reuse_count 2); D by one (reuse_count 1).
  await db.traces.appendSessionReads([
    edge(reader1, ids.c),
    edge(reader2, ids.c),
    edge(reader3, ids.d),
  ]);
}, 300_000);
afterAll(release);

describe("recall ranking and distilled preview", () => {
  // @req R-GET-04 @req R-GET-08 @req R-GET-09
  it("orders a repo's roots by reuse_count then recency, with by_teammate, distilled counts and a files preview", async () => {
    const recalled = await sessions.list(owner(), {
      filters: { repo_name: REPO },
      roots_only: true,
      recall: true,
      limit: 10,
    });
    const items = recalled.result.items;
    // reuse_count desc, then started_at desc: C(2), D(1), then B(08-03) before A(08-01).
    expect(items.map((item) => item.session_id)).toEqual([
      ids.c,
      ids.d,
      ids.b,
      ids.a,
    ]);
    // The other repo's high-message root and the reader roots never join the page; the total
    // is the four target-repo roots computed on the same scan.
    expect(recalled.result.total.sessions).toBe(4);
    const byId = new Map(items.map((item) => [item.session_id, item]));
    // Distilled value fields the hook shows at a glance.
    expect(byId.get(ids.c)?.reuse_count).toBe(2);
    expect(byId.get(ids.d)?.reuse_count).toBe(1);
    expect(byId.get(ids.b)?.reuse_count).toBe(0);
    expect(byId.get(ids.d)?.by_teammate).toBe(true);
    expect(byId.get(ids.c)?.by_teammate).toBe(false);
    expect(byId.get(ids.c)?.message_count).toBe(3);
    expect(byId.get(ids.b)?.message_count).toBe(9);
    expect(byId.get(ids.c)?.end_reason).toBe("clear");
    expect(byId.get(ids.b)?.end_reason).toBeNull();
    // Up to 3 representative paths: changed files (edit/write/delete) first, then by path,
    // so the read-only src/read-only.ts is dropped past the limit; none is an empty list.
    expect(byId.get(ids.c)?.files).toEqual([
      "src/alpha.ts",
      "src/zeta.ts",
      "src/mid.ts",
    ]);
    expect(byId.get(ids.a)?.files).toEqual(["a.ts"]);
    expect(byId.get(ids.b)?.files).toEqual([]);
    expect(byId.get(ids.d)?.files).toEqual(["d.ts"]);
  });

  // @req R-GET-04
  it("leaves the ordinary list untouched: recency order and no files preview", async () => {
    const plain = await sessions.list(owner(), {
      filters: { repo_name: REPO },
      roots_only: true,
      limit: 10,
    });
    // Default sort is started_at desc, so the high-reuse C sits by its date, not first.
    expect(plain.result.items.map((item) => item.session_id)).toEqual([
      ids.d,
      ids.b,
      ids.c,
      ids.a,
    ]);
    // The files preview is recall-only, so the ordinary list runs its single scan unchanged.
    expect(plain.result.items.every((item) => item.files === undefined)).toBe(
      true,
    );
  });
});
