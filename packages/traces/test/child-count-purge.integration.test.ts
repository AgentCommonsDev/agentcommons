import { afterAll, beforeAll, expect, it } from "vitest";
import type { ReadAuthority } from "@agentcommons/db";
import { callerContextSchema } from "@agentcommons/core/schemas/common";
import { startTraceDatabase } from "./support.js";
import { TraceFixtures } from "./fixtures.js";
import { provisionOrganization } from "../../../apps/api/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import type { TraceParameters } from "../src/index.js";

// A directly-purged subagent must not inflate its live parent's `child_count`. The count is a
// shared control aggregate over `control_session_scope`, whose row policy admits a published,
// visible session even after it is purged (the admin skeleton and the Moderation route read it
// there), so before the fix the purged child was still credited to its parent while the browse
// surfaces (the `session_details` children a member reads, and the read-model children list)
// excluded it. ADR 0088 removes a purged session from the browse surfaces for every caller,
// admins included, so the count must exclude it for everyone and match the browsable children.
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let owner: ReadAuthority;
let member: ReadAuthority;
const release: Array<() => Promise<unknown>> = [];
const tree = { parent: "", liveChild: "", purgedChild: "" };

beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  fixtures = new TraceFixtures(db);
  release.unshift(() => fixtures.close());
  const organization = await provisionOrganization(db, "child-count-purge");
  owner = callerContextSchema.parse(organization.context.caller);
  member = { ...owner, permissions: { sessions: ["read"] } };
  const child = async (parent: string, title: string) =>
    (
      await fixtures.sessionFor(organization.context, {
        parent,
        parentToolUseId: `toolu_${title}`,
        fields: { title },
      })
    ).id;
  tree.parent = (
    await fixtures.sessionFor(organization.context, {
      fields: { title: "Live parent" },
    })
  ).id;
  tree.liveChild = await child(tree.parent, "Live child");
  tree.purgedChild = await child(tree.parent, "Purged child");
  // Directly purge one subagent, leaving its published, public control row (and its identity)
  // in place: exactly the state that fed the parent an inflated count.
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: {
        organizationId: owner.organizationId,
        id: tree.purgedChild,
      },
    },
    data: { purgedAt: new Date() },
  });
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
const childCount = async (authority: ReadAuthority, id: string) =>
  Number(
    (
      await select(
        authority,
        "SELECT child_count FROM sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows[0]?.child_count,
  );
/** The children the read-model header lists: `session_details` filtered by the parent link. */
const browsableChildren = async (authority: ReadAuthority, id: string) =>
  (
    await select(
      authority,
      "SELECT session_id FROM session_details WHERE parent_session_id={id:UUID} ORDER BY session_id",
      { id },
    )
  ).rows.map((row) => row.session_id);

// @req R-SEC-03 @req R-MOD-02
it("excludes a directly-purged subagent from its live parent's child_count for every caller", async () => {
  // The parent has two subagents, one live and one directly purged: the count is 1, not 2.
  expect(await childCount(owner, tree.parent)).toBe(1);
  expect(await childCount(member, tree.parent)).toBe(1);
});

// @req R-SEC-03 @req R-MOD-02
it("matches the member's count to the children the member can browse", async () => {
  // A member never sees the purged subagent (its projection fails the sessions row policy and
  // it has no admin skeleton), so the member's browsable child list is the one live child and
  // the fixed count equals it: the header's `children_truncated` no longer reads true wrongly.
  const children = await browsableChildren(member, tree.parent);
  expect(children).toEqual([tree.liveChild]);
  expect(await childCount(member, tree.parent)).toBe(children.length);
});

// @req R-MOD-02
it("keeps the purged subagent reachable only as the admin skeleton, not the member", async () => {
  // ADR 0088: a direct id read still returns the admin skeleton of a purged session, while the
  // member sees nothing. The count excludes it for both; this pins that the row itself did not
  // vanish (so the count change is about crediting, not about the row disappearing).
  expect(
    (
      await select(
        owner,
        "SELECT purged_at IS NOT NULL AS purged FROM sessions WHERE session_id={id:UUID}",
        { id: tree.purgedChild },
      )
    ).rows,
  ).toEqual([{ purged: 1 }]);
  expect(
    (
      await select(
        member,
        "SELECT session_id FROM sessions WHERE session_id={id:UUID}",
        { id: tree.purgedChild },
      )
    ).rows,
  ).toEqual([]);
});
