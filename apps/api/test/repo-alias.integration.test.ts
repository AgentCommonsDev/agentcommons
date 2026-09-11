import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { startApp, type StartedApp } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { provisionOrganization, releaser } from "./support.js";
import { traceServices } from "./trace-services.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let native: ReturnType<typeof traceServices>;
let started: StartedApp;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
const { defer, release } = releaser();
const sessions = new Map<string, string>();
/** One indexed session per repository remote; the title carries the repository so a search can tell them apart. */
async function ingest(remoteUrl: string): Promise<string> {
  const response = await started.app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: { authorization: `Bearer ${owner.key}` },
    payload: testEnvelope({
      context: {
        cwd: "/repo",
        git: { root: "/repo", remoteUrl, branch: "main", head: null },
      },
      records: [
        textRecord(0, `Repository alias fixture ${remoteUrl}`, {
          uuid: randomUUID(),
        }),
      ],
    }),
  });
  expect(response.statusCode, response.body).toBe(202);
  const id = z.object({ sessionId: z.uuid() }).parse(response.json()).sessionId;
  const control = await db.prisma.traceSessionControl.findFirstOrThrow({
    where: { id },
  });
  await native.projection.process(control.organizationId, id);
  return id;
}
const found = async (repo_name: string) =>
  (
    await started.runtime.services.search.execute(owner.context, {
      query: "alias fixture",
      filters: { repo_name },
    })
  ).result.blocks
    .map((block) => block.session_id)
    .sort();
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  native = traceServices(db);
  defer(() => native.close());
  owner = await provisionOrganization(db, "repo-alias");
  started = await startApp(db);
  defer(() => started.close());
  for (const remote of [
    "https://github.com/acme/orders-api.git",
    "git@gitlab.com:acme/orders-api.git",
    "https://github.com/other/orders-api.git",
    "https://github.com/acme/billing.git",
  ])
    sessions.set(remote, await ingest(remote));
});
afterAll(release);

// @req R-SRCH-05
it("resolves repo_name as the canonical name, an org/repo pair or a bare name, and refuses ambiguity", async () => {
  const github = sessions.get("https://github.com/acme/orders-api.git");
  const gitlab = sessions.get("git@gitlab.com:acme/orders-api.git");
  const other = sessions.get("https://github.com/other/orders-api.git");
  const billing = sessions.get("https://github.com/acme/billing.git");
  if (!github || !gitlab || !other || !billing) throw new Error("fixture");
  // Canonical: exact.
  expect(await found("github.com/acme/orders-api")).toEqual([github]);
  // org/repo, the form agents guess from the remote: one repository matches it on one host.
  expect(await found("other/orders-api")).toEqual([other]);
  expect(await found("acme/billing")).toEqual([billing]);
  // The same org/repo on two hosts, or a bare name shared by three repositories, is ambiguous.
  for (const repo_name of ["acme/orders-api", "orders-api"])
    await expect(found(repo_name)).rejects.toMatchObject({
      code: "AMBIGUOUS_REPO",
    });
  // A bare name that one repository carries resolves; unknown names match nothing.
  expect(await found("billing")).toEqual([billing]);
  expect(await found("nobody/orders-api")).toEqual([]);
  expect(await found("example.org/acme/orders-api")).toEqual([]);
  // A list resolves each value on its own.
  expect(await found(["other/orders-api", "billing"] as never)).toEqual(
    [other, billing].sort(),
  );
});
