import { createTraceClient, queryTrace } from "@agentcommons/traces";
import { z } from "zod";
import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { requireCaller } from "../src/services/context.js";
import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, copyFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  jobOutputSchema,
  projectionIdentity,
  type IngestEnvelope,
} from "@agentcommons/core";
import { createRuntime } from "../src/main.js";
import { createApp } from "../src/app.js";
import { environment } from "../src/env.js";
import { configSchema } from "../../../packages/hook/src/config.js";
import { recordHook } from "../../../packages/hook/src/hook.js";
import { upload } from "../../../packages/hook/src/upload.js";
import { loadState } from "../../../packages/hook/src/state.js";
import { provisionOrganization, testAuthConfiguration } from "./support.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let baseUrl: string;
let native: ReturnType<typeof createTraceClient>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startTraceDatabase();
  release.unshift(() => database.close());
  native = createTraceClient(database.traceConfig);
  release.unshift(() => native.close());
  organization = await provisionOrganization(database, "identity-reset-review");
  const env = environment({
    ...traceEnvironment(database.traceConfig),
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    DATABASE_URL: database.urls.app,
    LOG_LEVEL: "silent",
  });
  runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  app = await createApp({ env, services: runtime.services, static: false });
  release.unshift(() => app.close());
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  await runtime.jobs.start();
});
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

