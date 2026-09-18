import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import type { ReadAuthority } from "@agentcommons/db";
import { startTraceDatabase } from "./support.js";
import { TraceFixtures } from "./fixtures.js";
import { provisionOrganization } from "../../../apps/api/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { createTraceClient, type TraceParameters } from "../src/index.js";
import { tracePrincipal } from "../src/client.js";
import { NO_TARGET_SESSION_ID } from "../src/reads.js";
import { callerContextSchema } from "@agentcommons/core/schemas/common";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let organizationContext: Awaited<
  ReturnType<typeof provisionOrganization>
>["context"];
let owner: ReadAuthority;
let member: ReadAuthority;
const release: Array<() => Promise<unknown>> = [];
/** The fixture: every session of one organization, by role in the tests below. */
const fixture = {
  ids: [] as string[],
  publicParent: "",
  privateParent: "",
  purgedParent: "",
  childOfPrivate: "",
  childOfPurged: "",
  files: 0,
  reads: 0,
};
const HOST = "views-host";
const PRIVATE_ENDED_AT = "2031-01-01T00:00:00.000Z";
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  fixtures = new TraceFixtures(db);
  release.unshift(() => fixtures.close());
  const organization = await provisionOrganization(db, "native-views");
  organizationContext = organization.context;
  owner = callerContextSchema.parse(organization.context.caller);
  member = { ...owner, permissions: { sessions: ["read"] } };
  await db.prisma.user.update({
    where: { id: z.string().parse(owner.userId) },
    data: { name: "Views Owner" },
  });
  const installationId = randomUUID();
  const session = async (
    options: Parameters<TraceFixtures["sessionFor"]>[1] = {},
  ) => {
    const { id } = await fixtures.sessionFor(organization.context, {
      installationId,
      hostname: HOST,
      ...options,
    });
    fixture.ids.push(id);
    for (let index = 0; index < 2; index += 1) {
      await fixtures.insertRaw(
        "session_files",
        {
          organizationId: owner.organizationId,
          sessionId: id,
          revision: 1n,
          generation: 0n,
        },
        {
          file_id: `f${String(index)}`,
          path: `/p/${String(index)}`,
          ops: ["read"],
        },
      );
      fixture.files += 1;
    }
    return id;
  };
  fixture.publicParent = await session({ fields: { title: "Public parent" } });
  fixture.privateParent = await session({
    visibility: "PRIVATE",
    fields: { title: "Private parent" },
  });
  fixture.purgedParent = await session({ fields: { title: "Purged parent" } });
  for (let index = 0; index < 5; index += 1)
    await session({
      parent: fixture.publicParent,
      parentToolUseId: `toolu_${String(index)}`,
    });
  fixture.childOfPrivate = await session({ parent: fixture.privateParent });
  fixture.childOfPurged = await session({ parent: fixture.purgedParent });
  for (let index = 0; index < 12; index += 1)
    await session({ visibility: index < 2 ? "PRIVATE" : "PUBLIC" });
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: {
        organizationId: owner.organizationId,
        id: fixture.privateParent,
      },
    },
    data: { endedAt: new Date(PRIVATE_ENDED_AT), status: "ENDED" },
  });
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: {
        organizationId: owner.organizationId,
        id: fixture.purgedParent,
      },
    },
    data: { purgedAt: new Date() },
  });
  await fixtures.insertRaw(
    "messages",
    {
      organizationId: owner.organizationId,
      sessionId: fixture.publicParent,
      revision: 1n,
      generation: 0n,
    },
    {
      message_id: randomUUID(),
      role: "USER",
      kind: "TEXT",
      content: "hello",
      tool_input: "null",
      received_at: new Date("2026-08-01T00:00:00Z"),
    },
  );
  const reads = Array.from({ length: 10 }, (_, index) => ({
    organization_id: owner.organizationId,
    session_id: fixture.ids[3 + (index % 5)] ?? "",
    audit_id: randomUUID(),
    read_at: new Date("2026-08-02T00:00:00Z"),
    action: "get",
    target_session_id: fixture.publicParent,
    reader_user_id: z.string().parse(owner.userId),
    reader_email: null,
    reader_harness: "CODEX",
  }));
  await db.traces.appendSessionReads(reads);
  fixture.reads = reads.length;
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});
async function select(
  authority: ReadAuthority,
  sql: string,
  parameters: TraceParameters = {},
) {
  return db.traceReaders.read(authority, (client) =>
    client.query(sql, parameters),
  );
}
/** `read_rows` ClickHouse reports for one reader query, from the response summary header. */
async function readRows(authority: ReadAuthority, sql: string) {
  await select(authority, "SELECT 1");
  const identity = tracePrincipal(
    authority,
    true,
    db.traceConfig.readerSecret,
    false,
  );
  const reader = createTraceClient({
    url: db.traceConfig.url,
    database: "api_ro",
    username: identity.username,
    password: identity.password,
  });
  try {
    const result = await reader.query({ query: sql, format: "JSONCompact" });
    await result.json();
    const header = result.response_headers["x-clickhouse-summary"];
    return Number(
      z
        .object({ read_rows: z.string() })
        .parse(JSON.parse(z.string().parse(header))).read_rows,
    );
  } finally {
    await reader.close();
  }
}

