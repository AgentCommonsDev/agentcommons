import { randomUUID } from "node:crypto";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CursorCodec } from "../src/services/cursor.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import {
  releaser,
  syntheticContext,
  syntheticOrganization,
} from "./support.js";

const { defer, release } = releaser();
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
const context = () => syntheticContext("org-files");
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
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  await syntheticOrganization(db, {
    organizationId: "org-files",
    keyId: "key-files",
    installationId,
    permissions: { sessions: ["read"] },
  });
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
afterAll(release);

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
