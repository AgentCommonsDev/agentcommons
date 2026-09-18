import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { CursorCodec } from "../src/services/cursor.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import {
  releaser,
  syntheticContext,
  syntheticOrganization,
} from "./support.js";

/**
 * Cross-user reuse (ADR 0090): `by_teammate` labels every search block and get header a
 * different member of the caller's organization authored, and the search ranking boosts
 * teammate-authored sessions before the page limit so one member's prior work surfaces to
 * another. The boost is caller-relative, so the same two sessions order one way for their
 * author and the other way for the teammate.
 */
const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let search: SearchService;
let sessions: SessionService;

const org = "reuse-org";
const ownerId = "reuse-owner";
const teammateId = "reuse-teammate";
const installationId = randomUUID();
const ids = {
  ownLabel: randomUUID(),
  mateLabel: randomUUID(),
  selfBoost: randomUUID(),
  mateBoost: randomUUID(),
};

/** A published, public session authored by `userId` (with their own ingest key) and one searchable message. */
async function seedSession(
  id: string,
  userId: string,
  keyId: string,
  content: string,
  title: string,
): Promise<void> {
  await fixtures.session({
    id,
    organizationId: org,
    userId,
    keyId,
    installationId,
    visibility: "PUBLIC",
    fields: {
      title,
      repo_name: "host/team/reuse",
      branch: "main",
      model: "test-model",
      models_used: ["test-model"],
      tools_used: [],
    },
  });
  const batch = randomUUID();
  const raw = randomUUID();
  await fixtures.insert("raw_records", id, {
    raw_record_id: raw,
    ingest_batch_id: batch,
    pos: "0",
    record_type: "message",
    payload: JSON.stringify({ content }),
    redaction_context: "null",
    received_at: new Date("2026-08-15T00:00:00Z"),
  });
  await fixtures.insert("messages", id, {
    message_id: randomUUID(),
    raw_record_id: raw,
    ingest_batch_id: batch,
    seq: 0,
    block_index: 0,
    role: "USER",
    kind: "TEXT",
    content,
    tool_name: null,
    tool_input: "null",
    searchable: true,
    search_text: content,
    timestamp: "2026-08-15T00:00:00Z",
    received_at: new Date("2026-08-15T00:00:00Z"),
    input_tokens: "10",
    output_tokens: "5",
  });
  await fixtures.update("sessions", id, { message_count: 1 });
}

const owner = () => syntheticContext(org, { userId: ownerId });
const teammate = () => syntheticContext(org, { userId: teammateId });

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  const dependencies = {
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("reuse-boost-cursor-secret-with-enough-entropy"),
  };
  search = new SearchService(dependencies);
  sessions = new SessionService(dependencies);
  await syntheticOrganization(db, {
    organizationId: org,
    keyId: "reuse-key",
    installationId,
    userId: ownerId,
  });
  // A second member authors the teammate sessions; their email resolves through
  // control_user_scope once they are a member with a published session.
  await db.prisma.user.upsert({
    where: { id: teammateId },
    create: {
      id: teammateId,
      name: "Teammate",
      email: `${teammateId}@example.test`,
    },
    update: {},
  });
  await db.prisma.member.create({
    data: {
      id: `member-${teammateId}`,
      organizationId: org,
      userId: teammateId,
      role: "member",
      createdAt: new Date(),
    },
  });
  // Each member ingests under their own key: the session→key-owner FK maps one key to one
  // user, so the teammate's sessions need a key the teammate owns.
  await db.prisma.apikey.create({
    data: {
      id: "reuse-key-mate",
      referenceId: org,
      key: "fixture-hash-reuse-key-mate",
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: JSON.stringify({ sessions: ["ingest", "read"] }),
    },
  });
  await db.prisma.apiKeyOwner.create({
    data: { keyId: "reuse-key-mate", organizationId: org, userId: teammateId },
  });
  await seedSession(
    ids.ownLabel,
    ownerId,
    "reuse-key",
    "reuselabel own authored body",
    "Own",
  );
  await seedSession(
    ids.mateLabel,
    teammateId,
    "reuse-key-mate",
    "reuselabel teammate authored body",
    "Teammate",
  );
  // Identical relevant content, so any ranking difference is the boost alone.
  await seedSession(
    ids.selfBoost,
    ownerId,
    "reuse-key",
    "boostmarker shared body",
    "Self",
  );
  await seedSession(
    ids.mateBoost,
    teammateId,
    "reuse-key-mate",
    "boostmarker shared body",
    "Mate",
  );
}, 300_000);
afterAll(release);

describe("cross-user reuse label and boost", () => {
  // @req R-SRCH-20 @req R-GET-08
  it("sets by_teammate true for another member's session and false for the caller's own, on search blocks and the get header", async () => {
    const result = await search.execute(owner(), { query: "reuselabel" });
    const blocks = new Map(
      result.result.blocks.map((block) => [block.session_id, block]),
    );
    expect(blocks.get(ids.mateLabel)?.by_teammate, "teammate block").toBe(true);
    expect(blocks.get(ids.ownLabel)?.by_teammate, "own block").toBe(false);
    // The teammate's email is a real address, so the strict block schema accepts it.
    expect(blocks.get(ids.mateLabel)?.user_email).toBe(
      `${teammateId}@example.test`,
    );

    const mate = await sessions.get(owner(), { session_id: ids.mateLabel });
    expect(mate.result.header?.by_teammate, "teammate header").toBe(true);
    const own = await sessions.get(owner(), { session_id: ids.ownLabel });
    expect(own.result.header?.by_teammate, "own header").toBe(false);
  });

  // @req R-SRCH-20 @req R-SRCH-06
  it("lifts an equally relevant teammate session into the page ahead of the caller's own, deterministically and caller-relative", async () => {
    // limit 1 keeps only the top block; the boost pulls the teammate session into it over
    // the caller's own, equally relevant session.
    const limited = await search.execute(owner(), {
      query: "boostmarker",
      limit: 1,
    });
    expect(limited.result.total.sessions).toBe(2);
    expect(limited.result.blocks).toHaveLength(1);
    expect(limited.result.blocks[0]?.session_id).toBe(ids.mateBoost);
    expect(limited.result.blocks[0]?.by_teammate).toBe(true);

    // On the full page both appear; the teammate session ranks first (rank desc, then
    // session_id, seq), a strict order the boosted rank keeps deterministic.
    const full = await search.execute(owner(), {
      query: "boostmarker",
      limit: 5,
    });
    const order = full.result.blocks.map((block) => block.session_id);
    expect(order).toContain(ids.selfBoost);
    expect(order.indexOf(ids.mateBoost)).toBeLessThan(
      order.indexOf(ids.selfBoost),
    );

    // The boost is relative to the caller: for the teammate, their own session is not
    // boosted and the owner's session is, so the identical two sessions order the other way.
    const flipped = await search.execute(teammate(), {
      query: "boostmarker",
      limit: 5,
    });
    const flippedOrder = flipped.result.blocks.map((block) => block.session_id);
    expect(flippedOrder.indexOf(ids.selfBoost)).toBeLessThan(
      flippedOrder.indexOf(ids.mateBoost),
    );
  });
});