// @req R-SEC-02
it("reads the sessions relation with one pass per base table and a bounded number of control reads", async () => {
  const migration = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  try {
    // One part per table makes `read_rows` count each stored row exactly once per scan.
    for (const table of [
      "sessions",
      "session_files",
      "session_reads",
      "session_identities",
    ])
      await migration.command({
        query: `OPTIMIZE TABLE ${db.traceConfig.database}.${table} FINAL`,
      });
  } finally {
    await migration.close();
  }
  const sessions = fixture.ids.length;
  // Rows one `sessions` query reads as an admin: the session rows once for the rows and
  // once, two columns wide, for parent titles (2N); the caller's control rows three times
  // (the policy scalar every guarded table shares, the live join, the admin skeleton; 3N);
  // the identity rows for the skeleton gate and the purged parents (2N); one member row and
  // one machine row; the file rows and the stored reads once each. A member reads less: no
  // skeleton, no identities. The old view stack read the session rows eight times and the
  // control rows eleven times for the same count.
  const budget = 7 * sessions + fixture.files + fixture.reads + 16;
  for (const sql of [
    "SELECT count() AS c FROM sessions",
    "SELECT * FROM sessions ORDER BY started_at DESC, session_id LIMIT 51",
    "SELECT * FROM session_details ORDER BY session_id LIMIT 51",
  ])
    for (const authority of [owner, member]) {
      const rows = await readRows(authority, sql);
      expect(rows, `${sql} read ${String(rows)} rows`).toBeLessThanOrEqual(
        budget,
      );
    }
  // `session_state` needs neither titles, member metadata, files nor reads.
  expect(
    await readRows(owner, "SELECT count() AS c FROM session_state"),
  ).toBeLessThanOrEqual(5 * sessions + 8);
  expect(
    await readRows(member, "SELECT count() AS c FROM session_state"),
  ).toBeLessThanOrEqual(3 * sessions + 8);
  expect(
    (await select(owner, "SELECT count() AS c FROM sessions")).rows,
  ).toEqual([{ c: String(sessions) }]);
  expect(
    (await select(member, "SELECT count() AS c FROM sessions")).rows,
  ).toEqual([{ c: String(sessions - 4) }]);
});

