import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import type { IngestEnvelope } from "@agentcommons/core";
import { IngestService } from "../src/services/ingest.js";
import { startDatabase, provisionOrganization } from "./support.js";

let database: Awaited<ReturnType<typeof startDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: IngestService;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startDatabase();
  release.unshift(() => database.close());
  organization = await provisionOrganization(database, "lifecycle-clock");
  ingest = new IngestService({
    prisma: database.prisma,
    audit: database.audit,
    policies: database.policies,
  });
});
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

// @req R-ING-07 @req R-HRN-04
it("a final source flush cannot suppress its earlier-captured end at the same source position", async () => {
  const transcript = z
    .looseObject({
      messages: z.array(z.record(z.string(), z.unknown())),
    })
    .parse(
      JSON.parse(
        await readFile("fixtures/transcripts/gemini-cli/05-final.json", "utf8"),
      ),
    );
  const base: IngestEnvelope = {
    envelopeVersion: 2,
    harness: "GEMINI_CLI",
    harnessSessionId: randomUUID(),
    installationId: randomUUID(),
    batchId: randomUUID(),
    behavior: "start",
    nativeEvent: "SessionStart",
    start: { resume: false },
    end: null,
    sentAt: "2026-09-08T01:47:27.000Z",
    sourcePos: 0,
    cursor: "initial",
    context: {
      cwd: "/repo",
      installation: {
        hostname: "canary",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [],
  };
  const first = await ingest.execute(organization.context, base);
  const flush: IngestEnvelope = {
    ...base,
    batchId: randomUUID(),
    behavior: "sync",
    nativeEvent: "source_flush",
    start: null,
    sentAt: "2026-09-08T01:47:32.000Z",
    sourcePos: 4000,
    records: transcript.messages.map((payload, pos) => ({
      pos,
      sourceVersion: 0,
      key: null,
      line: JSON.stringify(payload),
    })),
  };
  await ingest.execute(organization.context, flush);
  const end: IngestEnvelope = {
    ...flush,
    batchId: randomUUID(),
    behavior: "end",
    nativeEvent: "SessionEnd",
    sentAt: "2026-09-08T01:47:31.000Z",
    records: [],
  };
  await ingest.execute(organization.context, end);
  const session = await database.prisma.agentSession.findUniqueOrThrow({
    where: { id: first.result.sessionId },
    include: { messages: true },
  });
  expect(session.messages.some((message) => message.role === "USER")).toBe(
    true,
  );
  expect(
    session.messages.some((message) => message.kind === "TOOL_RESULT"),
  ).toBe(true);
  expect(session).toMatchObject({
    status: "ENDED",
    endedAt: new Date(end.sentAt),
    lifecyclePos: 4000n,
    lifecycleAt: new Date(end.sentAt),
  });
  const laterFlush = {
    ...flush,
    batchId: randomUUID(),
    sourcePos: 4100,
    sentAt: "2026-09-08T01:47:34.000Z",
    records: [],
  };
  await ingest.execute(organization.context, laterFlush);
  expect(
    await database.prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
    }),
  ).toMatchObject({
    status: "ENDED",
    lifecyclePos: 4000n,
    lifecycleAt: new Date(end.sentAt),
  });
  const resume = {
    ...laterFlush,
    batchId: randomUUID(),
    behavior: "start",
    start: { resume: true },
    sentAt: "2026-09-08T01:47:33.000Z",
  };
  await ingest.execute(organization.context, resume);
  await ingest.execute(organization.context, {
    ...end,
    batchId: randomUUID(),
    sentAt: "2026-09-08T01:47:35.000Z",
  });
  expect(
    await database.prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
    }),
  ).toMatchObject({
    status: "ACTIVE",
    endedAt: null,
    lifecyclePos: 4100n,
    lifecycleAt: new Date(resume.sentAt),
  });
});