async function waitPublished(id: string) {
  await expect
    .poll(
      async () => {
        const state =
          await database.prisma.traceSessionControl.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: requireCaller(organization.context)
                  .organizationId,
                id,
              },
            },
          });
        return (
          state.projectionState === "published" &&
          state.publishedRevision === state.acceptedRevision
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

// @req R-HRN-06 @req R-ING-08
it.each([false, true])(
  "a delayed older pi tree callback cannot replace the latest leaf (source grows: %s)",
  async (grows) => {
    const directory = await mkdtemp(join(tmpdir(), "agentcommons-stale-leaf-"));
    try {
      const transcript = join(directory, "session.jsonl");
      await copyFile(
        "fixtures/transcripts/pi/tree-and-resume.jsonl",
        transcript,
      );
      const config = configSchema.parse({
        server: baseUrl,
        key: organization.key,
        installationId: randomUUID(),
        node: process.execPath,
      });
      const nativeId = randomUUID();
      const event = {
        session_id: nativeId,
        transcript_path: transcript,
        cwd: directory,
        hook_event_name: "session_tree",
        event_id: randomUUID(),
        timestamp: "2026-09-08T02:00:02.000Z",
        activeLeafId: "30b52614",
      };
      const state = recordHook(
        directory,
        "/nonexistent-review-hook.js",
        config,
        "pi",
        event,
        "review-launch",
      );
      if (!state) throw new Error("Expected a durable hook intent.");
      await upload(directory, "/nonexistent-review-hook.js", state, config);
      const session =
        await database.prisma.traceSessionControl.findFirstOrThrow({
          where: { harnessSessionId: nativeId },
        });
      const messages = async () => {
        await waitPublished(session.id);
        return database.traceReaders.read(
          requireCaller(organization.context),
          async (client) =>
            (
              await client.query(
                "SELECT content FROM api_ro.messages WHERE session_id={id:UUID} ORDER BY seq",
                { id: session.id },
              )
            ).rows,
        );
      };
      expect(await messages()).toContainEqual({ content: "resume confirmed." });
      const initialState = loadState(state);
      if (grows)
        await appendFile(
          transcript,
          JSON.stringify({
            type: "message",
            id: "abcdef99",
            parentId: "30b52614",
            timestamp: "2026-09-08T02:00:03.000Z",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Later source material waiting for its native callback",
                },
              ],
            },
          }) + "\n",
        );
      recordHook(
        directory,
        "/nonexistent-review-hook.js",
        config,
        "pi",
        {
          ...event,
          event_id: randomUUID(),
          timestamp: "2026-09-08T02:00:01.000Z",
          activeLeafId: "a2bc6577",
        },
        "review-launch",
      );
      await upload(directory, "/nonexistent-review-hook.js", state, config);
      const finalState = loadState(state);
      expect(finalState.context.activeLeafId).toBe("30b52614");
      expect(finalState.contextSentAt).toBe(event.timestamp);
      expect(finalState.source.watermark).toBeGreaterThanOrEqual(
        initialState.source.watermark,
      );
      if (grows)
        expect(finalState.source.watermark).toBeGreaterThan(
          initialState.source.watermark,
        );
      await waitPublished(session.id);
      const receipts = (
        await queryTrace(
          native,
          "SELECT sent_at FROM ingest_receipts WHERE session_id={id:UUID}",
          { id: session.id },
        )
      ).rows;
      expect(
        receipts.every(
          (receipt) =>
            z.coerce.date().parse(receipt.sent_at).toISOString() ===
            event.timestamp,
        ),
      ).toBe(true);
      expect(await messages()).toContainEqual({ content: "resume confirmed." });
      expect(await messages()).not.toContainEqual({
        content: "second branch point.",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// @req R-ING-04 @req R-ING-07 @req R-ING-09 @req R-RED-06 @req R-DASH-12
it("a rescan invalidates an in-flight raw fragment without changing reset-record or lifecycle identities", async () => {
  const services = runtime.services;
  const input: IngestEnvelope = {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: `identity-review-${randomUUID()}`,
    batchId: randomUUID(),
    installationId: randomUUID(),
    behavior: "start",
    nativeEvent: "SessionStart",
    start: { resume: true },
    end: null,
    sourcePos: 1,
    sentAt: "2026-09-08T02:00:00.000Z",
    cursor: "initial",
    context: {
      cwd: "/repo",
      installation: {
        hostname: "review",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: ["a", "b"].map((id) => ({
      pos: 0,
      sourceVersion: 0,
      key: `identity-review-${id}`,
      line: JSON.stringify({
        type: "user",
        uuid: id,
        message: { content: `classified-fragment ${id} ${"x".repeat(80_000)}` },
      }),
    })),
  };
  const initial = await services.ingest.execute(organization.context, input);
  const id = initial.result.sessionId;
  await services.ingest.execute(organization.context, {
    ...input,
    records: [],
    batchId: randomUUID(),
    behavior: "end",
    start: null,
    sentAt: "2026-09-08T02:00:01.000Z",
  });
  await waitPublished(id);
  const identities = () =>
    database.traceReaders.read(
      requireCaller(organization.context),
      async (client) =>
        (
          await client.query(
            "SELECT message_id,seq,raw_record_id,ingest_batch_id FROM api_ro.messages WHERE session_id={id:UUID} ORDER BY seq",
            { id },
          )
        ).rows,
    );
  const messagesBefore = await identities();
  const rawBefore = await services.sessions.raw(organization.owner, id, {
    limit: 1,
  });
  expect(
    rawBefore.result.items[0]?.payload_fragment?.next_offset,
  ).toBeGreaterThan(0);
  const cursor = rawBefore.result.cursor;
  if (!cursor) throw new Error("Expected a fragment continuation.");
  await services.policies.save(organization.owner, null, {
    name: "review-identities",
    kind: "REGEX",
    pattern: "identity-review-|classified-fragment",
    flags: "g",
    enabled: true,
  });
  const scan = await services.admin.rescan(organization.owner, {
    reason: "Identity and raw continuation review",
  });
  await expect
    .poll(
      async () =>
        (
          await runtime.jobs.progress(
            organization.owner,
            jobOutputSchema.parse(scan.result).job_id,
          )
        ).result.state,
      { timeout: 30_000 },
    )
    .toBe("completed");
  await expect(
    services.sessions.raw(organization.owner, id, { limit: 1, cursor }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  expect(await identities()).toEqual(messagesBefore);
  const rawIds = new Set<string>();
  let nextCursor: string | null = null;
  do {
    const page = await services.sessions.raw(organization.owner, id, {
      limit: 1,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    });
    for (const row of page.result.items) {
      rawIds.add(row.id);
      expect(row.key).toMatch(/^redacted-[a-f0-9]{64}$/);
      expect(JSON.stringify(row.payload)).not.toContain("classified-fragment");
    }
    nextCursor = page.result.cursor;
  } while (nextCursor);
  expect(rawIds.size).toBe(2);
  expect(
    (
      await services.ingest.execute(organization.context, {
        ...input,
        batchId: randomUUID(),
        behavior: "sync",
        start: null,
        sourcePos: 500,
        records: input.records.map((record) => ({
          ...record,
          pos: 500,
          sourceVersion: 9,
        })),
      })
    ).result,
  ).toMatchObject({ sessionId: id, accepted: 0, duplicates: 2 });
  expect(
    await database.prisma.traceSessionControl.findUniqueOrThrow({
      where: {
        organizationId_id: {
          organizationId: requireCaller(organization.context).organizationId,
          id,
        },
      },
    }),
  ).toMatchObject({ status: "ENDED", lifecyclePos: 1n });
  await services.admin.purge(organization.owner, {
    session_id: id,
    reason: "Identity tombstone review",
  });
  await expect(
    services.ingest.execute(organization.context, {
      ...input,
      harnessSessionId: projectionIdentity(input.harnessSessionId),
      batchId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "SESSION_PURGED" });
});