// @req R-SEC-02 @req R-GET-03
it("joins member and machine metadata once per query for live rows and the purge skeleton alike", async () => {
  const user = await db.prisma.user.findUniqueOrThrow({
    where: { id: z.string().parse(owner.userId) },
  });
  const live = await select(
    member,
    "SELECT user_email,user_name,installation_hostname,visibility,status FROM sessions WHERE session_id={id:UUID}",
    { id: fixture.publicParent },
  );
  expect(live.rows).toEqual([
    {
      user_email: user.email,
      user_name: "Views Owner",
      installation_hostname: HOST,
      visibility: "PUBLIC",
      status: "ACTIVE",
    },
  ]);
  const skeleton = await select(
    owner,
    "SELECT title,message_count,user_email,user_name,installation_hostname,purged_at IS NOT NULL AS purged FROM sessions WHERE session_id={id:UUID}",
    { id: fixture.purgedParent },
  );
  expect(skeleton.rows).toEqual([
    {
      title: null,
      message_count: 0,
      user_email: user.email,
      user_name: "Views Owner",
      installation_hostname: HOST,
      purged: 1,
    },
  ]);
  expect(
    (
      await select(
        member,
        "SELECT session_id FROM sessions WHERE session_id={id:UUID}",
        { id: fixture.purgedParent },
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await select(
        member,
        "SELECT user_email,session_title FROM messages WHERE session_id={id:UUID} LIMIT 1",
        { id: fixture.publicParent },
      )
    ).rows,
  ).toEqual([{ user_email: user.email, session_title: "Public parent" }]);
});

// @req R-SEC-03
it("derives parent links and child counts from the caller-visible control set, including the admin skeleton", async () => {
  const detail = (authority: ReadAuthority, id: string) =>
    select(
      authority,
      "SELECT parent_session_id,parent_relation,parent_tool_use_id,parent_title,child_count,file_count FROM sessions WHERE session_id={id:UUID}",
      { id },
    ).then((result) => result.rows[0]);
  expect(await detail(member, fixture.childOfPrivate)).toMatchObject({
    parent_session_id: null,
    parent_relation: null,
    parent_tool_use_id: null,
    parent_title: null,
  });
  expect(await detail(owner, fixture.childOfPrivate)).toMatchObject({
    parent_session_id: fixture.privateParent,
    parent_relation: "SUBAGENT",
    parent_title: "Private parent",
  });
  // A purged parent keeps its link for admins (its skeleton is visible) with no title.
  expect(await detail(owner, fixture.childOfPurged)).toMatchObject({
    parent_session_id: fixture.purgedParent,
    parent_relation: "SUBAGENT",
    parent_title: null,
  });
  expect(await detail(member, fixture.childOfPurged)).toMatchObject({
    parent_session_id: null,
    parent_relation: null,
  });
  expect(await detail(member, fixture.ids[3] ?? "")).toMatchObject({
    parent_session_id: fixture.publicParent,
    parent_tool_use_id: "toolu_0",
    parent_title: "Public parent",
    file_count: "2",
  });
  for (const authority of [owner, member])
    expect(
      Number((await detail(authority, fixture.publicParent))?.child_count),
    ).toBe(5);
  expect(Number((await detail(owner, fixture.purgedParent))?.child_count)).toBe(
    1,
  );
  expect(
    Number((await detail(owner, fixture.privateParent))?.child_count),
  ).toBe(1);
  expect(
    (
      await select(
        owner,
        "SELECT reuse_count FROM sessions WHERE session_id={id:UUID}",
        { id: fixture.publicParent },
      )
    ).rows,
  ).toEqual([{ reuse_count: "5" }]);
});

// @req R-SEC-01 @req R-SEC-03
it("never evaluates a member's predicate over a hidden session's control metadata", async () => {
  // Each predicate throws if it ever sees the private session's ENDED state; a member's
  // query must instead keep every visible row and never fail.
  const visible = String(fixture.ids.length - 4);
  for (const [sql, parameters, expected] of [
    [
      "SELECT count() AS c FROM sessions WHERE throwIf(coalesce(ended_at=toDateTime64({at:String},6,'UTC'),0))=0",
      { at: PRIVATE_ENDED_AT.replace("T", " ").replace("Z", "") },
      visible,
    ],
    [
      "SELECT count() AS c FROM session_state WHERE throwIf(status='ENDED')=0",
      {},
      visible,
    ],
    [
      "SELECT count() AS c FROM session_details WHERE throwIf(status='ENDED')=0",
      {},
      visible,
    ],
    [
      "SELECT count() AS c FROM sessions s JOIN (SELECT 0 AS n) x ON toUInt64(if(s.status='ENDED',s.status,'0'))=x.n",
      {},
      visible,
    ],
  ] as const) {
    const result = await select(member, sql, parameters);
    expect(result.rows, sql).toEqual([{ c: expected }]);
  }
  expect(
    (
      await select(
        owner,
        "SELECT count() AS c FROM sessions WHERE status='ENDED'",
      )
    ).rows,
  ).toEqual([{ c: "1" }]);
});

// @req R-DASH-47 @req R-DASH-15 @req R-DASH-18
it("rolls a subagent's search and reuse reads up to its root, so roots-only metrics count them", async () => {
  // A fresh tree owned by the same member: root -> subagent -> nested subagent (depth two),
  // sharing one installation. The deepest child does all the querying and reuse.
  const installationId = randomUUID();
  // Set the parent link on both the control row (`parent`, the caller-visible parent the
  // sessions view reads) and the projection row (`fields`, what production's projection
  // worker copies from control and what liveProjectionSql — and so the rollup — reads).
  const make = async (parent?: string) =>
    (
      await fixtures.sessionFor(organizationContext, {
        installationId,
        hostname: HOST,
        ...(parent
          ? {
              parent,
              fields: {
                title: "Rollup",
                parent_session_id: parent,
                parent_relation: "SUBAGENT",
              },
            }
          : { fields: { title: "Rollup" } }),
      })
    ).id;
  const root = await make();
  const sub = await make(root);
  const subsub = await make(sub);
  // The nested subagent runs two searches, one sql query, and reads a prior session.
  await db.traces.appendSessionReads(
    (
      [
        ["search", NO_TARGET_SESSION_ID],
        ["search", NO_TARGET_SESSION_ID],
        ["sql", NO_TARGET_SESSION_ID],
        ["get", fixture.publicParent],
      ] as const
    ).map(([action, target], index) => ({
      organization_id: owner.organizationId,
      session_id: subsub,
      audit_id: randomUUID(),
      read_at: new Date(`2026-08-03T00:0${String(index)}:00Z`),
      action,
      target_session_id: target,
      reader_user_id: z.string().parse(owner.userId),
      reader_email: null,
      reader_harness: "CLAUDE_CODE",
    })),
  );
  const byId = <T extends { session_id: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.session_id, row]));
  const search = z.array(
    z.strictObject({
      session_id: z.string(),
      parent_session_id: z.string().nullable(),
      agentcommons_search_calls: z.coerce.number(),
      repeat_agentcommons_search_calls: z.coerce.number(),
    }),
  );
  // Search adoption: the root carries the whole subtree's three search/sql calls; every
  // child row is zero, and the root's raw parent stays null while the children keep theirs.
  const searchRows = byId(
    search.parse(
      (
        await select(
          owner,
          "SELECT session_id,parent_session_id,agentcommons_search_calls,repeat_agentcommons_search_calls FROM metrics_search_sessions WHERE session_id IN {ids:Array(UUID)}",
          { ids: [root, sub, subsub] },
        )
      ).rows,
    ),
  );
  expect(searchRows.get(root)).toEqual({
    session_id: root,
    parent_session_id: null,
    agentcommons_search_calls: 3,
    repeat_agentcommons_search_calls: 2,
  });
  expect(searchRows.get(sub)).toEqual({
    session_id: sub,
    parent_session_id: root,
    agentcommons_search_calls: 0,
    repeat_agentcommons_search_calls: 0,
  });
  expect(searchRows.get(subsub)).toEqual({
    session_id: subsub,
    parent_session_id: sub,
    agentcommons_search_calls: 0,
    repeat_agentcommons_search_calls: 0,
  });
  const reuse = z.array(
    z.strictObject({
      session_id: z.string(),
      parent_session_id: z.string().nullable(),
      reused: z.coerce.number(),
    }),
  );
  // Reuse: the deepest child read a prior session, so its root reused prior work while the
  // child rows are zero.
  const reuseRows = byId(
    reuse.parse(
      (
        await select(
          owner,
          "SELECT session_id,parent_session_id,reused FROM metrics_reuse_sessions WHERE session_id IN {ids:Array(UUID)}",
          { ids: [root, sub, subsub] },
        )
      ).rows,
    ),
  );
  expect(reuseRows.get(root)).toEqual({
    session_id: root,
    parent_session_id: null,
    reused: 1,
  });
  expect(reuseRows.get(sub)).toEqual({
    session_id: sub,
    parent_session_id: root,
    reused: 0,
  });
  expect(reuseRows.get(subsub)).toEqual({
    session_id: subsub,
    parent_session_id: sub,
    reused: 0,
  });
  // The roots-only tile predicate (templates.ts rootScope) now counts the root once for the
  // subagent's search; before the rollup the read landed on a non-root child and was dropped.
  expect(
    (
      await select(
        owner,
        "SELECT countIf(agentcommons_search_calls > 0) AS c FROM metrics_search_sessions WHERE parent_session_id IS NULL AND session_id IN {ids:Array(UUID)}",
        { ids: [root, sub, subsub] },
      )
    ).rows,
  ).toEqual([{ c: "1" }]);
});
