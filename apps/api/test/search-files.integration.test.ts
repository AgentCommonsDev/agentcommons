import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedPolicies } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import type { ServiceContext } from "../src/services/context.js";

/** Released newest first, so clients close before the containers they talk to. */
const cleanup: (() => Promise<unknown>)[] = [];
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let search: SearchService;
let sessions: SessionService;
const installationId = randomUUID();
/** Three sessions with distinct file activity, so each filter combination selects a different set. */
const ids = {
  editedAuth: randomUUID(),
  readAuthEditedDocs: randomUUID(),
  noFiles: randomUUID(),
};
function context(): ServiceContext {
  return {
    caller: {
      organizationId: "org-files",
      userId: "owner",
      apiKeyId: null,
      role: "admin",
      authMethod: "key",
      permissions: { sessions: ["read"] },
    },
    requestId: randomUUID(),
    transport: "rest",
    ip: "127.0.0.1",
    userAgent: "search-files-test",
    startedAt: Date.now(),
    headers: new Headers(),
  };
}
async function session(
  id: string,
  title: string,
  files: { path: string; ops: string[] }[],
) {
  await fixtures.session({
    id,
    organizationId: "org-files",
    userId: "owner",
    keyId: "key-files",
    installationId,
    fields: { title, repo_name: "host/team/repo", branch: "main" },
  });
  await fixtures.insert("messages", id, {
    message_id: randomUUID(),
    seq: 0,
    block_index: 0,
    role: "USER",
    kind: "TEXT",
    content: `Session about files: ${title}`,
    tool_input: "null",
    searchable: true,
    search_text: `Session about files: ${title}`,
    timestamp: "2026-08-15T00:00:00Z",
    received_at: new Date("2026-08-15T00:00:00Z"),
  });
  await fixtures.update("sessions", id, { message_count: 1 });
  for (const file of files)
    await fixtures.insert("session_files", id, {
      file_id: file.path,
      path: file.path,
      ops: file.ops,
    });
}
async function found(filters: Record<string, unknown>): Promise<string[]> {
  const result = await search.execute(context(), {
    query: "",
    context: 0,
    filters,
  });
  return result.result.blocks.map((block) => block.session_id).sort();
}
beforeAll(async () => {
  db = await startTraceDatabase();
  cleanup.unshift(() => db.close());
  fixtures = new TraceFixtures(db);
  cleanup.unshift(() => fixtures.close());
  const writer = new Client({ connectionString: db.urls.migration });
  await writer.connect();
  cleanup.unshift(() => writer.end());
  await writer.query(
    `INSERT INTO "user"(id,name,email,"updatedAt") VALUES('owner','Owner','owner@example.test',now()); INSERT INTO organization(id,name,slug,"createdAt") VALUES('org-files','Files','files',now()); INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES('member-files','org-files','owner','admin',now()); INSERT INTO api_key_owner(key_id,organization_id,user_id) VALUES('key-files','org-files','owner')`,
  );
  await seedPolicies(db.prisma, "org-files", "owner");
  await db.prisma.apikey.create({
    data: {
      id: "key-files",
      referenceId: "org-files",
      key: "fixture-hash-files",
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: JSON.stringify({ sessions: ["read"] }),
    },
  });
  await writer.query(
    "INSERT INTO installation(organization_id,id,hostname,os_user,platform,arch) VALUES($1,$2,'files-host','files-user','linux','x64')",
    ["org-files", installationId],
  );
  const dependencies = {
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("search-files-cursor-secret-with-entropy"),
  };
  search = new SearchService(dependencies);
  sessions = new SessionService(dependencies);
  await session(ids.editedAuth, "Edited the limiter", [
    { path: "src/auth/limiter.ts", ops: ["read", "edit"] },
  ]);
  await session(ids.readAuthEditedDocs, "Read auth, wrote docs", [
    { path: "src/auth/limiter.ts", ops: ["read"] },
    { path: "docs/limits.md", ops: ["edit", "write"] },
  ]);
  await session(ids.noFiles, "Talked only", []);
}, 120_000);
afterAll(async () => {
  expect(await cleanupAll(cleanup.splice(0))).toEqual([]);
});

// @req R-SRCH-03 @req R-SRCH-14
it("selects sessions by file operation, and by operation on the same file as the path prefix", async () => {
  expect(await found({ file_operation: "edit" })).toEqual(
    [ids.editedAuth, ids.readAuthEditedDocs].sort(),
  );
  expect(await found({ file_operation: ["write", "delete"] })).toEqual([
    ids.readAuthEditedDocs,
  ]);
  expect(await found({ file_prefix: "src/auth/" })).toEqual(
    [ids.editedAuth, ids.readAuthEditedDocs].sort(),
  );
  // The second session edited docs/ and only read src/auth/, so it must not match.
  expect(
    await found({ file_prefix: "src/auth/", file_operation: "edit" }),
  ).toEqual([ids.editedAuth]);
  expect(
    await found({ file_prefix: "src/auth/", file_operation: "read" }),
  ).toEqual([ids.editedAuth, ids.readAuthEditedDocs].sort());
  expect(await found({ file_operation: "delete" })).toEqual([]);
  await expect(
    search.execute(context(), {
      query: "",
      filters: { file_operation: "create" },
    }),
  ).rejects.toThrow();
});

// @req R-SRCH-14
it("applies the same file filters to the session list", async () => {
  const listed = await sessions.list(context(), {
    filters: { file_prefix: "docs/", file_operation: "write" },
  });
  expect(listed.result.items.map((item) => item.session_id)).toEqual([
    ids.readAuthEditedDocs,
  ]);
  const everything = await sessions.list(context(), { filters: {} });
  expect(everything.result.items).toHaveLength(3);
  const audit = await db.prisma.auditEvent.findUniqueOrThrow({
    where: { id: listed.audit.id },
  });
  expect(audit.detail).toMatchObject({
    input: { filters: { file_prefix: "docs/", file_operation: "write" } },
  });
});
