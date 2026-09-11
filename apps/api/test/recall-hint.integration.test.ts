import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { configSchema } from "../../../packages/hook/src/config.js";
import {
  recallCachePath,
  refreshRecallHint,
} from "../../../packages/hook/src/recall.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { requireCaller } from "../src/services/context.js";
import { startApp, type StartedApp } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { provisionOrganization, releaser } from "./support.js";
import { traceServices } from "./trace-services.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let native: ReturnType<typeof traceServices>;
let app: StartedApp["app"];
let address: string;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
const { defer, release } = releaser();
const GIT = {
  root: "/repo",
  remoteUrl: "git@github.com:acme/widgets.git",
  branch: "main",
  head: null,
};
const REPO = "github.com/acme/widgets";
async function ingest(key: string, git: typeof GIT | null): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: { authorization: `Bearer ${key}` },
    payload: testEnvelope({
      context: { cwd: "/repo", git },
      records: [textRecord(0, "Recall hint fixture", { uuid: randomUUID() })],
    }),
  });
  expect(response.statusCode, response.body).toBe(202);
  const id = z.object({ sessionId: z.uuid() }).parse(response.json()).sessionId;
  const control = await db.prisma.traceSessionControl.findFirstOrThrow({
    where: { id },
  });
  await native.projection.process(control.organizationId, id);
}
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  native = traceServices(db);
  defer(() => native.close());
  owner = await provisionOrganization(db, "recall-primary");
  other = await provisionOrganization(db, "recall-other");
  const started = await startApp(db, {}, { listen: true });
  defer(() => started.close());
  app = started.app;
  if (!started.address) throw new Error("The test server has no address.");
  address = started.address;
});
afterAll(release);

// @req R-CAP-19
it("the uploader's refresh caches the caller-visible session count of the session's repository through the list endpoint", async () => {
  await ingest(owner.key, GIT);
  await ingest(owner.key, GIT);
  await ingest(owner.key, {
    ...GIT,
    remoteUrl: "https://github.com/acme/other.git",
  });
  await ingest(other.key, GIT);
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-recall-api-"));
  const config = configSchema.parse({
    server: address,
    key: owner.key,
    installationId: randomUUID(),
    node: process.execPath,
  });
  expect(await refreshRecallHint(directory, config, GIT)).toBe("refreshed");
  expect(
    JSON.parse(
      readFileSync(recallCachePath(directory, REPO), "utf8"),
    ) as unknown,
  ).toMatchObject({ v: 1, repoName: REPO, sessions: 2 });
  // The other organization's session is invisible to this key, and the refresh is one audited read.
  expect(
    await db.prisma.auditEvent.count({
      where: {
        organizationId: requireCaller(owner.owner).organizationId,
        action: "sessions.list",
      },
    }),
  ).toBe(1);
  // A repository nobody indexed caches zero, so the hook stays silent there.
  const unknown = { ...GIT, remoteUrl: "git@github.com:acme/empty.git" };
  expect(await refreshRecallHint(directory, config, unknown)).toBe("refreshed");
  expect(
    JSON.parse(
      readFileSync(recallCachePath(directory, "github.com/acme/empty"), "utf8"),
    ) as unknown,
  ).toMatchObject({ sessions: 0 });
});
