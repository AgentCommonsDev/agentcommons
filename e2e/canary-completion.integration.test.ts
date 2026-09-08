import { cleanup as cleanupAll } from "../scripts/cleanup.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import type { IngestEnvelope } from "../packages/core/schemas/ingest.js";
import { completedNativeSessions } from "../scripts/canary-completion.js";
import { traceServices } from "../apps/api/test/trace-services.js";
import { startTraceDatabase } from "../packages/traces/test/support.js";
import { provisionOrganization } from "../apps/api/test/support.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startTraceDatabase();
  release.unshift(() => database.close());
});
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

// @req R-HRN-08
it("waits past a valid earlier end and the final source sync until both native shutdowns and their projections commit", async () => {
  const organization = await provisionOrganization(
    database,
    "canary-completion",
  );
  const organizationId = z
    .string()
    .parse(organization.context.caller?.organizationId);
  const native = traceServices(database);
  release.unshift(() => native.close());
  const ingest = { execute: native.publish };
  const source = await readFile(
    "fixtures/transcripts/pi/tree-and-resume.jsonl",
    "utf8",
  );
  let offset = 0;
  const records = source
    .trimEnd()
    .split("\n")
    .map((line) => {
      const record = { pos: offset, sourceVersion: 0, line };
      offset += Buffer.byteLength(`${line}\n`);
      return record;
    });
  const parent = randomUUID();
  const fork = randomUUID();
  const checkpoints = [parent, fork].map((sessionId) => ({
    sessionId,
    sourcePos: Buffer.byteLength(source),
    nativeEvent: "session_shutdown",
    activeLeafId: "30b52614",
  }));
  let clock = Date.parse("2026-09-08T00:00:00.000Z");
  const envelope = (sessionId: string): IngestEnvelope => ({
    envelopeVersion: 2,
    harness: "PI",
    harnessSessionId: sessionId,
    installationId: randomUUID(),
    batchId: randomUUID(),
    behavior: "end",
    nativeEvent: "session_shutdown",
    start: null,
    end: null,
    sentAt: new Date((clock += 1000)).toISOString(),
    cursor: String(Buffer.byteLength(source)),
    sourcePos: Buffer.byteLength(source),
    context: {
      cwd: "/canary",
      installation: {
        hostname: "canary",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
      activeLeafId: "30b52614",
    },
    records,
  });
  const ready = () =>
    completedNativeSessions(database.prisma, organizationId, "PI", checkpoints);
  const earlier = envelope(parent);
  earlier.records = records.slice(0, -2);
  earlier.sourcePos = records.at(-2)?.pos ?? 0;
  earlier.context.activeLeafId = "a2bc6577";
  await ingest.execute(organization.context, earlier);
  const old = await database.prisma.traceSessionControl.findFirstOrThrow({
    where: { harnessSessionId: parent },
  });
  expect(old.status).toBe("ENDED");
  const oldCount = (await native.messages(organizationId, old.id)).length;
  expect(await ready()).toBe(false);

  const finalSource = envelope(parent);
  finalSource.behavior = "sync";
  finalSource.nativeEvent = "agent_end";
  await ingest.execute(organization.context, finalSource);
  const synced = await database.prisma.traceSessionControl.findFirstOrThrow({
    where: { id: old.id },
  });
  expect(synced.status).toBe("ENDED");
  expect(
    (await native.messages(organizationId, synced.id)).length,
  ).toBeGreaterThan(oldCount);
  expect(await ready()).toBe(false);

  await ingest.execute(organization.context, envelope(parent));
  expect(
    await completedNativeSessions(
      database.prisma,
      organizationId,
      "PI",
      checkpoints.slice(0, 1),
    ),
  ).toBe(true);
  expect(await ready()).toBe(false); // The detached fork collector still has work.

  const missingLeaf = envelope(fork);
  missingLeaf.context.activeLeafId = "not-arrived";
  const waiting = await native.ingest.execute(
    organization.context,
    missingLeaf,
  );
  await native.projection.process(organizationId, waiting.result.sessionId);
  expect(await ready()).toBe(false); // An end receipt alone does not prove projection.
  await ingest.execute(organization.context, envelope(fork));
  expect(await ready()).toBe(true);
  expect(
    await completedNativeSessions(
      database.prisma,
      "other-organization",
      "PI",
      checkpoints,
    ),
  ).toBe(false);
});
