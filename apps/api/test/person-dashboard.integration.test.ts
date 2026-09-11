import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import {
  emptyTraceRow,
  validateTraceRow,
} from "../../../packages/traces/src/rows.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dashboardRenderOutputSchema } from "@agentcommons/core";
import { personDashboard } from "@agentcommons/core/dashboards";
import { provisionMember, provisionOrganization, releaser } from "./support.js";
import { startApp } from "./app.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let bystander: Awaited<ReturnType<typeof provisionMember>>;
let runtime: Awaited<ReturnType<typeof startApp>>["runtime"];
let fixtures: TraceFixtures;
const { defer, release } = releaser();
/** 400 sessions of 100 messages: 40,000 messages, the read-path measurement floor. */
const SESSIONS = 400;
const MESSAGES = 100;
const numeric = (value: unknown) =>
  Number(z.union([z.number(), z.string()]).parse(value));

/** Publish `count` sessions for `owner`, each with `MESSAGES` messages, in bulk. */
async function seed(owner: ServiceContext, count: number, repo: string) {
  const caller = requireCaller(owner);
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const startedAt = new Date(Date.UTC(2026, 7, 1 + (index % 28), index % 24));
    const session = await fixtures.sessionFor(owner, {
      fields: {
        repo_name: `${repo}${String(index % 5)}`,
        started_at: startedAt,
        last_activity_at: new Date(startedAt.getTime() + 3_600_000),
        message_count: MESSAGES,
        tool_call_count: 7,
        harness: index % 3 === 0 ? "CLAUDE_CODE" : "CODEX",
      },
    });
    ids.push(session.id);
  }
  const controls = await db.prisma.traceSessionControl.findMany({
    where: { id: { in: ids } },
    select: { id: true, publishedRevision: true, redactionGeneration: true },
  });
  const rows = controls.flatMap((control) =>
    Array.from({ length: MESSAGES }, (_, seq) =>
      validateTraceRow("messages", {
        ...emptyTraceRow("messages"),
        deleted: 0,
        fingerprint: "a".repeat(64),
        organization_id: caller.organizationId,
        session_id: control.id,
        generation: control.redactionGeneration,
        revision: control.publishedRevision,
        message_id: randomUUID(),
        seq,
        role: seq % 2 ? "ASSISTANT" : "USER",
        kind: "TEXT",
        content: `Person fixture message ${String(seq)} of ${control.id}`,
        search_text: `Person fixture message ${String(seq)}`,
        searchable: true,
        tool_input: "null",
        received_at: new Date(Date.UTC(2026, 7, 1, 0, seq)),
      }),
    ),
  );
  for (let offset = 0; offset < rows.length; offset += 10_000)
    await fixtures.client.insert({
      table: "messages",
      values: rows.slice(offset, offset + 10_000),
      format: "JSONEachRow",
    });
  return ids;
}
async function renderFor(context: ServiceContext, email: string) {
  const began = performance.now();
  const { result } = await runtime.services.dashboards.render(context, {
    definition: personDashboard,
    variables: { person: email, time_range: "all" },
  });
  return {
    output: dashboardRenderOutputSchema.parse(result),
    ms: performance.now() - began,
  };
}
function stat(
  output: z.infer<typeof dashboardRenderOutputSchema>,
  id: string,
  column: string,
) {
  const tile = output.tiles.find((item) => item.id === id);
  expect(tile?.error, id).toBeNull();
  const index = tile?.result?.columns.findIndex((item) => item.name === column);
  if (index === undefined || index < 0)
    throw new Error(`No ${column} in ${id}`);
  return tile?.result?.rows[0]?.[index];
}

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  organization = await provisionOrganization(db, "person-primary");
  member = await provisionMember(db, organization.owner, "person@example.com");
  bystander = await provisionMember(
    db,
    organization.owner,
    "bystander@example.com",
  );
  const started = await startApp(db);
  defer(() => started.close());
  ({ runtime } = started);
  fixtures = new TraceFixtures(db);
  await seed(member.context, SESSIONS / 2, "github.com/person/repo-");
  await seed(organization.context, SESSIONS / 2, "github.com/owner/repo-");
}, 300_000);
afterAll(release);

// @req R-DASH-44 @req R-DASH-25
it("renders one member's activity from a 40k-message fixture as admin and as a member, one scan for the six stats", async () => {
  const memberEmail = member.email;
  for (const [label, context] of [
    ["admin", organization.owner],
    ["member", bystander.owner],
  ] as const) {
    // Four renders in flight: the documented tile concurrency, as the page issues them.
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => renderFor(context, memberEmail)),
    );
    const output = runs[0]?.output;
    if (!output) throw new Error("Expected a render.");
    expect(output.tiles.map((tile) => tile.error)).toEqual(
      output.tiles.map(() => null),
    );
    expect(numeric(stat(output, "sessions", "sessions"))).toBe(SESSIONS / 2);
    expect(numeric(stat(output, "messages", "messages"))).toBe(
      (SESSIONS / 2) * MESSAGES,
    );
    expect(numeric(stat(output, "tool_calls", "tool_calls"))).toBe(
      (SESSIONS / 2) * 7,
    );
    expect(numeric(stat(output, "searched", "searched"))).toBe(0);
    expect(numeric(stat(output, "reused", "reused"))).toBe(0);
    expect(
      z.string().parse(stat(output, "last_active", "last_active")),
    ).toMatch(/^2026-08-/);
    // The six stats share one statement and so one result; the two tiles below run their own.
    const activity = output.tiles.find(
      (tile) => tile.id === "sessions",
    )?.result;
    expect(
      output.tiles
        .filter((tile) =>
          [
            "messages",
            "tool_calls",
            "searched",
            "reused",
            "last_active",
          ].includes(tile.id),
        )
        .map((tile) => tile.result),
    ).toEqual(Array.from({ length: 5 }, () => activity));
    const repositories = output.tiles.find(
      (tile) => tile.id === "repositories",
    );
    expect(repositories?.result?.rows).toHaveLength(5);
    const harnesses = output.tiles.find((tile) => tile.id === "harnesses");
    expect(harnesses?.result?.rows).toHaveLength(2);
    const slowest = Math.max(...runs.map((run) => run.ms));
    console.info(
      `person dashboard as ${label}: ${runs.map((run) => run.ms.toFixed(0)).join(" / ")} ms for four concurrent renders (8 tiles, 3 statements each)`,
    );
    // Well under the 5 s reader limit with four renders in flight.
    expect(slowest).toBeLessThan(4000);
  }
  // Another member's email counts nothing of this member's.
  const { output } = await renderFor(organization.owner, bystander.email);
  expect(numeric(stat(output, "sessions", "sessions"))).toBe(0);
}, 120_000);
