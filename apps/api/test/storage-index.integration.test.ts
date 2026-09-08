import { z } from "zod";
import { identityDigest } from "@agentcommons/core";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@agentcommons/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { IngestService } from "../src/services/ingest.js";
import { startDatabase, provisionOrganization } from "./support.js";
let db: Awaited<ReturnType<typeof startDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let writer: PrismaClient;
let service: IngestService;
const errors: string[] = [];
beforeAll(async () => {
  db = await startDatabase();
  org = await provisionOrganization(db, "storage-index");
  const observed = new PrismaClient({
    datasourceUrl: db.urls.app,
    log: [{ emit: "event", level: "error" }],
  });
  observed.$on("error", (event) =>
    errors.push(
      event.message.match(/index row[^\n]*/u)?.[0] ?? event.message.slice(-300),
    ),
  );
  writer = observed;
  service = new IngestService({
    prisma: writer,
    audit: db.audit,
    policies: db.policies,
  });
}, 120_000);
afterAll(async () => {
  await writer.$disconnect();
  await db.close();
});
function envelope(
  options: {
    repo?: string;
    branch?: string;
    nativeId?: string;
    tool?: string;
    file?: string;
  } = {},
) {
  return {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: options.nativeId ?? randomUUID(),
    behavior: "start",
    nativeEvent: "SessionStart",
    start: { resume: false },
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: 1,
    context: {
      cwd: "/fixture",
      installation: {
        hostname: "fixture",
        osUser: "fixture",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/fixture",
        remoteUrl: `https://github.com/test/${options.repo ?? "fixture"}.git`,
        branch: options.branch ?? "main",
        head: "abc123",
      },
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        key: randomUUID(),
        line: JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Large metadata fixture" },
              ...(options.tool || options.file
                ? [
                    {
                      type: "tool_use",
                      id: "fixture-tool",
                      name: options.tool ?? "Read",
                      input: { file_path: options.file ?? "/fixture/file.ts" },
                    },
                  ]
                : []),
            ],
          },
        }),
      },
    ],
    cursor: "1",
    end: null,
  };
}
// @req R-ING-02 @req R-ING-15
it("stores full large repository and branch metadata and remains exactly filterable", async () => {
  const repo = `long-${"z".repeat(300_000)}`;
  const branch = `branch-${"q".repeat(300_000)}`;
  errors.length = 0;
  let failure: unknown;
  let id: string | undefined;
  try {
    id = (await service.execute(org.context, envelope({ repo, branch }))).result
      .sessionId;
  } catch (error) {
    failure = error;
  }
  expect(failure, errors.join("\n")).toBeUndefined();
  const row = await db.prisma.agentSession.findUniqueOrThrow({
    where: { id: z.uuid().parse(id) },
  });
  expect(row.repoName).toBe(`github.com/test/${repo}`);
  expect(row.branch).toBe(branch);
  expect(
    await db.prisma.agentSession.count({
      where: { repoName: row.repoName, branch },
    }),
  ).toBe(1);
});

// @req R-ING-02 @req R-ING-08
it.each(["nativeId", "tool", "file"] as const)(
  "retains large indexed %s source metadata",
  async (field) => {
    const value =
      field === "file"
        ? `/fixture/${"d".repeat(300_000)}/file.ts`
        : `${field}-${"n".repeat(300_000)}`;
    errors.length = 0;
    let failure: unknown;
    let id: string | undefined;
    try {
      id = (await service.execute(org.context, envelope({ [field]: value })))
        .result.sessionId;
    } catch (error) {
      failure = error;
    }
    expect(failure, errors.join("\n")).toBeUndefined();
    const row = await db.prisma.agentSession.findUniqueOrThrow({
      where: { id: z.uuid().parse(id) },
    });
    if (field === "nativeId")
      expect(row.harnessSessionId).toBe(`redacted-${identityDigest(value)}`);
    if (field === "tool")
      expect(row.toolsUsed.some((name) => name === value)).toBe(true);
    if (field === "file")
      expect(
        (
          await db.prisma.sessionFile.findMany({ where: { sessionId: row.id } })
        ).some((file) => file.path === value.slice("/fixture/".length)),
      ).toBe(true);
  },
);

// @req R-ING-08 @req R-ORG-06
it("keeps literal digest-looking file names distinct while deduplicating complete identical paths", async () => {
  const result = await service.execute(org.context, envelope());
  const session = await db.prisma.agentSession.findUniqueOrThrow({
    where: { id: result.result.sessionId },
  });
  const names = [
    "plain.ts",
    `redacted-${identityDigest("plain.ts")}`,
    "plain.ts",
  ];
  const inserted = await db.prisma.sessionFile.createMany({
    data: names.map((path) => ({
      organizationId: session.organizationId,
      sessionId: session.id,
      path,
      ops: ["read"],
    })),
    skipDuplicates: true,
  });
  expect(inserted.count).toBe(2);
  expect(
    (await db.prisma.sessionFile.findMany({ where: { sessionId: session.id } }))
      .map((file) => file.path)
      .sort(),
  ).toEqual([...new Set(names)].sort());
});
